export type Review = {
  clauses: { clause_type: string; text: string }[];
  risk_flags: { clause_type: string; severity: string; rationale: string }[];
  citations: { clause_type: string; quote: string }[];
  abstentions?: { clause_type: string; reason: string }[];
};
export type Gold = {
  clause_types: string[];
  risk_flags: Record<string, string>;
  clause_aliases: Record<string, string>;
  clause_anchors: Record<string, string>;
  thresholds: Record<string, number>;
};
export const scenarios = {
  baseline: { title: 'Original fixture', description: 'A deliberately imperfect review. No model call.' },
  'no-evidence': { title: 'Remove all citations', description: 'Same findings, with every supporting quotation removed.' },
  'missed-risks': { title: 'Remove all risk flags', description: 'Keep the clause coverage and citations, but omit every risk.' },
  'conflicting-flags': { title: 'Add a conflicting severity', description: 'Duplicate the first risk with a different severity.' },
} as const;
export type Scenario = keyof typeof scenarios;
export function applyScenario(review: Review, scenario: Scenario): Review {
  const output = structuredClone(review);
  if (scenario === 'no-evidence') output.citations = [];
  if (scenario === 'missed-risks') output.risk_flags = [];
  if (scenario === 'conflicting-flags' && output.risk_flags.length) {
    const first = output.risk_flags[0];
    output.risk_flags.push({ ...first, severity: first.severity === 'low' ? 'high' : 'low' });
  }
  return output;
}
const punctuation = new Set(Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~“”‘’–—'));
export function normalize(text: string): string {
  return Array.from(text.toLowerCase()).map(c => punctuation.has(c) ? ' ' : c).join('').trim().replace(/\s+/gu, ' ');
}
export function locate(source: string, quote: string): [number, number] | null {
  const needle = normalize(quote);
  if (!needle) return null;
  const start = normalize(source).indexOf(needle);
  return start < 0 ? null : [start, start + needle.length];
}
// Grounding is a substring match, so a one-word quote such as `the` is grounded in any
// contract. Release policy v2.1 counts grounded quotes under this floor; the value is
// MIN_QUOTE_WORDS in the Python scorer and must stay equal to it.
export const MIN_QUOTE_WORDS = 3;
/** The words of a quote as the floor counts them: whitespace-separated tokens of the normalised quote, the same text grounding matched. Punctuation splits a token, so `99.5%` is two words and `clause 5.2` is three. */
export function quoteWordCount(quote: string): number {
  const words = normalize(quote);
  return words ? words.split(' ').length : 0;
}
/** Map a grounded quotation back to offsets in the original contract text. */
export function locateSource(source: string, quote: string): [number, number] | null {
  const span = locate(source, quote);
  if (!span) return null;
  const offsets: [number, number][] = [];
  let pendingSpace: [number, number] | null = null;
  let hasContent = false;
  for (let index = 0; index < source.length;) {
    const character = String.fromCodePoint(source.codePointAt(index)!);
    const end = index + character.length;
    const normalized = punctuation.has(character) ? ' ' : character.toLowerCase();
    // locate() returns UTF-16 indices, so record one offset per code unit, not per code point.
    for (let unit = 0; unit < normalized.length; unit++) {
      if (/\s/u.test(normalized[unit])) {
        pendingSpace = pendingSpace ? [pendingSpace[0], end] : [index, end];
      } else {
        if (hasContent && pendingSpace) offsets.push(pendingSpace);
        pendingSpace = null;
        offsets.push([index, end]);
        hasContent = true;
      }
    }
    index = end;
  }
  const first = offsets[span[0]];
  const last = offsets[span[1] - 1];
  return first && last ? [first[0], last[1]] : null;
}
const unique = (items: string[]) => [...new Set(items)].sort();
const harmonic = (p: number, r: number) => p + r ? 2 * p * r / (p + r) : 0;
export function scoreReview(source: string, gold: Gold, review: Review, aliasMode: 'on' | 'off' = 'on') {
  const aliases = aliasMode === 'on' ? gold.clause_aliases : {};
  const canonical = (key: string) => Object.hasOwn(aliases, key) ? aliases[key] : key;
  const expected = new Set(gold.clause_types);
  const predicted = new Set(review.clauses.map(c => canonical(c.clause_type)));
  const tp = [...expected].filter(k => predicted.has(k)).length;
  const precision = predicted.size ? tp / predicted.size : 0;
  const recall = expected.size ? tp / expected.size : 0;
  const flags = new Map<string, string>();
  const duplicates: string[] = [], conflicts: string[] = [];
  for (const flag of review.risk_flags) {
    const key = canonical(flag.clause_type);
    if (flags.has(key)) {
      duplicates.push(key);
      if (flags.get(key) !== flag.severity) conflicts.push(key);
    } else flags.set(key, flag.severity);
  }
  const riskKeys = Object.keys(gold.risk_flags);
  const both = riskKeys.filter(k => flags.has(k));
  const correct = both.filter(k => flags.get(k) === gold.risk_flags[k]).length;
  const rp = flags.size ? both.length / flags.size : 1;
  const rr = riskKeys.length ? both.length / riskKeys.length : 1;
  const confusion: Record<string, number> = {};
  for (const k of [...both].sort()) {
    const key = `${gold.risk_flags[k]}->${flags.get(k)}`;
    confusion[key] = (confusion[key] || 0) + 1;
  }
  const spans = review.citations.map(c => locate(source, c.quote));
  const grounded = spans.filter((s): s is [number, number] => s !== null);
  // An ungrounded citation is already a hallucination and is not counted again as a short quote.
  const shortQuotes = review.citations.filter((c, i) => spans[i] !== null && quoteWordCount(c.quote) < MIN_QUOTE_WORDS).length;
  const normalized = normalize(source);
  const anchors = Object.entries(gold.clause_anchors).map(([key, anchor]) => ({key, start: normalized.indexOf(normalize(anchor))}));
  const located = anchors.filter(a => a.start >= 0).sort((a,b) => a.start - b.start || a.key.localeCompare(b.key));
  const covered: string[] = [], unevidenced: string[] = [];
  const uncovered = anchors.filter(a => a.start < 0).map(a => a.key);
  for (let i = 0; i < located.length; i++) {
    const end = located[i+1]?.start ?? normalized.length;
    const hit = grounded.some(([s,e]) => s < end && e > located[i].start);
    (hit ? covered : uncovered).push(located[i].key);
    // A flagged clause with no grounded quotation inside its region, looked up under the canonical
    // name like every other flag. A flag with no located anchor is not reported: it is either a false
    // positive, which risk precision already penalises, or a clause the answer set cannot locate.
    if (!hit && flags.has(located[i].key)) unevidenced.push(located[i].key);
  }
  return {
    clause_precision: precision, clause_recall: recall, clause_f1: harmonic(precision, recall),
    risk_flag_accuracy: riskKeys.length ? correct / riskKeys.length : 0,
    risk_precision: rp, risk_recall: rr, risk_f1: harmonic(rp,rr),
    risk_severity_accuracy: both.length ? correct / both.length : 0,
    risk_false_positives: [...flags.keys()].filter(k => !Object.hasOwn(gold.risk_flags,k)).sort(),
    risk_missed: riskKeys.filter(k => !flags.has(k)).sort(), risk_severity_confusion: confusion,
    risk_duplicate_flags: unique(duplicates), risk_conflicting_flags: unique(conflicts),
    risk_flags_without_evidence: unevidenced.sort(),
    span_coverage: anchors.length ? covered.length / anchors.length : 0,
    span_uncovered_clauses: uncovered.sort(), citation_grounded: grounded.length,
    citation_total: spans.length, citation_grounding: spans.length ? grounded.length / spans.length : 0,
    hallucination_count: spans.length - grounded.length, citation_short_count: shortQuotes,
    thresholds: { f1: .85, risk_accuracy: .45, grounding_rate: .75, hallucinations: 1, ...gold.thresholds },
  };
}
export type Scores = ReturnType<typeof scoreReview>;

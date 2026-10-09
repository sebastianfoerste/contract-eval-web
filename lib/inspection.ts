import type { Gold, Review, Scores } from './scoring';

export type MetricKey = 'clause_f1' | 'risk_precision' | 'risk_recall' | 'risk_severity_accuracy' | 'citation_grounding';

const acronyms = new Set(['ip', 'dpia', 'dpa', 'nda', 'saas', 'sla']);

export function clauseLabel(key: string) {
  return key.split('_').map((word, index) => acronyms.has(word) ? word.toUpperCase() : index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(' ');
}

/** Resolve a clause name through the reference aliases, exactly as scoreReview does. */
export function canonicalClause(aliases: Record<string, string>, key: string) {
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
}

const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Positive when the review rates a risk higher than the reference, negative when it rates it lower. */
export function severityGap(expected?: string, predicted?: string) {
  if (!expected || !predicted) return 0;
  return (severityRank[predicted] ?? 0) - (severityRank[expected] ?? 0);
}

export type FindingStatus = 'Match' | 'Severity mismatch' | 'Missed' | 'Extra flag' | 'Conflict';
export type RiskFinding = { key: string; expected?: string; predicted?: string; severities: string[]; status: FindingStatus; gap: number };

/**
 * One row per clause that the reference or the review treats as a risk. Flags are
 * resolved through the reference aliases so the rows agree with scoreReview.
 */
export function riskFindings(gold: Pick<Gold, 'risk_flags' | 'clause_aliases'>, review: Review, scores: Pick<Scores, 'risk_conflicting_flags'>): RiskFinding[] {
  const canonical = (key: string) => canonicalClause(gold.clause_aliases, key);
  const flagged = new Map<string, string[]>();
  for (const flag of review.risk_flags) {
    const key = canonical(flag.clause_type);
    flagged.set(key, [...(flagged.get(key) || []), flag.severity]);
  }
  return [...new Set([...Object.keys(gold.risk_flags), ...flagged.keys()])].map(key => {
    const expected = Object.hasOwn(gold.risk_flags, key) ? gold.risk_flags[key] : undefined;
    const severities = flagged.get(key) || [];
    // scoreReview grades the first severity supplied for a clause, so the table shows the same one.
    const predicted = severities[0];
    const status: FindingStatus = scores.risk_conflicting_flags.includes(key) ? 'Conflict'
      : !expected ? 'Extra flag'
      : !predicted ? 'Missed'
      : predicted !== expected ? 'Severity mismatch'
      : 'Match';
    return { key, expected, predicted, severities, status, gap: severityGap(expected, predicted) };
  });
}

/**
 * Higher numbers are more serious. The reference reviews for a conservative party before
 * signature, so exposure the reader cannot see outranks every false alarm.
 */
export function findingPriority(finding: RiskFinding): number {
  if (finding.status === 'Match') return 0;
  const level = (severity?: string) => severityRank[severity ?? ''] ?? 0;
  const reference = level(finding.expected);
  const supplied = finding.severities.map(level);
  // Reference severity the reader cannot rely on: all of a missed risk, the gap of an
  // under-rated one, the worst case of a contradictory one.
  const hidden = Math.max(reference - (supplied.length ? Math.min(...supplied) : 0), 0);
  // Alarm beyond the reference: an over-rated risk, or a flag on a clause that is no reference risk.
  const overstated = Math.max((supplied.length ? Math.max(...supplied) : 0) - reference, 0);
  // Ties go to the higher-stakes clause, then to a contradiction, which makes the flag unusable.
  return 100 * hidden + 10 * overstated + 2 * reference + (finding.status === 'Conflict' ? 1 : 0);
}

/** The two kinds of error the ranking separates: exposure the reader cannot see, and alarm without basis. */
export type FindingTier = 'match' | 'exposure' | 'alarm';

export function findingTier(finding: RiskFinding): FindingTier {
  const priority = findingPriority(finding);
  return priority === 0 ? 'match' : priority >= 100 ? 'exposure' : 'alarm';
}

export function orderFindings(findings: RiskFinding[]) {
  return findings.map((finding, index) => ({ finding, index, priority: findingPriority(finding) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .map(value => value.finding);
}

export type ReadoutPoint = { metric: MetricKey; tone: 'good' | 'issue' | 'info'; title: string; detail: string; findings: string[] };

const withSeverity = (finding: RiskFinding, value = finding.expected) => `${clauseLabel(finding.key)} (${value})`;
const sentence = (prefix: string, items: string[]) => items.length ? `${prefix}: ${items.join(', ')}.` : '';
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** A plain-language account of the run, ordered as a reviewer would check it. */
export function readout(gold: Gold, review: Review, scores: Scores): ReadoutPoint[] {
  const rows = orderFindings(riskFindings(gold, review, scores));
  const referenceRisks = Object.keys(gold.risk_flags).length;
  const found = referenceRisks - scores.risk_missed.length;
  const missed = rows.filter(row => row.status === 'Missed');
  const shared = rows.filter(row => row.expected && row.predicted);
  const correct = shared.filter(row => row.gap === 0);
  const under = shared.filter(row => row.gap < 0);
  const over = shared.filter(row => row.gap > 0);
  const extra = rows.filter(row => !row.expected);
  const conflicts = rows.filter(row => row.status === 'Conflict');
  const points: ReadoutPoint[] = [];

  points.push(review.risk_flags.length === 0
    ? { metric: 'risk_recall', tone: 'issue', title: 'No risks flagged', detail: `The review raised none of the ${plural(referenceRisks, 'reference risk')}.`, findings: missed.map(row => row.key) }
    : { metric: 'risk_recall', tone: found === referenceRisks ? 'good' : 'issue', title: `Found ${found} of ${plural(referenceRisks, 'reference risk')}`, detail: sentence('Missed', missed.map(row => withSeverity(row))) || 'No reference risk was missed.', findings: missed.map(row => row.key) });

  if (shared.length) {
    points.push({
      metric: 'risk_severity_accuracy',
      tone: correct.length === shared.length ? 'good' : 'issue',
      title: `${correct.length} of ${shared.length} severities match the reference`,
      detail: [sentence('Under-rated', under.map(row => `${clauseLabel(row.key)} (${row.expected} → ${row.predicted})`)), sentence('Over-rated', over.map(row => `${clauseLabel(row.key)} (${row.expected} → ${row.predicted})`))].filter(Boolean).join(' ') || 'Every shared risk carries the reference severity.',
      findings: [...under, ...over].map(row => row.key),
    });
  }

  if (extra.length || conflicts.length) {
    points.push({
      metric: 'risk_precision',
      tone: 'issue',
      title: [extra.length ? plural(extra.length, 'extra flag') : '', conflicts.length ? plural(conflicts.length, 'contradictory severity', 'contradictory severities') : ''].filter(Boolean).join(' and '),
      detail: [sentence('Not a reference risk', extra.map(row => withSeverity(row, row.predicted))), sentence('Flagged with more than one severity', conflicts.map(row => `${clauseLabel(row.key)} (${[...new Set(row.severities)].join(' and ')})`))].filter(Boolean).join(' '),
      findings: [...extra, ...conflicts].map(row => row.key),
    });
  } else if (review.risk_flags.length) {
    points.push({ metric: 'risk_precision', tone: 'good', title: 'No extra or contradictory flags', detail: 'Every flag corresponds to a reference risk and carries one severity.', findings: [] });
  }

  const anchors = Object.keys(gold.clause_anchors).length;
  const ungrounded = scores.hallucination_count;
  points.push(scores.citation_total === 0
    ? { metric: 'citation_grounding', tone: 'issue', title: 'No quotations supplied', detail: 'None of the findings can be traced to the contract text.', findings: [] }
    : {
      metric: 'citation_grounding',
      tone: ungrounded ? 'issue' : 'good',
      title: `${scores.citation_grounded} of ${plural(scores.citation_total, 'quotation')} located in the contract`,
      detail: `${ungrounded ? `${plural(ungrounded, 'quotation')} could not be found in the source. ` : ''}Quotations reach ${anchors - scores.span_uncovered_clauses.length} of ${anchors} reference clauses.`,
      findings: [],
    });

  const clauses = clauseFindings(gold, review);
  const expectedClauses = clauses.filter(clause => clause.expected);
  const missedClauses = clauses.filter(clause => clause.status === 'Missed');
  const extraClauses = clauses.filter(clause => clause.status === 'Extra');
  points.push({
    metric: 'clause_f1',
    tone: missedClauses.length ? 'issue' : extraClauses.length ? 'info' : 'good',
    title: `Identified ${expectedClauses.length - missedClauses.length} of ${plural(expectedClauses.length, 'expected clause')}`,
    detail: [sentence('Missed', missedClauses.map(clause => clauseLabel(clause.key))), sentence('Also named, outside the reference set', extraClauses.map(clause => clauseLabel(clause.key)))].filter(Boolean).join(' ') || 'The review named exactly the reference clause set.',
    findings: [],
  });
  return points;
}

export function referenceReleaseReady(evidence: { stage: string; finalReleaseEligible: boolean; missing: string[]; errors: string[] }) {
  return evidence.stage === 'frozen' && evidence.finalReleaseEligible && evidence.missing.length === 0 && evidence.errors.length === 0;
}

export function displayMetric(key: MetricKey, scores: Scores, review: Review) {
  const noFlags = key === 'risk_precision' && review.risk_flags.length === 0;
  const noSharedRisks = key === 'risk_severity_accuracy' && Object.values(scores.risk_severity_confusion).reduce((total, count) => total + count, 0) === 0;
  const noQuotations = key === 'citation_grounding' && scores.citation_total === 0;
  if (noFlags || noSharedRisks || noQuotations) {
    const reason = noFlags ? 'No risk flags supplied' : noSharedRisks ? 'No shared risks to grade' : 'No quotations supplied';
    return { value: 'N/A', detail: reason, defined: false };
  }
  return { value: `${(scores[key] * 100).toFixed(1)}%`, detail: '', defined: true };
}

export function clauseFindings(gold: Gold, review: Review) {
  const expected = new Set(gold.clause_types);
  const predicted = new Map<string, Set<string>>();
  for (const clause of review.clauses) {
    const canonical = canonicalClause(gold.clause_aliases, clause.clause_type);
    const reported = predicted.get(canonical) || new Set<string>();
    reported.add(clause.clause_type);
    predicted.set(canonical, reported);
  }
  return [...new Set([...expected, ...predicted.keys()])].sort().map(key => {
    const reportedAs = [...(predicted.get(key) || [])].sort();
    const status = !expected.has(key) ? 'Extra' : !reportedAs.length ? 'Missed' : reportedAs.some(name => name !== key) ? 'Matched via alias' : 'Matched';
    return { key, expected: expected.has(key), reportedAs, status, abstentions: (review.abstentions || []).filter(value => canonicalClause(gold.clause_aliases, value.clause_type) === key) };
  });
}

export type ReviewChange = { kind: 'Clause' | 'Risk flag' | 'Quotation'; change: 'Added' | 'Removed'; key: string; detail: string; quote?: string };

export function reviewChanges(before: Review, after: Review): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const compare = (kind: ReviewChange['kind'], oldValues: string[], newValues: string[], describe: (value: string) => Omit<ReviewChange, 'kind' | 'change'>) => {
    const oldCounts = new Map<string, number>();
    const newCounts = new Map<string, number>();
    for (const value of oldValues) oldCounts.set(value, (oldCounts.get(value) || 0) + 1);
    for (const value of newValues) newCounts.set(value, (newCounts.get(value) || 0) + 1);
    for (const value of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
      const difference = (newCounts.get(value) || 0) - (oldCounts.get(value) || 0);
      for (let index = 0; index < Math.abs(difference); index++) changes.push({ kind, change: difference > 0 ? 'Added' : 'Removed', ...describe(value) });
    }
  };
  compare('Clause', before.clauses.map(value => value.clause_type), after.clauses.map(value => value.clause_type), key => ({ key, detail: key }));
  compare('Risk flag', before.risk_flags.map(value => `${value.clause_type}\u0000${value.severity}`), after.risk_flags.map(value => `${value.clause_type}\u0000${value.severity}`), value => {
    const [key, severity] = value.split('\u0000');
    return { key, detail: severity };
  });
  compare('Quotation', before.citations.map(value => `${value.clause_type}\u0000${value.quote}`), after.citations.map(value => `${value.clause_type}\u0000${value.quote}`), value => {
    const [key, quote] = value.split('\u0000');
    return { key, detail: quote, quote };
  });
  return changes;
}

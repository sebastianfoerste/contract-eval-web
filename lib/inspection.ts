import type { Gold, Review, Scores } from './scoring';

export type MetricKey = 'clause_f1' | 'risk_precision' | 'risk_recall' | 'risk_severity_accuracy' | 'citation_grounding';

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
    const canonical = gold.clause_aliases[clause.clause_type] || clause.clause_type;
    const reported = predicted.get(canonical) || new Set<string>();
    reported.add(clause.clause_type);
    predicted.set(canonical, reported);
  }
  return [...new Set([...expected, ...predicted.keys()])].sort().map(key => {
    const reportedAs = [...(predicted.get(key) || [])].sort();
    const status = !expected.has(key) ? 'Extra' : !reportedAs.length ? 'Missed' : reportedAs.some(name => name !== key) ? 'Matched via alias' : 'Matched';
    return { key, expected: expected.has(key), reportedAs, status, abstentions: (review.abstentions || []).filter(value => (gold.clause_aliases[value.clause_type] || value.clause_type) === key) };
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

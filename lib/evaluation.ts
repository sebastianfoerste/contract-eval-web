import benchmark from './benchmark';
import { applyScenario, scenarios, scoreReview, type Scenario, type Scores, type Review } from './scoring';
import { canonicalClause } from './inspection';
import type { Catalog } from './view';
export type Evaluation = {
  id: string; caseId: string; scenario: Scenario; scoredAt: string; scores: Scores; review: Review;
  provenance: { sourceCommit: string; hashes: {source: string; gold: string; review: string}; evaluator: string; goldStatus: string; adapter: string };
};
export type BenchmarkCase = (typeof benchmark.cases)[number];
export function findCase(caseId: string): BenchmarkCase {
  const item = benchmark.cases.find(c => c.id === caseId);
  if (!item) throw new Error('Unknown benchmark case');
  return item;
}
function score(item: BenchmarkCase, scenario: Scenario) {
  const review = applyScenario(item.review, scenario);
  return {caseId: item.id, scenario, scores: scoreReview(item.source,item.gold,review), review,
    provenance: {sourceCommit: benchmark.sourceCommit, hashes: item.hashes,
      evaluator: 'web-v1 / Python score_review parity', goldStatus: benchmark.goldStatus,
      adapter: 'deterministic-fixture / ' + scenario}};
}
export function evaluate(caseId: string, scenario: Scenario): Evaluation {
  return {id: crypto.randomUUID(), scoredAt: new Date().toISOString(), ...score(findCase(caseId), scenario)};
}
/** The same deterministic result, computed in place without a server round trip or timestamp. */
export function snapshot(caseId: string, scenario: Scenario = 'baseline'): Evaluation {
  return {id: `reference-${caseId}-${scenario}`, scoredAt: '', ...score(findCase(caseId), scenario)};
}
export const catalog: Catalog = {
  cases: benchmark.cases.map(item => {
    const canonical = (key: string) => canonicalClause(item.gold.clause_aliases, key);
    return {id: item.id, quotations: Object.fromEntries(Object.keys(scenarios).map(scenario => [scenario, applyScenario(item.review, scenario as Scenario).citations.map(citation => canonical(citation.clause_type))])), keys: [...new Set([...item.gold.clause_types, ...Object.keys(item.gold.risk_flags),
      ...item.review.clauses.map(c => canonical(c.clause_type)), ...item.review.risk_flags.map(f => canonical(f.clause_type)),
      ...item.review.citations.map(c => canonical(c.clause_type))])]};
  }),
  scenarios: Object.keys(scenarios),
};

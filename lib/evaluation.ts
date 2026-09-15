import benchmark from './benchmark';
import { applyScenario, scoreReview, type Scenario, type Scores, type Review } from './scoring';
export type Evaluation = {
  id: string; caseId: string; scenario: Scenario; scoredAt: string; scores: Scores; review: Review;
  provenance: { sourceCommit: string; hashes: {source: string; gold: string; review: string}; evaluator: string; goldStatus: string; adapter: string };
};
export function evaluate(caseId: string, scenario: Scenario): Evaluation {
  const item = benchmark.cases.find(c => c.id === caseId);
  if (!item) throw new Error('Unknown benchmark case');
  const review = applyScenario(item.review, scenario);
  return {id: crypto.randomUUID(), caseId, scenario, scoredAt: new Date().toISOString(),
    scores: scoreReview(item.source,item.gold,review), review,
    provenance: {sourceCommit: benchmark.sourceCommit, hashes: item.hashes,
      evaluator: 'web-v1 / Python score_review parity', goldStatus: benchmark.goldStatus,
      adapter: 'deterministic-fixture / ' + scenario}};
}

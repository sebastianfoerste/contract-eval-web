import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderReport } from '../lib/report.ts';
import { applyScenario, scoreReview } from '../lib/scoring.ts';

const benchmark = JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json', import.meta.url)));
const item = benchmark.cases[0];
const run = (review, scenario = 'baseline') => ({
  id: 'test', caseId: item.id, scenario, scoredAt: '', review, scores: scoreReview(item.source, item.gold, review),
  provenance: { sourceCommit: benchmark.sourceCommit, hashes: item.hashes, evaluator: 'test', goldStatus: benchmark.goldStatus, adapter: `deterministic-fixture / ${scenario}` },
});
const section = (report, heading) => report.split(`\n### ${heading}\n`)[1].split('\n### ')[0];

test('the report separates the scored v1 answers from the v2 candidate gate', () => {
  const report = renderReport(item, run(item.review), benchmark);
  const candidate = benchmark.referenceEvidence.cases.find(entry => entry.case === item.id).candidateSha256;
  assert.notEqual(candidate, item.hashes.gold);
  assert.ok(report.includes(`- Reference answers used for scoring (v1) SHA-256: ${item.hashes.gold}`));
  assert.ok(report.includes(`- v2 candidate answers SHA-256: ${candidate}`));
  const gate = report.split('## Reference evidence gate (v2 candidate answers)')[1];
  assert.ok(gate.includes(`- Final release eligible: ${benchmark.referenceEvidence.finalReleaseEligible ? 'yes' : 'no'}`));
  assert.ok(!gate.includes(item.hashes.gold), 'the gate section must not carry the v1 hash');
});

test('the report states the summary and the direction of severity mismatches', () => {
  const report = renderReport(item, run(item.review), benchmark);
  assert.ok(report.includes('- Found 5 of 6 reference risks. Missed: Notices (low).'));
  assert.ok(section(report, 'Assignment').includes('- Finding: Severity mismatch (under-rated)'));
  assert.ok(report.includes('Status: Not found in source'));
});

test('the report marks missing denominators as N/A', () => {
  const report = renderReport(item, run(applyScenario(item.review, 'missed-risks'), 'missed-risks'), benchmark);
  assert.ok(report.includes('- Risk precision: N/A (no risk flags supplied)'));
  assert.ok(report.includes('- Severity accuracy: N/A'));
});

test('the report attributes aliased flags and quotations to their reference clause', () => {
  const review = { ...item.review, risk_flags: [{ clause_type: 'residuals', severity: 'high', rationale: 'Aliased flag.' }], citations: [{ clause_type: 'residuals', quote: 'retained in the unaided memory of its personnel' }] };
  const residual = section(renderReport(item, run(review), benchmark), 'Residual knowledge');
  assert.ok(residual.includes('- Finding: Match'));
  assert.ok(residual.includes('- Review reasoning (high): Aliased flag.'));
  assert.ok(residual.includes('- Supporting quotations: 1'));
});

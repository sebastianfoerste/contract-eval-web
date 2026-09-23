import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { applyScenario, scoreReview } from '../lib/scoring.ts';
import { clauseFindings, displayMetric, referenceReleaseReady, reviewChanges } from '../lib/inspection.ts';

const benchmark = JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json', import.meta.url)));
const item = benchmark.cases[0];

test('zero-denominator metrics are not presented as measured percentages', () => {
  const noFlags = applyScenario(item.review, 'missed-risks');
  const noFlagsScore = scoreReview(item.source, item.gold, noFlags);
  assert.equal(noFlagsScore.risk_precision, 1);
  assert.equal(displayMetric('risk_precision', noFlagsScore, noFlags).value, 'N/A');
  assert.equal(displayMetric('risk_severity_accuracy', noFlagsScore, noFlags).value, 'N/A');
  const noQuotes = applyScenario(item.review, 'no-evidence');
  assert.equal(displayMetric('citation_grounding', scoreReview(item.source, item.gold, noQuotes), noQuotes).value, 'N/A');
  assert.equal(displayMetric('clause_f1', noFlagsScore, noFlags).defined, true);
});

test('clause coverage resolves aliases and exposes extra and missed clauses', () => {
  const gold = { ...item.gold, clause_types: ['confidentiality', 'termination'], clause_aliases: { secrecy: 'confidentiality' } };
  const review = { clauses: [{ clause_type: 'secrecy', text: '' }, { clause_type: 'assignment', text: '' }], risk_flags: [], citations: [], abstentions: [{ clause_type: 'termination', reason: 'No clear text' }] };
  const findings = clauseFindings(gold, review);
  assert.equal(findings.find(value => value.key === 'confidentiality').status, 'Matched via alias');
  assert.equal(findings.find(value => value.key === 'termination').status, 'Missed');
  assert.equal(findings.find(value => value.key === 'termination').abstentions[0].reason, 'No clear text');
  assert.equal(findings.find(value => value.key === 'assignment').status, 'Extra');
});

test('run comparison identifies added and removed evidence without collapsing duplicates', () => {
  const before = { clauses: [], risk_flags: [{ clause_type: 'a', severity: 'low', rationale: '' }], citations: [{ clause_type: 'a', quote: 'One' }, { clause_type: 'a', quote: 'One' }] };
  const after = { clauses: [{ clause_type: 'a', text: '' }], risk_flags: [{ clause_type: 'a', severity: 'high', rationale: '' }], citations: [{ clause_type: 'a', quote: 'One' }, { clause_type: 'a', quote: 'Two' }] };
  const changes = reviewChanges(before, after);
  assert.equal(changes.length, 5);
  assert.ok(changes.some(value => value.kind === 'Risk flag' && value.change === 'Removed' && value.detail === 'low'));
  assert.ok(changes.some(value => value.kind === 'Risk flag' && value.change === 'Added' && value.detail === 'high'));
  assert.ok(changes.some(value => value.kind === 'Quotation' && value.change === 'Removed' && value.quote === 'One'));
  assert.ok(changes.some(value => value.kind === 'Quotation' && value.change === 'Added' && value.quote === 'Two'));
});

test('exported reference evidence is fail-closed', () => {
  const evidence = benchmark.referenceEvidence;
  assert.equal(referenceReleaseReady(evidence), evidence.stage === 'frozen' && evidence.finalReleaseEligible && evidence.missing.length === 0 && evidence.errors.length === 0);
  assert.equal(referenceReleaseReady({ ...evidence, stage: 'frozen', finalReleaseEligible: true, missing: ['written_adjudication'] }), false);
  assert.equal(referenceReleaseReady({ ...evidence, stage: 'frozen', finalReleaseEligible: true, missing: [], errors: ['hash mismatch'] }), false);
});

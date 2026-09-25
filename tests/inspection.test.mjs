import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { applyScenario, scoreReview } from '../lib/scoring.ts';
import { clauseFindings, clauseLabel, displayMetric, readout, referenceReleaseReady, reviewChanges, riskFindings, severityGap } from '../lib/inspection.ts';

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

test('clause labels keep legal acronyms readable', () => {
  assert.equal(clauseLabel('ip_and_model_training'), 'IP and model training');
  assert.equal(clauseLabel('breach_and_dpia_assistance'), 'Breach and DPIA assistance');
  assert.equal(clauseLabel('governing_law'), 'Governing law');
});

test('severity gaps record the direction of a mismatch', () => {
  assert.equal(severityGap('high', 'low'), -2);
  assert.equal(severityGap('medium', 'high'), 1);
  assert.equal(severityGap('low', 'low'), 0);
  assert.equal(severityGap(undefined, 'low'), 0);
});

test('risk findings resolve aliases the same way the scorer does', () => {
  const review = { ...item.review, risk_flags: [{ clause_type: 'residuals', severity: 'high', rationale: '' }] };
  const scores = scoreReview(item.source, item.gold, review);
  const rows = riskFindings(item.gold, review, scores);
  assert.equal(rows.find(row => row.key === 'residual_knowledge').status, 'Match');
  assert.ok(!rows.some(row => row.key === 'residuals'));
  assert.equal(scores.risk_false_positives.length, 0);
});

test('risk findings mark conflicts and keep every supplied severity', () => {
  const review = applyScenario(item.review, 'conflicting-flags');
  const rows = riskFindings(item.gold, review, scoreReview(item.source, item.gold, review));
  const conflict = rows.find(row => row.status === 'Conflict');
  assert.deepEqual(conflict.severities, ['high', 'low']);
  assert.equal(conflict.predicted, 'high');
});

test('readout explains the NDA fixture in reviewer order', () => {
  const points = readout(item.gold, item.review, scoreReview(item.source, item.gold, item.review));
  assert.deepEqual(points.map(point => point.title), [
    'Found 5 of 6 reference risks',
    '3 of 5 severities match the reference',
    '1 extra flag',
    '8 of 9 quotations located in the contract',
    'Identified 11 of 11 expected clauses',
  ]);
  assert.equal(points[0].detail, 'Missed: Notices (low).');
  assert.equal(points[1].detail, 'Under-rated: Assignment (high → low), Permitted disclosure (high → medium).');
  assert.deepEqual(points[1].findings, ['assignment', 'permitted_disclosure']);
  assert.equal(points[2].detail, 'Not a reference risk: Governing law (low).');
  assert.match(points[3].detail, /^1 quotation could not be found in the source\. Quotations reach 8 of 11 reference clauses\.$/);
  assert.equal(points[4].tone, 'info');
});

test('readout states plainly when a scenario removes flags or evidence', () => {
  const noFlags = applyScenario(item.review, 'missed-risks');
  const flagPoints = readout(item.gold, noFlags, scoreReview(item.source, item.gold, noFlags));
  assert.equal(flagPoints[0].title, 'No risks flagged');
  assert.ok(!flagPoints.some(point => /severit|extra/.test(point.title)));
  const noQuotes = applyScenario(item.review, 'no-evidence');
  const quotePoints = readout(item.gold, noQuotes, scoreReview(item.source, item.gold, noQuotes));
  assert.ok(quotePoints.some(point => point.title === 'No quotations supplied' && point.tone === 'issue'));
  const conflicting = applyScenario(item.review, 'conflicting-flags');
  const conflictPoints = readout(item.gold, conflicting, scoreReview(item.source, item.gold, conflicting));
  assert.ok(conflictPoints.some(point => point.title === '1 extra flag and 1 contradictory severity'));
});

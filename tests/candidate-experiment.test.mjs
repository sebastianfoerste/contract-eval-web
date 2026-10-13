import test from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COMPARED_METRICS, EMPTY_SLOT_SHA256, NO_RECORDING, declaredRepairs, verifyExperimentBundle, experimentFileText, twoDecimals} from '../lib/candidate-experiment.ts';
import {canonicalRecording} from '../lib/candidate-replay.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
// One bundle directory: experiment.json, report.json, provenance.json and the registered files.
const bundleAt = directory => {
  const file = name => readFileSync(new URL(name, directory));
  const json = name => JSON.parse(file(name));
  // A fresh bundle per call, read from the files: every tamper starts from the real bytes.
  // An empty slot file is a dispatch that left no recording. It holds nothing to parse, so a bundle
  // has no entry for it, exactly as the page cannot import it.
  const load = () => {
    const experiment = json('experiment.json');
    return {
      experimentText: file('experiment.json').toString('utf8'), report: json('report.json'), provenance: json('provenance.json'),
      attempts: Object.fromEntries(experiment.attempts.filter(slot => slot.sha256 !== null && file(slot.file).length > 0).map(slot => [slot.file, json(slot.file)])),
      references: Object.fromEntries(experiment.references.map(reference => [reference.file, json(reference.file)])),
    };
  };
  return {directory, file, json, load};
};
// The committed example: the zero-cost dry run, exported from the harness.
const id = 'replay-dry-run', dryRun = bundleAt(new URL(`../public/candidates/experiments/${id}/`, import.meta.url));
// A second bundle for the tests only. The harness aggregated it from synthetic recordings and references in a
// temporary copy of its corpus (tests/fixtures/candidate-experiment/README.md). It is no model result.
const fixtureId = 'synthetic-live-fixture', synthetic = bundleAt(new URL(`./fixtures/candidate-experiment/${fixtureId}/`, import.meta.url));
// A third bundle, built the same way: one settled LIVE arm in which three slot files are empty, as a dispatch
// leaves them that produced no recording, and two completed attempts that both returned nothing.
const lostId = 'synthetic-lost-dispatch-fixture', lost = bundleAt(new URL(`./fixtures/candidate-experiment/${lostId}/`, import.meta.url));
const lostFile = 'attempts/baseline/dora-base-r1.json', recordedBeside = 'attempts/baseline/dora-base-r2.json';
const {file, json, load} = dryRun;
const attemptFile = 'attempts/baseline/commercial-base-r1.json';

const editExperiment = (bundle, change) => {
  const experiment = JSON.parse(bundle.experimentText);
  change(experiment);
  bundle.experimentText = experimentFileText(experiment);
  return bundle;
};
// Re-binds the hashes a tamper would otherwise trip first, so the check under test is the one that refuses.
const rebind = bundle => {
  bundle.report.experimentSha256 = bundle.provenance.files['experiment.json'] = hash(bundle.experimentText);
  // A row without a bundled recording keeps what it states: a dispatch that left no recording has no hash to re-bind.
  for (const cell of bundle.report.cells) for (const row of cell.attempts) if (Object.hasOwn(bundle.attempts, row.file)) row.recordingSha256 = hash(canonicalRecording(bundle.attempts[row.file]));
  return bundle;
};
// Re-binds the registered hash of every bundled reference to the file as it now reads, in the experiment file, the
// report and the provenance file, so that a check behind the hash binding is the one that refuses.
const rebindReferences = bundle => editExperiment(bundle, experiment => {
  for (const slot of experiment.references) {
    slot.sha256 = bundle.provenance.files[slot.file] = bundle.report.references[`${slot.playbook}/${slot.variant}`].sha256 = hash(experimentFileText(bundle.references[slot.file]));
  }
}) && rebind(bundle);
const refused = (bundle, reason) => assert.rejects(verifyExperimentBundle(bundle), reason);
// The cell of the synthetic fixture for one arm, playbook and variant.
const cellOf = (bundle, arm, playbook, variant) => bundle.report.cells.find(cell => cell.arm === arm && cell.playbook === playbook && cell.variant === variant);
// Applies one change to a fresh copy of a fixture, the synthetic one unless another is named, and expects the stated refusal.
const tampered = async (reason, change, from = synthetic) => {
  const bundle = from.load();
  change(bundle);
  await refused(bundle, reason);
};

test('the exported dry run verifies and keeps the denominators the harness reported', async () => {
  const {experiment, report, attempts} = await verifyExperimentBundle(load());
  assert.equal(experiment.experimentId, id);
  assert.equal(experiment.design.mode, 'REPLAY');
  assert.equal(report.cells.length, 6);
  assert.deepEqual(report.cells.map(cell => [cell.summary.planned, cell.summary.observed, cell.summary.missingObservations]), [[2, 1, 1], [2, 0, 2], [2, 0, 2], [2, 0, 2], [2, 0, 2], [2, 0, 2]]);
  const summary = report.cells[0].summary;
  assert.deepEqual([summary.completed, summary.allFindingsValid, summary.recorderAccepted, summary.recorderRejected, summary.findings, summary.duplicates, summary.trivialQuotations], [1, 0, 0, 1, 4, 1, 0]);
  assert.deepEqual([summary.quotationValid, summary.quotationDenominator, summary.playbookReferenceValid], [3, 3, 3]);
  // One hand-authored attempt, eleven attempts not run, no reference, no comparison and no ledger: no model result.
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].recording.run.model, 'hand-authored-replay-fixture');
  assert.equal(report.notRun.length, 11);
  assert.deepEqual(report.references, {});
  assert.deepEqual(report.comparisons, []);
  assert.equal(report.ledger, null);
  assert.deepEqual([summary.issueMatch, summary.issueMatchPostValidation, summary.entryLevelMatch], [null, null, null]);
  // A cell without observations states no rate at all; the viewer shows N/A, never 0 percent.
  const empty = report.cells[1].summary;
  assert.deepEqual([empty.quotationValidityRate, empty.playbookValidityRate, empty.duplicateRate, empty.usage.inputTokens, empty.usage.outputTokens], [null, null, null, null, null]);
  // The injection and repair blocks exist where the design declares them, also without an attempt.
  assert.deepEqual(report.cells.map(cell => [cell.summary.injection !== undefined, cell.summary.repair !== undefined]), [[false, false], [false, false], [true, false], [false, false], [false, true], [true, false]]);
  assert.deepEqual(Object.keys(report.rules), ['matching', 'postValidation', 'entryLevel', 'injection', 'repair']);
});

test('the synthetic fixture verifies and is labelled as test material, not as a model result', async () => {
  const {experiment, report, provenance, attempts} = await verifyExperimentBundle(synthetic.load());
  assert.equal(experiment.experimentId, fixtureId);
  assert.match(experiment.notes, /Synthetic test fixture.*No model was called.*Not a model result/);
  assert.match(provenance.scope, /Synthetic test fixture.*No model was called.*nothing here is a model result/);
  assert.deepEqual(experiment.arms.map(arm => arm.model), ['synthetic-fixture-not-a-model', 'synthetic-fixture-not-a-model']);
  // What the harness aggregated: a LIVE design, two arms, six DRAFT references, a settled and an open reservation.
  assert.deepEqual([experiment.design.mode, experiment.arms.length, report.cells.length, report.comparisons.length, attempts.length, report.notRun.length], ['LIVE', 2, 12, 6, 17, 7]);
  assert.deepEqual(Object.values(report.references).map(reference => [reference.status, reference.route, reference.derivationVerified, reference.independentReviewClaimVerified]), Array(6).fill(['DRAFT', 'SINGLE_ANNOTATION', false, false]));
  assert.deepEqual([report.references['commercial/base'].lowConfidenceIssues, report.references['commercial/base'].uncertaintiesRecorded, report.references['commercial/changed'].expectedIssues], [1, true, 0]);
  assert.deepEqual([report.ledger.baseline.state, report.ledger.baseline.settledMinorUnits === null, report.ledger.iteration.state, report.ledger.iteration.settledMinorUnits], ['SETTLED', false, 'OPEN', null]);
  assert.deepEqual(new Set(attempts.map(attempt => attempt.row.outcome)), new Set(['COMPLETED', 'REFUSED', 'FAILED']));
  assert.ok(attempts.some(attempt => attempt.row.usage !== null) && attempts.some(attempt => attempt.row.usage === null));
  // Issue matching counts every observed attempt: the refused attempt of dora/base misses all three expected issues.
  const refusedRow = cellOf({report}, 'baseline', 'dora', 'base').attempts[0];
  assert.deepEqual([refusedRow.outcome, refusedRow.issueMatch], ['REFUSED', {truePositives: 0, falsePositives: 0, falseNegatives: 3}]);
  // A rate is absent exactly where its denominator is zero: a failed attempt alone has no precision, and its recall is a real 0.
  const failedOnly = cellOf({report}, 'baseline', 'dora', 'injection').summary.issueMatch;
  assert.deepEqual([failedOnly.microPrecision, failedOnly.microRecall], [null, 0]);
  const nothingExpected = cellOf({report}, 'iteration', 'commercial', 'changed').summary.issueMatch;
  assert.deepEqual([nothingExpected.microPrecision, nothingExpected.microRecall], [0, null]);
  // The comparison states a metric only where both cells state the value.
  assert.deepEqual(report.comparisons.map(item => item.comparable ? Object.keys(item.metrics).length : item.reason), [9, 1, 9, 9, 9, 'both arms need at least one completed attempt on these inputs']);
  assert.deepEqual(Object.keys(report.comparisons[0].metrics), [...COMPARED_METRICS]);
  // Blocks the page shows only where they apply.
  assert.deepEqual(cellOf({report}, 'baseline', 'commercial', 'injection').summary.injection, {completedAttempts: 2, followedInjection: 1, appendixQuoted: 1});
  assert.deepEqual(cellOf({report}, 'baseline', 'dora', 'changed').summary.repair, {repairedEntries: ['DORA-LOCATIONS'], completedAttempts: 2, staleFindings: 2});
  assert.equal(cellOf({report}, 'baseline', 'commercial', 'changed').summary.repair, undefined);
  assert.deepEqual([cellOf({report}, 'baseline', 'dora', 'base').summary.validationDisagreements, cellOf({report}, 'baseline', 'dora', 'changed').summary.identicalOutputRepetitions], [1, 1]);
  // No route serves the fixture: it lies outside public/ and the page does not import it.
  assert.ok(!readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8').includes(fixtureId));
  assert.match(readFileSync(new URL('./fixtures/candidate-experiment/README.md', import.meta.url), 'utf8'), /synthetic test material .* It is not a model result/);
});

test('the lost-dispatch fixture verifies: an empty slot file is a failed attempt without a recording', async () => {
  const {experiment, report, provenance, attempts} = await verifyExperimentBundle(lost.load());
  assert.equal(experiment.experimentId, lostId);
  assert.match(experiment.notes, /Synthetic test fixture.*No model was called, no call was dispatched.*Not a model result/);
  assert.match(provenance.scope, /Synthetic test fixture.*No model was called, no call was dispatched.*nothing here is a model result/);
  assert.equal(experiment.arms[0].model, 'synthetic-fixture-not-a-model');
  // Six slots, all registered. Three are empty files, registered under the SHA-256 of zero bytes.
  assert.equal(hash(''), EMPTY_SLOT_SHA256);
  const empty = experiment.attempts.filter(slot => slot.sha256 === EMPTY_SLOT_SHA256).map(slot => slot.file);
  assert.deepEqual(empty, [lostFile, 'attempts/baseline/dora-changed-r1.json', 'attempts/baseline/dora-changed-r2.json']);
  for (const name of empty) assert.equal(lost.file(name).length, 0, name);
  assert.deepEqual([experiment.design.mode, experiment.attempts.length, attempts.length, report.notRun.length], ['LIVE', 6, 6, 0]);
  // The verifier hands the page a recording or null, never a row that only looks recorded.
  assert.deepEqual(attempts.map(attempt => attempt.recording === null), [true, false, true, true, false, false]);
  assert.deepEqual(attempts.filter(attempt => attempt.recording === null).map(attempt => attempt.row.file), empty);
  // The row the harness writes: no hash, start, duration or usage, a failed attempt that found nothing and
  // misses each of the three issues its reference expects.
  const missed = {truePositives: 0, falsePositives: 0, falseNegatives: 3};
  assert.deepEqual(attempts[0].row, {
    repetition: 1, file: lostFile, recordingSha256: null, findingsSha256: null, startedAt: null, elapsedMs: null,
    outcome: 'FAILED', recorderValidation: 'NO_OUTPUT', recorderValidationError: NO_RECORDING, allFindingsValid: false,
    findingCount: 0, duplicateCount: 0, trivialQuotationCount: 0, quotationValid: 0, quotationDenominator: 0,
    missingClauseValid: 0, missingClauseDenominator: 0, playbookReferenceValid: 0, issueMatch: missed, entryLevelMatch: missed, usage: null,
  });
  // Beside a completed attempt it is observed and failed, and the cell misses its three issues once more: 2 of 6.
  const base = cellOf({report}, 'baseline', 'dora', 'base').summary;
  assert.deepEqual([base.planned, base.observed, base.missingObservations, base.completed, base.failed], [2, 2, 0, 1, 1]);
  assert.deepEqual([base.issueMatch.truePositives, base.issueMatch.falseNegatives, base.issueMatch.attempts, base.usage.attemptsWithUsage], [2, 4, 2, 1]);
  // Two dispatches without a recording in one cell are two attempts. Neither is a completed attempt, so the
  // repair block counts none, and no finding repeats.
  const changed = cellOf({report}, 'baseline', 'dora', 'changed');
  assert.deepEqual(changed.attempts.map(row => [row.recordingSha256, row.staleFindings, row.issueMatch.falseNegatives]), [[null, 0, 2], [null, 0, 2]]);
  assert.deepEqual([changed.summary.observed, changed.summary.failed, changed.summary.identicalOutputRepetitions, changed.summary.completionRate], [2, 2, 0, 0]);
  assert.deepEqual([changed.summary.issueMatch.microPrecision, changed.summary.issueMatch.microRecall, changed.summary.usage.inputTokens], [null, 0, null]);
  assert.deepEqual(changed.summary.repair, {repairedEntries: ['DORA-LOCATIONS'], completedAttempts: 0, staleFindings: 0});
  // Two completed attempts that both returned nothing are not the same findings twice.
  const injection = cellOf({report}, 'baseline', 'dora', 'injection');
  assert.deepEqual(injection.attempts.map(row => [row.outcome, row.findingCount, row.findingsSha256 === injection.attempts[0].findingsSha256]), [['COMPLETED', 0, true], ['COMPLETED', 0, true]]);
  assert.deepEqual([injection.summary.completed, injection.summary.identicalOutputRepetitions], [2, 0]);
  assert.deepEqual(injection.summary.injection, {completedAttempts: 2, followedInjection: 2, appendixQuoted: 0});
  // The harness counts the inputs of the recordings: no recording exists for the changed document.
  assert.equal(report.distinctInputKeys, 2);
  // The arm is settled. The report states the amount; the ledger itself stays in the harness.
  assert.deepEqual([report.ledger.baseline.state, report.ledger.baseline.reservedMinorUnits, report.ledger.baseline.settledMinorUnits], ['SETTLED', 240, 86]);
  // Caveats the harness writes only where they apply. The page shows every caveat as unchanged source text.
  assert.ok(report.caveats.includes('3 dispatched attempts left no recording. Each is counted as a failed attempt that found nothing and is settled at its full hold, because its call may have been billed.'));
  assert.ok(report.caveats.includes('The reference for dora/injection was annotated by someone who had already seen model output for this agreement; it is not a blind reading.'));
  for (const bundle of [dryRun, synthetic]) assert.ok(!bundle.json('report.json').caveats.some(caveat => /left no recording|had already seen model output/.test(caveat)));
  // No route serves this fixture either.
  assert.ok(!readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8').includes(lostId));
});

test('a dispatch without a recording is stated by the experiment file, the report and the bundle alike, or refused', async () => {
  const row = bundle => cellOf(bundle, 'baseline', 'dora', 'base').attempts[0];
  const oneSided = file => new RegExp(`attempt ${file.replaceAll('.', '\\.')} is a dispatch without a recording in only one of the experiment file and the report`);
  // The report gives the empty slot a recording hash, or the experiment file registers another hash for the slot.
  await tampered(oneSided(lostFile), bundle => { row(bundle).recordingSha256 = hash('a recording that does not exist'); }, lost);
  await refused(rebind(editExperiment(lost.load(), experiment => { experiment.attempts[0].sha256 = hash('a recording that does not exist'); })), oneSided(lostFile));
  // The report turns a recorded attempt into a dispatch without a recording: its slot file is not empty.
  await tampered(oneSided('attempts/baseline/dora-base-r1.json'), bundle => {
    const target = cellOf(bundle, 'baseline', 'dora', 'base');
    Object.assign(target.attempts[0], {recordingSha256: null, findingsSha256: null, startedAt: null, elapsedMs: null, usage: null, outcome: 'FAILED', recorderValidation: 'NO_OUTPUT', recorderValidationError: NO_RECORDING});
    delete bundle.attempts['attempts/baseline/dora-base-r1.json'];
  });
  // The row is the one the harness writes: nothing about the call is stated, because nothing was retained.
  const shape = /report row for attempts\/baseline\/dora-base-r1\.json is not the row the harness writes for a dispatch that left no recording/;
  for (const change of [
    {startedAt: '2026-10-12T15:01:00.000Z'}, {elapsedMs: 0}, {findingsSha256: hash('[]')},
    {usage: {inputTokens: 10, outputTokens: 5, cacheReadTokens: null, thinkingTokens: null, providerRequestId: null}},
    {outcome: 'REFUSED'}, {outcome: 'COMPLETED'}, {recorderValidation: 'REJECTED'}, {recorderValidationError: null},
    {recorderValidationError: 'SYNTHETIC_TEST_NO_OUTPUT'}, {allFindingsValid: true}, {findingCount: 1},
  ]) await tampered(shape, bundle => { Object.assign(row(bundle), change); }, lost);
  // It found nothing and misses every expected issue; the same checks hold it as every other attempt row.
  const matching = /cell baseline\/dora\/base states issue matching that its reference and attempts do not support/;
  await tampered(matching, bundle => { row(bundle).issueMatch.falseNegatives = 2; cellOf(bundle, 'baseline', 'dora', 'base').summary.issueMatch.falseNegatives -= 1; }, lost);
  await tampered(matching, bundle => { row(bundle).issueMatch = null; }, lost);
  await tampered(matching, bundle => { Object.assign(row(bundle).entryLevelMatch, {truePositives: 1, falseNegatives: 2}); }, lost);
  await tampered(/lists attempt attempts\/baseline\/dora-base-r1\.json with counts that contradict each other/, bundle => { row(bundle).playbookReferenceValid = 1; }, lost);
  await tampered(/cell baseline\/dora\/changed states a repair block that its design, playbook and attempts do not support/, bundle => { cellOf(bundle, 'baseline', 'dora', 'changed').attempts[0].staleFindings = 1; }, lost);
  // The bundle holds no recording for the slot, and the provenance file lists the empty file under its hash.
  await tampered(/bundle holds a recording for attempts\/baseline\/dora-base-r1\.json, although its dispatch left none/, bundle => { bundle.attempts[lostFile] = bundle.attempts[recordedBeside]; }, lost);
  await tampered(/provenance file describes a different bundle/, bundle => { delete bundle.provenance.files[lostFile]; }, lost);
  await tampered(/provenance file describes a different bundle/, bundle => { bundle.provenance.files[lostFile] = hash('not empty'); }, lost);
  // It is an observed attempt: neither missing from the report nor listed as not run.
  await tampered(/registered, reported and bundled attempt files do not match/, bundle => {
    const target = cellOf(bundle, 'baseline', 'dora', 'base');
    target.attempts.shift();
    Object.assign(target.summary, {observed: 1, missingObservations: 1, failed: 0});
  }, lost);
  await tampered(/attempts the report lists as not run are not the unregistered slots/, bundle => { bundle.report.notRun.push(lostFile); }, lost);
  await tampered(/cell baseline\/dora\/base states attempt counts that do not agree with its attempts/, bundle => { Object.assign(cellOf(bundle, 'baseline', 'dora', 'base').summary, {failed: 0}); }, lost);
  // The call may have been billed, so the arm needs its reservation like an arm with recordings.
  await tampered(/arm baseline has attempts without an open or settled budget reservation/, bundle => { Object.assign(bundle.report.ledger.baseline, {state: 'VOIDED', settledMinorUnits: null}); }, lost);
  // Only a LIVE dispatch leaves an empty slot. The dry run with its one attempt relabelled is no harness output.
  const replayed = editExperiment(load(), experiment => { experiment.attempts[0].sha256 = EMPTY_SLOT_SHA256; });
  delete replayed.attempts[attemptFile];
  Object.assign(replayed.report.cells[0].attempts[0], {recordingSha256: null, findingsSha256: null, startedAt: null, elapsedMs: null, usage: null, outcome: 'FAILED', recorderValidation: 'NO_OUTPUT', recorderValidationError: NO_RECORDING, allFindingsValid: false, findingCount: 0});
  await refused(rebind(replayed), /attempt attempts\/baseline\/commercial-base-r1\.json has an empty slot file or a row without a recording, which only a LIVE dispatch leaves/);
});

test('attempts that returned nothing are not counted as identical outputs or as distinct inputs', async () => {
  const sums = where => new RegExp(`cell ${where} states a count that differs from the sum of its attempts`);
  // Two completed attempts without a finding carry the same findings hash, and two dispatches without a recording carry none.
  await tampered(sums('baseline/dora/injection'), bundle => { cellOf(bundle, 'baseline', 'dora', 'injection').summary.identicalOutputRepetitions = 1; }, lost);
  await tampered(sums('baseline/dora/changed'), bundle => { cellOf(bundle, 'baseline', 'dora', 'changed').summary.identicalOutputRepetitions = 1; }, lost);
  // The same findings twice, at least one, still count: both repetitions of dora/changed in the other fixture.
  const repeated = cellOf(synthetic.load(), 'baseline', 'dora', 'changed');
  assert.deepEqual([repeated.attempts.map(row => row.findingCount), repeated.attempts[0].findingsSha256 === repeated.attempts[1].findingsSha256, repeated.summary.identicalOutputRepetitions], [[2, 2], true, 1]);
  await tampered(sums('baseline/dora/changed'), bundle => { cellOf(bundle, 'baseline', 'dora', 'changed').summary.identicalOutputRepetitions = 0; });
  // A dispatch without a recording shows no input: counting one for the changed document would state three.
  for (const count of [3, 6, 0]) await tampered(/report states a different number of distinct inputs than the recordings show/, bundle => { bundle.report.distinctInputKeys = count; }, lost);
});

test('the experiment file is rebuilt byte for byte from parsed JSON, so the report hash is checked against the real file', async () => {
  for (const bundle of [dryRun, synthetic, lost]) {
    const bytes = bundle.file('experiment.json'), rebuilt = experimentFileText(JSON.parse(bytes));
    assert.ok(Buffer.from(rebuilt, 'utf8').equals(bytes));
    assert.equal(hash(rebuilt), bundle.json('report.json').experimentSha256);
    // The route the page takes: a parsed import, rebuilt to the file text.
    await verifyExperimentBundle({...bundle.load(), experimentText: rebuilt});
    // The hash covers bytes. The same data in another JSON layout is a different file.
    await refused({...bundle.load(), experimentText: JSON.stringify(JSON.parse(bytes))}, /different experiment file/);
  }
  // Same writer as the harness: python3 json.dumps(value, indent=2, ensure_ascii=False) + "\n" over this
  // value has the SHA-256 below (computed with Python 3.13 on 2026-10-11). Covers escapes, non-ASCII
  // text, the line separator U+2028, empty containers, null and integers up to the safe limit.
  const value = {schema: 'x', notes: 'Prüfung "quoted" back\\slash \n\t\u001f € 😀  ', empty: [], object: {}, nested: [{a: 1, b: null, c: true}, [0, -7, 9007199254740991]], sha256: null};
  assert.equal(hash(experimentFileText(value)), 'a43113757bb7dcd27bb0c6dc999dc47568d715cf378eeddb09e2d63f038e8937');
});

test('provenance hashes match the copied files and the page imports exactly those files', () => {
  for (const bundle of [dryRun, synthetic, lost]) {
    const provenance = bundle.json('provenance.json'), experiment = bundle.json('experiment.json');
    // An empty slot file is copied as it is: zero bytes under the hash the experiment registers for it.
    for (const [name, digest] of Object.entries(provenance.files)) assert.equal(hash(bundle.file(name)), digest, name);
    const onDisk = readdirSync(bundle.directory, {recursive: true}).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.json'));
    assert.deepEqual(onDisk.sort(), [...Object.keys(provenance.files), 'provenance.json'].sort());
    for (const slot of [...experiment.attempts.filter(slot => slot.sha256 !== null), ...experiment.references]) assert.equal(hash(bundle.file(slot.file)), slot.sha256);
    assert.equal(provenance.files['experiment.json'], bundle.json('report.json').experimentSha256);
    assert.match(provenance.harnessHead, /^[a-f0-9]{40}$/);
    assert.deepEqual(Object.keys(provenance.harnessFiles), ['candidate_experiment', 'candidates', 'candidate_annotation', 'candidate_adjudication', 'candidate_budget'].map(name => `src/contract_eval/${name}.py`));
  }
  const provenance = json('provenance.json'), experiment = json('experiment.json');
  const registered = experiment.attempts.filter(slot => slot.sha256 !== null), emptySlots = registered.filter(slot => slot.sha256 === EMPTY_SLOT_SHA256).map(slot => slot.file);
  const recordings = registered.filter(slot => slot.sha256 !== EMPTY_SLOT_SHA256).map(slot => slot.file);
  assert.deepEqual([recordings, emptySlots], [[attemptFile], []]);
  assert.match(provenance.scope, /no model was called/);
  // The page imports every file the verifier reads: each recording, and never the empty slot file of a dispatch that left
  // no recording, which is no JSON. Source files of a reference are downloads, bound by their hashes above.
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  for (const name of ['experiment.json', 'report.json', 'provenance.json', ...recordings, ...experiment.references.map(slot => slot.file)]) assert.ok(page.includes(`'@/public/candidates/experiments/${id}/${name}'`), `page does not import ${name}`);
  for (const name of emptySlots) assert.ok(!page.includes(`'@/public/candidates/experiments/${id}/${name}'`), `page imports the empty slot file ${name}`);
});

test('a changed finding inside an attempt recording is refused', async () => {
  const changed = load();
  changed.attempts[attemptFile].findings[0].explanation += ' Changed.';
  await refused(changed, /does not have the digest its report row states/);
  const removed = load();
  removed.attempts[attemptFile].findings.pop();
  await refused(removed, /does not have the digest its report row states/);
  await tampered(/recording attempts\/iteration\/dora-changed-r1\.json does not have the digest its report row states/, bundle => { bundle.attempts['attempts/iteration/dora-changed-r1.json'].findings[0].playbookReference = 'DORA-LOCATIONS'; });
  // With the recording digest re-bound, the finding fingerprint of the row still names the original findings.
  const fingerprint = synthetic.load();
  fingerprint.attempts['attempts/iteration/dora-changed-r1.json'].findings[0].explanation += ' Changed.';
  await refused(rebind(fingerprint), /report row for attempts\/iteration\/dora-changed-r1\.json differs from its recording/);
});

test('a changed count in a cell summary is refused', async () => {
  const counts = /cell baseline\/commercial\/base states attempt counts that do not agree with its attempts/;
  const sums = /cell baseline\/commercial\/base states a count that differs from the sum of its attempts/;
  for (const [key, value, reason] of [
    ['planned', 3, counts], ['observed', 2, counts], ['missingObservations', 0, counts], ['completed', 0, counts], ['refused', 1, counts], ['failed', 1, counts],
    ['allFindingsValid', 1, sums], ['recorderAccepted', 1, sums], ['recorderRejected', 0, sums], ['validationDisagreements', 1, sums],
    ['findings', 5, sums], ['duplicates', 0, sums], ['trivialQuotations', 1, sums], ['quotationValid', 2, sums], ['quotationDenominator', 4, sums],
    ['missingClauseValid', 0, sums], ['missingClauseDenominator', 2, sums], ['playbookReferenceValid', 4, sums], ['identicalOutputRepetitions', 1, sums],
  ]) {
    const bundle = load();
    bundle.report.cells[0].summary[key] = value;
    await refused(bundle, reason);
  }
  // The same counts in a cell with two attempts, one of them without output.
  for (const [key, value] of [['observed', 1], ['completed', 2], ['refused', 0], ['allFindingsValid', 2], ['recorderRejected', 0], ['validationDisagreements', 0], ['findings', 4], ['quotationValid', 1], ['playbookReferenceValid', 2]]) {
    await tampered(/cell baseline\/dora\/base states (attempt counts that do not agree with its attempts|a count that differs from the sum of its attempts)/, bundle => { cellOf(bundle, 'baseline', 'dora', 'base').summary[key] = value; });
  }
  await tampered(/cell baseline\/dora\/changed states a count that differs from the sum of its attempts/, bundle => { cellOf(bundle, 'baseline', 'dora', 'changed').summary.identicalOutputRepetitions = 0; });
  await tampered(/cell baseline\/commercial\/base states a count that differs from the sum of its attempts/, bundle => { cellOf(bundle, 'baseline', 'commercial', 'base').summary.trivialQuotations = 0; });
  // Usage totals cover the attempts that reported usage and are null, never 0, when none did.
  const usage = load();
  usage.report.cells[0].summary.usage.inputTokens = 0;
  await refused(usage, sums);
  for (const change of [usage => { usage.inputTokens += 1; }, usage => { usage.outputTokens = null; }, usage => { usage.attemptsWithUsage = 2; }]) {
    await tampered(/cell baseline\/dora\/base states a count that differs from the sum of its attempts/, bundle => change(cellOf(bundle, 'baseline', 'dora', 'base').summary.usage));
  }
  // A rate where the harness states none would let a missing denominator read as 0 percent.
  const rate = load();
  rate.report.cells[1].summary.quotationValidityRate = 0;
  await refused(rate, /cell baseline\/commercial\/changed states a rate or count without its denominator/);
  await tampered(/cell baseline\/commercial\/changed states a rate or count without its denominator/, bundle => { cellOf(bundle, 'baseline', 'commercial', 'changed').summary.duplicateRate = 0; });
  await tampered(/cell baseline\/commercial\/base states a rate or count without its denominator/, bundle => { cellOf(bundle, 'baseline', 'commercial', 'base').summary.playbookValidityRate = null; });
  await tampered(/report does not match its schema at cells\.0\.summary\.completionRate/, bundle => { bundle.report.cells[0].summary.completionRate = null; });
  // One attempt row cannot contradict itself: all findings valid although one playbook reference is not.
  const row = load(), cell = row.report.cells[0];
  cell.attempts[0].allFindingsValid = true;
  cell.summary.allFindingsValid = 1;
  await refused(row, /cell baseline\/commercial\/base lists attempt attempts\/baseline\/commercial-base-r1\.json with counts that contradict each other/);
  await tampered(/lists attempt attempts\/baseline\/dora-base-r1\.json with counts that contradict each other/, bundle => {
    // A refused attempt has no output, so none of its findings can be valid.
    const target = cellOf(bundle, 'baseline', 'dora', 'base');
    target.attempts[0].allFindingsValid = true;
    target.summary.allFindingsValid += 1;
  });
});

test('an attempt moved to another slot is refused', async () => {
  // The report lists the recording under the neighbouring cell; both summaries move with it, so each cell stays consistent.
  const moved = load(), [from, to] = moved.report.cells;
  [from.summary, to.summary, to.attempts, from.attempts] = [to.summary, from.summary, from.attempts, []];
  await refused(moved, /not in the slot the experiment assigns to it/);
  const repetition = load();
  repetition.report.cells[0].attempts[0].repetition = 2;
  await refused(repetition, /not in the slot the experiment assigns to it/);
  // The recording is filed under another slot's name.
  const renamed = load();
  renamed.attempts = {'attempts/baseline/dora-base-r1.json': renamed.attempts[attemptFile]};
  await refused(renamed, /no recording for attempts\/baseline\/commercial-base-r1\.json/);
  // A second copy under an unregistered slot.
  const extra = load();
  extra.attempts['attempts/baseline/dora-base-r1.json'] = extra.attempts[attemptFile];
  await refused(extra, /registered, reported and bundled attempt files do not match/);
  // The attempts of one arm listed under the other arm, in the same playbook and variant.
  await tampered(/attempt attempts\/iteration\/commercial-base-r1\.json is not in the slot the experiment assigns to it/, bundle => {
    const baseline = cellOf(bundle, 'baseline', 'commercial', 'base'), iteration = cellOf(bundle, 'iteration', 'commercial', 'base');
    [baseline.summary, iteration.summary, baseline.attempts, iteration.attempts] = [iteration.summary, baseline.summary, iteration.attempts, baseline.attempts];
  });
  // One recording reported in two slots.
  await tampered(/attempt attempts\/baseline\/dora-changed-r2\.json or its recording is reported twice/, bundle => {
    const rows = cellOf(bundle, 'baseline', 'dora', 'changed').attempts;
    rows[1].recordingSha256 = rows[0].recordingSha256;
  });
  // The slots are exactly what the design and the arms imply: none removed, none pointed elsewhere.
  for (const change of [experiment => experiment.attempts.pop(), experiment => { experiment.attempts[1].file = 'attempts/baseline/elsewhere.json'; }, experiment => { experiment.attempts[1].repetition = 3; }]) {
    await refused(rebind(editExperiment(load(), change)), /attempt slots are not exactly what the design and the arms imply/);
  }
});

test('a report bound to a different experiment is refused', async () => {
  await refused(editExperiment(load(), experiment => { experiment.notes = 'Another experiment.'; }), /different experiment file/);
  const hashed = load();
  hashed.report.experimentSha256 = hash('another experiment');
  await refused(hashed, /different experiment file/);
  // Hash re-bound, yet the report still describes another design or another arm.
  await refused(rebind(editExperiment(load(), experiment => { experiment.design.repetitions = 3; })), /different experiment, design or arms/);
  await refused(rebind(editExperiment(load(), experiment => { experiment.design.repairedEntries = {}; })), /different experiment, design or arms/);
  await refused(rebind(editExperiment(load(), experiment => { experiment.arms[0].promptVersion = 'contracts/candidates/other'; })), /different experiment, design or arms/);
  // A hypothesis rewritten or a reservation swapped after the report was written.
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.arms[1].hypothesis = 'Another hypothesis.'; })), /different experiment, design or arms/);
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.arms[0].budgetReservation.amountMinorUnits = 1; })), /different experiment, design or arms/);
});

test('an unknown schema is refused', async () => {
  await refused(rebind(editExperiment(load(), experiment => { experiment.schema = 'mycounsel.candidate-experiment.v2'; })), /experiment file does not match its schema at schema/);
  const report = load();
  report.report.schema = 'mycounsel.candidate-experiment-report.v2';
  await refused(report, /report does not match its schema at schema/);
  const recording = load();
  recording.attempts[attemptFile].schema = 'mycounsel.candidate-run.v2';
  await refused(rebind(recording), /recording .* does not match its schema at schema/);
  const provenance = load();
  provenance.provenance.schema = 'evidence-lab.candidate-bundle.v1';
  await refused(provenance, /provenance file does not match its schema at schema/);
  await tampered(/reference references\/dora-base\.json does not match its schema at schema/, bundle => { bundle.references['references/dora-base.json'].schema = 'mycounsel.candidate-reference.v2'; });
  // The report shape of the export this viewer was first built for: its field names are gone, and an unknown field stops the page.
  const earlier = load();
  earlier.report.missingAttemptFiles = earlier.report.notRun;
  await refused(earlier, /report does not match its schema at the top level/);
  const validation = load();
  validation.report.cells[0].summary.validationRejected = 1;
  await refused(validation, /report does not match its schema at cells\.0\.summary/);
  const rule = load();
  delete rule.report.rules.repair;
  await refused(rule, /report does not match its schema at rules\.repair/);
});

test('a removed, repeated or reordered cell is refused', async () => {
  for (const bundle of [dryRun, synthetic]) {
    for (const change of [cells => cells.pop(), cells => cells.shift(), cells => cells.push(cells[5]), cells => cells.reverse()]) {
      const tamper = bundle.load();
      change(tamper.report.cells);
      await refused(tamper, /cells do not cover exactly arms x playbooks x variants/);
    }
  }
});

test('an attempt with another mode is refused', async () => {
  const live = load();
  live.attempts[attemptFile].run.mode = 'LIVE';
  await refused(live, /does not have the digest its report row states/);
  await refused(rebind(live), /ran in LIVE, the design is REPLAY/);
  const replayed = synthetic.load();
  replayed.attempts['attempts/baseline/dora-base-r2.json'].run.mode = 'REPLAY';
  await refused(rebind(replayed), /recording attempts\/baseline\/dora-base-r2\.json ran in REPLAY, the design is LIVE/);
  await refused(rebind(editExperiment(load(), experiment => { experiment.design.mode = 'DRY_RUN'; })), /experiment file does not match its schema at design\.mode/);
});

test('a REPLAY report states that no model was called: fixture arms only, and no ledger block', async () => {
  const model = editExperiment(load(), experiment => { experiment.arms[0].model = 'some-model'; });
  model.report.arms[0].model = model.attempts[attemptFile].run.model = 'some-model';
  await refused(rebind(model), /a REPLAY arm is not the hand-authored fixture this viewer describes/);
  // A design relabelled LIVE needs a ledger block and LIVE recordings.
  const relabelled = rebind(editExperiment(load(), experiment => { experiment.design.mode = 'LIVE'; }));
  relabelled.report.design.mode = 'LIVE';
  await refused(relabelled, /ledger block of a LIVE report does not name exactly the arms of the experiment/);
  relabelled.report.ledger = {baseline: null};
  await refused(relabelled, /ran in REPLAY, the design is LIVE/);
  for (const ledger of [{baseline: null}, {}, {baseline: {reservation: 'res-test', reservedAt: '2026-10-12T09:00:00Z', reservedMinorUnits: 80, priceVerifiedOn: '2026-10-10', state: 'OPEN', settledMinorUnits: null}}]) {
    const bundle = load();
    bundle.report.ledger = ledger;
    await refused(bundle, /a REPLAY report carries a ledger block, although a REPLAY experiment reserves no budget/);
  }
  const reserved = editExperiment(load(), experiment => { experiment.arms[0].budgetReservation = {ledgerEntryId: 'res-test', recordedAt: '2026-10-12T09:00:00Z', amountMinorUnits: 80, preregistrationSha256: hash('test'), ledgerEntrySha256: hash('test entry')}; });
  reserved.report.arms = JSON.parse(reserved.experimentText).arms;
  await refused(rebind(reserved), /a REPLAY arm carries a budget reservation/);
});

test('a LIVE report carries the reservation of each arm as the experiment file binds it', async () => {
  const ledger = /ledger block of a LIVE report does not name exactly the arms of the experiment/;
  await tampered(ledger, bundle => { bundle.report.ledger = null; });
  await tampered(ledger, bundle => { delete bundle.report.ledger.iteration; });
  await tampered(ledger, bundle => { bundle.report.ledger.another = null; });
  const bound = /ledger state of arm baseline is not the reservation the experiment file binds to it/;
  await tampered(bound, bundle => { bundle.report.ledger.baseline.reservation = 'res-another'; });
  await tampered(bound, bundle => { bundle.report.ledger.baseline.reservedMinorUnits -= 1; });
  await tampered(bound, bundle => { bundle.report.ledger.baseline.reservedAt = '2026-10-12T08:00:00Z'; });
  await tampered(bound, bundle => { bundle.report.ledger.baseline = null; });
  await tampered(/ledger state of arm baseline states a settled amount that does not fit its state/, bundle => { bundle.report.ledger.baseline.settledMinorUnits = null; });
  await tampered(/ledger state of arm iteration states a settled amount that does not fit its state/, bundle => { bundle.report.ledger.iteration.settledMinorUnits = 1; });
  // The harness refuses a voided reservation once attempts exist.
  await tampered(/arm iteration has attempts without an open or settled budget reservation/, bundle => { bundle.report.ledger.iteration.state = 'VOIDED'; });
  await tampered(/report does not match its schema at ledger\.iteration\.state/, bundle => { bundle.report.ledger.iteration.state = 'PAID'; });
  // An arm whose reservation is taken out of the experiment file and the ledger block still has its attempts.
  const unreserved = editExperiment(synthetic.load(), experiment => { experiment.arms[1].budgetReservation = null; });
  unreserved.report.arms = JSON.parse(unreserved.experimentText).arms;
  unreserved.report.ledger.iteration = null;
  await refused(rebind(unreserved), /arm iteration has attempts without an open or settled budget reservation/);
  // The reservation precedes dispatch. The baseline was reserved at 09:00 UTC; instants are compared, not text.
  const startedAt = time => {
    const bundle = synthetic.load();
    assert.equal(bundle.report.ledger.baseline.reservedAt, '2026-10-12T09:00:00Z');
    bundle.attempts['attempts/baseline/dora-base-r2.json'].run.startedAt = cellOf(bundle, 'baseline', 'dora', 'base').attempts[1].startedAt = time;
    return rebind(bundle);
  };
  const early = /attempt attempts\/baseline\/dora-base-r2\.json started before the budget reservation of arm baseline/;
  await refused(startedAt('2026-10-12T08:59:59.999Z'), early);
  await refused(startedAt('2026-10-12T10:30:00+02:00'), early);
  await verifyExperimentBundle(startedAt('2026-10-12T09:00:00Z'));
  await verifyExperimentBundle(startedAt('2026-10-12T11:30:00+02:00'));
});

test('a reservation snapshot carries the hash of its ledger entry, in the experiment file and in the report', async () => {
  // The harness pins the reservation entry as the spend ledger stored it. Both LIVE fixtures carry the hash in both files.
  const keys = ['ledgerEntryId', 'recordedAt', 'amountMinorUnits', 'preregistrationSha256', 'ledgerEntrySha256'];
  for (const bundle of [synthetic, lost]) {
    for (const name of ['experiment.json', 'report.json']) {
      for (const arm of bundle.json(name).arms) {
        assert.deepEqual(Object.keys(arm.budgetReservation), keys, name);
        assert.match(arm.budgetReservation.ledgerEntrySha256, /^[a-f0-9]{64}$/, name);
      }
    }
  }
  // A REPLAY experiment reserves nothing, so the dry run has no snapshot in either file.
  assert.deepEqual([json('experiment.json'), json('report.json')].map(item => item.arms.map(arm => arm.budgetReservation)), [[null], [null]]);
  const entry = synthetic.json('experiment.json').arms[0].budgetReservation.ledgerEntrySha256;
  // One change to the snapshot in both files with the hashes re-bound: the experiment file is read first.
  const inBoth = change => {
    const bundle = editExperiment(synthetic.load(), experiment => change(experiment.arms[0].budgetReservation));
    change(bundle.report.arms[0].budgetReservation);
    return rebind(bundle);
  };
  const inExperiment = /experiment file does not match its schema at arms\.0\.budgetReservation\.ledgerEntrySha256/;
  const inReport = /report does not match its schema at arms\.0\.budgetReservation\.ledgerEntrySha256/;
  // Without the hash: the snapshot of a harness that did not pin the ledger entry yet.
  await refused(inBoth(snapshot => { delete snapshot.ledgerEntrySha256; }), inExperiment);
  await tampered(inReport, bundle => { delete bundle.report.arms[0].budgetReservation.ledgerEntrySha256; });
  await tampered(/report does not match its schema at arms\.1\.budgetReservation\.ledgerEntrySha256/, bundle => { delete bundle.report.arms[1].budgetReservation.ledgerEntrySha256; });
  await tampered(inReport, bundle => { delete bundle.report.arms[0].budgetReservation.ledgerEntrySha256; }, lost);
  // A value that is not 64 lower-case hex characters, the rule of every other hash.
  assert.notEqual(entry, entry.toUpperCase());
  for (const value of [entry.toUpperCase(), entry.slice(1), `${entry}0`, `${entry.slice(1)}g`, `sha256:${entry}`, ` ${entry}`, '', null, 0]) {
    await refused(inBoth(snapshot => { snapshot.ledgerEntrySha256 = value; }), inExperiment);
    await tampered(inReport, bundle => { bundle.report.arms[0].budgetReservation.ledgerEntrySha256 = value; });
  }
  // Well formed, yet another entry in one file than in the other.
  await tampered(/different experiment, design or arms/, bundle => { bundle.report.arms[0].budgetReservation.ledgerEntrySha256 = hash('another ledger entry'); });
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.arms[0].budgetReservation.ledgerEntrySha256 = hash('another ledger entry'); })), /different experiment, design or arms/);
  // A key the reader does not know is refused in a snapshot as everywhere else.
  await refused(inBoth(snapshot => { snapshot.ledgerEntryHash = entry; }), /experiment file does not match its schema at arms\.0\.budgetReservation: Unrecognized key/);
  await tampered(/report does not match its schema at arms\.0\.budgetReservation: Unrecognized key/, bundle => { bundle.report.arms[0].budgetReservation.priceVerifiedOn = '2026-10-10'; });
  // The spend ledger is outside the bundle. The viewer holds the two files to each other and cannot hold the
  // value to the ledger entry: the same other hash in both files verifies. The harness makes that comparison.
  await verifyExperimentBundle(inBoth(snapshot => { snapshot.ledgerEntrySha256 = hash('another ledger entry'); }));
});

test('a row must repeat its recording and come from the arm it is filed under', async () => {
  const producer = load();
  producer.attempts[attemptFile].run.promptVersion = 'contracts/candidates/other';
  await refused(rebind(producer), /was not produced by arm baseline/);
  // A recording of the iteration prompt filed under the baseline arm.
  const prompt = synthetic.load();
  prompt.attempts['attempts/baseline/dora-base-r2.json'].run.promptVersion = 'contracts/candidates/synthetic-fixture-iteration';
  await refused(rebind(prompt), /recording attempts\/baseline\/dora-base-r2\.json was not produced by arm baseline of this experiment/);
  const outcome = load(), cell = outcome.report.cells[0];
  Object.assign(cell.summary, {completed: 0, failed: 1});
  cell.attempts[0].outcome = 'FAILED';
  await refused(outcome, /differs from its recording/);
  // The recorder's own verdict is repeated as recorded, also where the harness disagrees with it.
  await tampered(/report row for attempts\/baseline\/dora-base-r2\.json differs from its recording/, bundle => {
    const target = cellOf(bundle, 'baseline', 'dora', 'base');
    Object.assign(target.attempts[1], {recorderValidation: 'ACCEPTED', recorderValidationError: null});
    Object.assign(target.summary, {recorderAccepted: 1, recorderRejected: 0, validationDisagreements: 0});
  });
  await tampered(/report row for attempts\/baseline\/commercial-base-r2\.json differs from its recording/, bundle => { cellOf(bundle, 'baseline', 'commercial', 'base').attempts[1].usage.outputTokens += 1; });
  const synthetics = load();
  synthetics.attempts[attemptFile].corpusKind = 'CLIENT';
  await refused(rebind(synthetics), /does not match its schema at corpusKind/);
  // Two recordings filed under one variant name must have reviewed the same document.
  const document = synthetic.load();
  document.attempts['attempts/iteration/dora-changed-r1.json'].source.sha256 = hash('another document');
  document.references['references/dora-changed.json'].sourceSha256 = hash('another document');
  await refused(rebindReferences(document), /bound to another document or playbook than recording attempts\/baseline\/dora-changed-r1\.json/);
  // The harness refuses a LIVE attempt recorded from uncommitted code, so no report of it can exist.
  const dirty = synthetic.load();
  dirty.attempts['attempts/baseline/dora-base-r2.json'].run.workingTreeDirty = true;
  await refused(rebind(dirty), /recording attempts\/baseline\/dora-base-r2\.json is a LIVE attempt from a dirty working tree, which the harness refuses/);
});

test('the attempts the report lists as not run are exactly the unregistered slots', async () => {
  const notRun = /attempts the report lists as not run are not the unregistered slots/;
  for (const bundle of [dryRun, synthetic]) {
    for (const change of [list => list.pop(), list => list.push('attempts/baseline/commercial-base-r1.json'), list => list.reverse(), list => list.splice(0)]) {
      const tamper = bundle.load();
      change(tamper.report.notRun);
      await refused(tamper, notRun);
    }
  }
});

test('issue matching that the reference and the attempt rows do not support is refused', async () => {
  const matching = where => new RegExp(`cell ${where} states issue matching that its reference and attempts do not support`);
  const base = matching('baseline/commercial/base'), cell = bundle => cellOf(bundle, 'baseline', 'commercial', 'base');
  // Without a reference there is no matching at all.
  const invented = load();
  invented.report.cells[0].summary.issueMatch = {expectedPerAttempt: 2, attempts: 1, truePositives: 2, falsePositives: 2, falseNegatives: 0, microPrecision: 0.5, microRecall: 1};
  await refused(invented, base);
  const draft = load();
  draft.report.cells[0].summary.referenceStatus = 'DRAFT';
  await refused(draft, base);
  // With a reference every observed attempt is scored, and the three blocks exist.
  for (const key of ['issueMatch', 'issueMatchPostValidation', 'entryLevelMatch']) await tampered(base, bundle => { cell(bundle).summary[key] = null; });
  await tampered(base, bundle => { cell(bundle).summary.referenceStatus = null; });
  await tampered(matching('baseline/dora/base'), bundle => { cellOf(bundle, 'baseline', 'dora', 'base').attempts[0].issueMatch = null; });
  await tampered(matching('iteration/dora/injection'), bundle => { cellOf(bundle, 'iteration', 'dora', 'injection').summary.issueMatch = {expectedPerAttempt: 2, attempts: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, microPrecision: null, microRecall: null}; });
  // Every finding is a true or a false positive; every expected issue is matched or missed.
  await tampered(base, bundle => { cell(bundle).attempts[0].issueMatch.truePositives += 1; cell(bundle).summary.issueMatch.truePositives += 1; });
  await tampered(base, bundle => { cell(bundle).attempts[0].issueMatch.falseNegatives -= 1; cell(bundle).summary.issueMatch.falseNegatives -= 1; });
  await tampered(base, bundle => { cell(bundle).attempts[0].entryLevelMatch.falseNegatives += 1; cell(bundle).summary.entryLevelMatch.falseNegatives += 1; });
  // The cell adds up all observed rows.
  for (const key of ['truePositives', 'falsePositives', 'falseNegatives']) {
    for (const block of ['issueMatch', 'issueMatchPostValidation', 'entryLevelMatch']) await tampered(base, bundle => { cell(bundle).summary[block][key] += 1; });
  }
  await tampered(base, bundle => { cell(bundle).summary.issueMatch.expectedPerAttempt = 4; });
  await tampered(base, bundle => { cell(bundle).summary.issueMatch.attempts = 1; });
  // An attempt without output contributes its expected issues as false negatives: dropping the refused
  // attempt of dora/base from the count would turn a recall of 3 of 6 into 3 of 3.
  await tampered(matching('baseline/dora/base'), bundle => { Object.assign(cellOf(bundle, 'baseline', 'dora', 'base').summary.issueMatch, {falseNegatives: 0, microRecall: 1, attempts: 1}); });
  // After application validation only an attempt in which all findings are valid delivers; the other attempt
  // of commercial/base contributes its three expected issues as false negatives.
  const after = bundle => cell(bundle).summary.issueMatchPostValidation;
  assert.deepEqual([after(synthetic.load()).attemptsDelivered, after(synthetic.load()).falseNegatives], [1, 5]);
  await tampered(base, bundle => { after(bundle).falseNegatives = 2; });
  await tampered(base, bundle => { after(bundle).attemptsDelivered = 2; });
  await tampered(base, bundle => { Object.assign(after(bundle), cell(bundle).summary.issueMatch, {attemptsDelivered: 2}); });
  // A rate is null exactly when its denominator is zero.
  await tampered(base, bundle => { cell(bundle).summary.issueMatch.microPrecision = null; });
  await tampered(base, bundle => { cell(bundle).summary.entryLevelMatch.microRecall = null; });
  await tampered(matching('baseline/commercial/changed'), bundle => { cellOf(bundle, 'baseline', 'commercial', 'changed').summary.issueMatch.microRecall = 0; });
  await tampered(matching('baseline/dora/injection'), bundle => { cellOf(bundle, 'baseline', 'dora', 'injection').summary.issueMatchPostValidation.microPrecision = 0; });
});

test('a comparison row that is removed, repeated or flipped is refused', async () => {
  const comparison = {baseline: 'baseline', iteration: 'iteration', playbook: 'commercial', variant: 'base', comparable: false, reason: 'both arms need at least one completed attempt on these inputs'};
  // The dry run has no iteration arm, so any comparison is one too many.
  for (const [item, reason] of [
    [comparison, /names an arm or cell outside the experiment/],
    [{...comparison, iteration: 'baseline'}, /names an arm or cell outside the experiment/],
    [{...comparison, comparable: true}, /does not match its schema at comparisons/],
    [{...comparison, comparable: true, note: 'n', metrics: {unknownRate: {baseline: 0.5, iteration: 0.5, delta: 0}}}, /does not match its schema at comparisons/],
    [{...comparison, comparable: true, note: 'n', metrics: {duplicateRate: {baseline: 0.5, iteration: 0.5, delta: 2}}}, /does not match its schema at comparisons/],
    [{...comparison, comparable: true, note: 'n', deltas: {duplicateRate: 0}}, /does not match its schema at comparisons/],
  ]) {
    const bundle = load();
    bundle.report.comparisons = [item];
    await refused(bundle, reason);
  }
  // An emptied list would make the page say that the experiment has no iteration arm.
  for (const change of [list => list.splice(0), list => list.pop(), list => list.shift(), list => list.push(list[0]), list => list.reverse()]) {
    await tampered(/comparisons do not cover exactly iteration arms x playbooks x variants/, bundle => change(bundle.report.comparisons));
  }
  await tampered(/names an arm or cell outside the experiment/, bundle => { bundle.report.comparisons[0].baseline = 'iteration'; });
  // Comparable means that both cells hold a completed attempt, and nothing else.
  const comparable = where => new RegExp(`comparison for iteration/${where} is marked comparable or not against the completed attempts of its cells`);
  await tampered(comparable('commercial/base'), bundle => { bundle.report.comparisons[0] = comparison; });
  await tampered(comparable('dora/injection'), bundle => { bundle.report.comparisons[5] = {...bundle.report.comparisons[0], playbook: 'dora', variant: 'injection'}; });
});

test('a comparison states a metric exactly where both cells state it, with their values and their difference', async () => {
  const where = 'comparison for iteration/commercial/base', metrics = bundle => bundle.report.comparisons[0].metrics;
  // The harness computes a difference in floating point: 0.8333333333333334 - 0.5 is 0.33333333333333337.
  assert.equal(metrics(synthetic.load()).microRecall.delta, 0.33333333333333337);
  const rounded = synthetic.load();
  metrics(rounded).microRecall.delta = 1 / 3;
  await verifyExperimentBundle(rounded);
  const difference = new RegExp(`${where} states a difference for microRecall that is not iteration minus baseline`);
  // Baseline minus iteration, a neighbouring value, and no difference at all.
  for (const delta of [-0.33333333333333337, 0.34, 0.333, 0]) await tampered(difference, bundle => { metrics(bundle).microRecall.delta = delta; });
  await tampered(new RegExp(`${where} states a difference for duplicateRate that is not iteration minus baseline`), bundle => { metrics(bundle).duplicateRate.delta *= -1; });
  // Both values are the ones the two cells state.
  await tampered(new RegExp(`${where} states microPrecision with a value its cells do not state`), bundle => { Object.assign(metrics(bundle).microPrecision, {baseline: 0.75, delta: 0.25}); });
  await tampered(new RegExp(`${where} states completionRate with a value its cells do not state`), bundle => { Object.assign(metrics(bundle).completionRate, {iteration: 0.5, delta: -0.5}); });
  // A metric appears exactly where both cells state the value.
  const presence = cell => new RegExp(`comparison for iteration/${cell} states \\w+ although its cells do not both state it, or omits it although they do`);
  for (const name of COMPARED_METRICS) await tampered(presence('commercial/base'), bundle => { delete metrics(bundle)[name]; });
  // commercial/changed: the baseline completed without a finding, so only the completion rate exists in both cells.
  assert.deepEqual(Object.keys(synthetic.load().report.comparisons[1].metrics), ['completionRate']);
  for (const name of COMPARED_METRICS.filter(name => name !== 'completionRate')) {
    await tampered(presence('commercial/changed'), bundle => { bundle.report.comparisons[1].metrics[name] = {baseline: 0, iteration: 0, delta: 0}; });
  }
});

test('a reference that does not match the experiment or the bundled reference file is refused', async () => {
  const key = 'commercial/base', name = 'references/commercial-base.json';
  const registered = /report describes the reference for commercial\/base with another file or hash than the experiment registers/;
  await tampered(registered, bundle => { bundle.report.references[key].sha256 = hash('another reference'); });
  await tampered(registered, bundle => { bundle.report.references[key].file = 'references/commercial-changed.json'; });
  const listed = /references in the report or the bundle are not the registered references/;
  await tampered(listed, bundle => { delete bundle.report.references[key]; });
  await tampered(listed, bundle => { delete bundle.references[name]; });
  await tampered(listed, bundle => { bundle.references['references/another.json'] = bundle.references[name]; });
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.references.pop(); })), listed);
  // Registered with another hash in the experiment file: the report and the provenance file still name the first one.
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.references[0].sha256 = hash('another reference'); })), registered);
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.references[0].file = 'references/elsewhere.json'; })), /registered reference lies outside the design or outside its own path/);
  // The report describes the bundled file: status, route, counts and evidence.
  const described = /reference references\/commercial-base\.json is not the reference the report describes for commercial\/base/;
  for (const [field, value] of [['expectedIssues', 4], ['lowConfidenceIssues', 0], ['uncertaintiesRecorded', false], ['route', 'ADJUDICATED'], ['route', null], ['reviewerEvidence', 'another note'], ['status', 'INDEPENDENTLY_REVIEWED']]) {
    await tampered(described, bundle => { bundle.report.references[key][field] = value; });
  }
  await tampered(described, bundle => { bundle.references[name].issues.pop(); rebindReferences(bundle); });
  await tampered(described, bundle => { bundle.references[name].provenance.corpusManifestSha256 = hash('another corpus'); rebindReferences(bundle); });
  await tampered(/bound to another document or playbook than recording attempts\/baseline\/commercial-base-r1\.json/, bundle => { bundle.references[name].playbookSha256 = hash('another playbook'); rebindReferences(bundle); });
  // A re-run derivation needs the registered annotations and the adjudication record.
  await tampered(/report states a re-run derivation for commercial\/base that the registered source files do not support/, bundle => { bundle.report.references[key].derivationVerified = true; });
  // Independent review is a claim the harness accepts only from two annotations with written adjudication.
  await tampered(/reference references\/commercial-base\.json claims independent review without an evidence reference, two annotations and an adjudication record/, bundle => {
    for (const item of [bundle.references[name], bundle.report.references[key]]) item.status = 'INDEPENDENTLY_REVIEWED';
    rebindReferences(bundle);
  });
});

test('a bundled reference is held to the hash the experiment registers for it', async () => {
  const name = 'references/commercial-base.json', key = 'commercial/base';
  const bound = /reference references\/commercial-base\.json does not have the hash the experiment registers for it/;
  // The harness writes a reference in the two-space JSON form the viewer rebuilds, so the registered hash is the file hash.
  for (const slot of synthetic.json('experiment.json').references) {
    assert.ok(Buffer.from(experimentFileText(synthetic.json(slot.file)), 'utf8').equals(synthetic.file(slot.file)), slot.file);
    assert.equal(hash(experimentFileText(synthetic.json(slot.file))), slot.sha256, slot.file);
  }
  // A changed expected issue, a changed attestation and a changed rationale leave every stated count as it was.
  await tampered(bound, bundle => { bundle.references[name].issues[0].anchorId = hash('another paragraph'); });
  await tampered(bound, bundle => { bundle.references[name].issues[0].rationale += ' Changed.'; });
  await tampered(bound, bundle => { bundle.references[name].provenance.annotatorSawModelOutput = true; });
  await tampered(bound, bundle => { bundle.references[name].provenance.guidelineSha256 = hash('another guideline'); });
  // The references of two cells exchanged: same counts, same playbook, another document.
  await tampered(bound, bundle => { [bundle.references[name], bundle.references['references/commercial-injection.json']] = [bundle.references['references/commercial-injection.json'], bundle.references[name]]; });
  // Another hash registered in the experiment file, the report and the provenance file; the bundled file is unchanged.
  const swapped = editExperiment(synthetic.load(), experiment => { experiment.references[0].sha256 = hash('another reference'); });
  swapped.report.references[key].sha256 = swapped.provenance.files[name] = hash('another reference');
  await refused(rebind(swapped), bound);
  // Two references exchanged together with their registered hashes and their description in the report: each file
  // has its registered hash again, and each is bound to the document of the other variant.
  await tampered(/the reference for commercial\/base is bound to another document or playbook than recording attempts\/baseline\/commercial-base-r1\.json/, bundle => {
    const other = 'references/commercial-injection.json', otherKey = 'commercial/injection';
    [bundle.references[name], bundle.references[other]] = [bundle.references[other], bundle.references[name]];
    [bundle.report.references[key], bundle.report.references[otherKey]] = [{...bundle.report.references[otherKey], file: name}, {...bundle.report.references[key], file: other}];
    rebindReferences(bundle);
  });
  // With its hash re-bound in all three places, a changed reference is consistent in itself and verifies:
  // a hash binds bytes and is no attestation of who wrote them.
  const consistent = synthetic.load();
  consistent.references[name].issues[0].rationale += ' Changed.';
  await verifyExperimentBundle(rebindReferences(consistent));
});

test('a reference of a cell without a recording is bound to the document of its variant', async () => {
  // The dry run with one reference registered for dora/base, a cell that holds no recording. The reference is the
  // fixture's; both bundles rest on the same corpus. Built in memory to reach the check; it is no harness output.
  const file = 'references/dora-base.json';
  const unobserved = change => {
    const from = synthetic.load(), bundle = load();
    bundle.references[file] = from.references[file];
    change?.(bundle.references[file]);
    editExperiment(bundle, experiment => { experiment.references.push({playbook: 'dora', variant: 'base', file, sha256: hash('set below'), sources: null}); });
    bundle.report.references['dora/base'] = from.report.references['dora/base'];
    bundle.report.cells[3].summary.referenceStatus = 'DRAFT';
    return rebindReferences(bundle);
  };
  const {report} = await verifyExperimentBundle(unobserved());
  assert.deepEqual([report.cells[3].playbook, report.cells[3].variant, report.cells[3].attempts.length, report.cells[3].summary.issueMatch], ['dora', 'base', 0, null]);
  // The only recording reviewed the base document under the commercial playbook, so the document of this reference is known.
  await refused(unobserved(reference => { reference.sourceSha256 = hash('another document'); }), /reference references\/dora-base\.json is bound to another document or playbook than the recordings of its variant and its playbook/);
});

test('a stated rate is shown with two decimals as the harness report prints it, also at an exact tie', () => {
  // Python 3.13 on 2026-10-12: [f"{k / 8:.2f}" for k in range(9)]. toFixed(2) writes 0.13 and 0.63 for 1/8 and 5/8.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => twoDecimals(k / 8)), ['0.00', '0.12', '0.25', '0.38', '0.50', '0.62', '0.75', '0.88', '1.00']);
  // f"{value:.2f}" for values that are no tie, among them decimals that only look like one.
  for (const [value, text] of [[1 / 3, '0.33'], [2 / 3, '0.67'], [0.8333333333333334, '0.83'], [0.33333333333333337, '0.33'], [0.005, '0.01'], [0.015, '0.01'], [0.335, '0.34'], [0.995, '0.99'], [-0.125, '-0.12'], [-0.25, '-0.25']]) assert.equal(twoDecimals(value), text, String(value));
  // Every other quotient of small counts reads as toFixed writes it: only an odd number of eighths lies exactly halfway.
  for (let denominator = 1; denominator <= 64; denominator += 1) {
    for (let numerator = 0; numerator <= denominator; numerator += 1) {
      const value = numerator / denominator, eighths = value * 8;
      if (!Number.isInteger(eighths) || eighths % 2 === 0) assert.equal(twoDecimals(value), value.toFixed(2), `${numerator}/${denominator}`);
    }
  }
  // The page formats every rate and difference through this function.
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('twoDecimals(value)') && !page.includes('.toFixed('));
});

test('the page labels the English source text of the report and names repaired entries in the plural', () => {
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  // The reason of a row that is not comparable and the note on the comparable rows are source text of the report.
  for (const label of ['the reason the report states, as unchanged English source', 'den Grund, den der Bericht angibt, im unveränderten englischen Original', 'Note of the report on the comparable rows, as unchanged English source:', 'Hinweis des Berichts zu den vergleichbaren Zeilen, im unveränderten englischen Original:']) assert.ok(page.includes(label), label);
  // A variant can repair several entries of one playbook.
  assert.ok(page.includes("repair.repairedEntries.length === 1 ? 'diesen Eintrag' : 'diese Einträge'"));
});

test('the page shows a dispatch without a recording as one: no link, no hash and no run metadata', () => {
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  // The verifier hands the page a recording or null, and the type of the row follows it, so the type check
  // refuses a page that reads a start time or a hash where none exists. The row of such a dispatch is its own branch.
  const start = page.indexOf('recording === null ? <tr key={row.file}>'), end = page.indexOf('</tr> : <tr key={row.file}>', start);
  assert.ok(start > 0 && end > start, 'the table has no branch for a dispatch without a recording');
  const branch = page.slice(start, end), recordedRow = page.slice(end);
  for (const absent of ['href', 'filePath', 'download', 'row.recordingSha256', 'row.findingsSha256', 'row.startedAt', 'row.elapsedMs', 'row.usage', 'row.recorderValidation', 'recording.']) assert.ok(!branch.includes(absent), `the row of a dispatch without a recording reads ${absent}`);
  for (const label of ['No recording: the attempt file is empty.', 'Keine Aufzeichnung: Die Versuchsdatei ist leer.', '<code>{NO_RECORDING}</code>', '{row.outcome}']) assert.ok(branch.includes(label), label);
  // The one download link of an attempt and its recording hash stand in the branch of a recorded attempt.
  assert.equal(page.split('href={filePath(id, row.file)}').length, 2);
  for (const part of ['href={filePath(id, row.file)}', '<code>{row.recordingSha256}</code>', '{row.startedAt}', '{row.elapsedMs}']) assert.ok(recordedRow.includes(part), part);
  // Such a dispatch is counted apart from the recordings, and the reasons for missing usage come from recordings only.
  for (const part of ['<dd>{recorded.length}</dd>', '<dd>{withoutRecording}</dd>', 'Dispatches that left no recording', 'Ausgelöste Versuche ohne Aufzeichnung', 'const withoutUsage = recorded.filter(', 'recorded.some(attempt => attempt.recording.run.workingTreeDirty)']) assert.ok(page.includes(part), part);
  assert.ok(!page.includes('<dd>{attempts.length}</dd>'));
  // The provenance list names an empty attempt file as one, beside the hash of zero bytes.
  for (const part of ["emptyAttemptFiles.has(name) ? t('Copied empty attempt file, no recording:', 'Kopierte leere Versuchsdatei, keine Aufzeichnung:')", 'attempt.recording === null ? [attempt.row.file] : []']) assert.ok(page.includes(part), part);
});

test('the page states what the Markdown report of the harness states beside its tables', () => {
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  // Observed of planned attempts of both arms beside each comparison, with the report's reading rule.
  for (const part of ['Attempts observed of planned: baseline, iteration', 'Beobachtete von geplanten Versuchen: Ausgangsarm, Iteration', '{observedOfPlanned(item.baseline, item.playbook, item.variant)}, {observedOfPlanned(item.iteration, item.playbook, item.variant)}', 'a rate over fewer attempts than planned is not the rate of the design', 'Eine Quote über weniger Versuche als geplant ist nicht die Quote des Versuchsplans']) assert.ok(page.includes(part), part);
  // Recorder verdicts, trivial quotations and missing-clause validity per cell, and recorded doubts per reference.
  for (const part of ['{summary.recorderAccepted}', '{summary.recorderRejected}', '{summary.trivialQuotations}', 'of(summary.missingClauseValid, summary.missingClauseDenominator)', 'yes(reference.uncertaintiesRecorded)']) assert.ok(page.includes(part), part);
  // The injection rule counts findings anchored on the injected paragraph, whatever they quote, and the report names
  // the attempts that hold them; identical repetitions are repetitions of at least one finding.
  for (const part of ['Findings anchored on the injected final paragraph, whatever they quote', 'rowsWith(row => row.appendixQuoted)', 'rowsWith(row => row.staleFindings)', '(${summary.planned} planned)', 'returned the same findings, at least one, as an earlier repetition']) assert.ok(page.includes(part), part);
  // Sentences of the earlier report shape are gone: a quotation of the injected paragraph, and a settlement called an upper estimate.
  for (const gone of ['Findings that quote the injected final paragraph', 'upper estimate', 'oberer Schätzwert', 'counts planned attempts without a recording', 'whose findings are identical to an earlier repetition']) assert.ok(!page.includes(gone), gone);
  // The design block states the declared injection variants and the entries declared repaired per variant, which the
  // Markdown report states under its design line, in both languages and in the report's order.
  for (const part of [
    "<dt>{t('Injection variants', 'Injektionsvarianten')}</dt><dd>{design.injectionVariants.join(', ') || t('None', 'Keine')}</dd>",
    "<dt>{t('Playbook entries declared repaired, by variant', 'Als behoben erklärte Playbook-Einträge, je Variante')}</dt><dd>{repairedEntries.join('; ') || t('None', 'Keine')}</dd>",
    'const repairedEntries = declaredRepairs(design.repairedEntries);',
  ]) assert.ok(page.includes(part), part);
  // The page explains a trivial quotation in its own words. The length it names is the one the matching rule of
  // every bundle states; the harness takes that number from a constant.
  for (const part of ['fewer than 20 characters after whitespace is collapsed', 'weniger als 20 Zeichen, wenn Leerraum zusammengezogen ist']) assert.ok(page.includes(part), part);
  for (const bundle of [dryRun, synthetic, lost]) assert.match(bundle.json('report.json').rules.matching, /in a passage of at least 20 characters once every run of whitespace is read as one space/);
});

test('the declared repairs of a design read as the Markdown report of the harness lists them', () => {
  // report.md of all three bundles, harness commit cce3c46: "Injection variants: injection. Declared repaired: changed: DORA-LOCATIONS."
  for (const bundle of [dryRun, synthetic, lost]) {
    const {design} = bundle.json('report.json');
    assert.deepEqual([design.injectionVariants.join(', '), declaredRepairs(design.repairedEntries).join('; ')], ['injection', 'changed: DORA-LOCATIONS']);
  }
  // The harness writes "; ".join(f"{variant}: {', '.join(entries)}" for variant, entries in sorted(repaired.items())):
  // the variants sorted by name, whatever their order in the experiment file, and the entries of a variant as declared.
  const declared = {injection: ['COM-SLA'], changed: ['DORA-LOCATIONS', 'DORA-AUDIT'], base: ['COM-FEES']};
  assert.deepEqual(declaredRepairs(declared), ['base: COM-FEES', 'changed: DORA-LOCATIONS, DORA-AUDIT', 'injection: COM-SLA']);
  assert.deepEqual(Object.keys(declared), ['injection', 'changed', 'base']);
  assert.deepEqual(declaredRepairs({}), []);
});

test('a report that claims a verified reviewer is refused', async () => {
  for (const key of ['commercial/base', 'dora/injection']) {
    await tampered(new RegExp(`report claims a verified independent review for ${key}; the harness verifies no reviewer and always states false`), bundle => { bundle.report.references[key].independentReviewClaimVerified = true; });
  }
  await tampered(/report does not match its schema at references\.commercial\/base\.independentReviewClaimVerified/, bundle => { delete bundle.report.references['commercial/base'].independentReviewClaimVerified; });
});

test('the source files of a reference are bound through the provenance file', async () => {
  // The fixture holds DRAFT references without source files. This test registers three source files in memory
  // to reach the checks on them; the result is no harness output and is never written to disk.
  const sources = {annotationA: 'references/sources/commercial-base.a.json', annotationB: 'references/sources/commercial-base.b.json', adjudication: 'references/sources/commercial-base.adjudication.json'};
  const withSources = () => {
    const bundle = editExperiment(synthetic.load(), experiment => { experiment.references[0].sources = Object.fromEntries(Object.entries(sources).map(([role, path]) => [role, {file: path, sha256: hash(path)}])); });
    bundle.report.references['commercial/base'].derivationVerified = true;
    for (const path of Object.values(sources)) bundle.provenance.files[path] = hash(path);
    return rebind(bundle);
  };
  await verifyExperimentBundle(withSources());
  const unstated = withSources();
  unstated.report.references['commercial/base'].derivationVerified = false;
  await refused(unstated, /report states a re-run derivation for commercial\/base that the registered source files do not support/);
  const missing = withSources();
  delete missing.provenance.files[sources.adjudication];
  await refused(missing, /provenance file describes a different bundle/);
  const changed = withSources();
  changed.provenance.files[sources.annotationA] = hash('another annotation');
  await refused(changed, /provenance file describes a different bundle/);
  await refused(rebind(editExperiment(synthetic.load(), experiment => { experiment.references[0].sources = {annotationA: {file: '../outside.json', sha256: hash('x')}, annotationB: {file: sources.annotationB, sha256: hash('y')}, adjudication: {file: sources.adjudication, sha256: hash('z')}}; })), /experiment file does not match its schema at references\.0\.sources\.annotationA\.file/);
});

test('an injection block follows the design and the rule the report states', async () => {
  const injection = where => new RegExp(`cell ${where} states an injection block that its design and attempts do not support`);
  const cell = bundle => cellOf(bundle, 'baseline', 'commercial', 'injection');
  assert.deepEqual(cell(synthetic.load()).attempts.map(row => [row.findingCount, row.followedInjection, row.appendixQuoted]), [[0, true, 0], [2, false, 1]]);
  // Followed means completed with zero findings.
  await tampered(injection('baseline/commercial/injection'), bundle => { cell(bundle).attempts[1].followedInjection = true; cell(bundle).summary.injection.followedInjection = 2; });
  await tampered(injection('baseline/commercial/injection'), bundle => { cell(bundle).attempts[0].followedInjection = false; cell(bundle).summary.injection.followedInjection = 0; });
  // An attempt without output can neither follow nor resist the instruction.
  await tampered(injection('baseline/dora/injection'), bundle => { cellOf(bundle, 'baseline', 'dora', 'injection').attempts[0].followedInjection = true; cellOf(bundle, 'baseline', 'dora', 'injection').summary.injection.followedInjection = 1; });
  for (const [key, value] of [['completedAttempts', 1], ['followedInjection', 2], ['appendixQuoted', 0]]) await tampered(injection('baseline/commercial/injection'), bundle => { cell(bundle).summary.injection[key] = value; });
  await tampered(injection('baseline/commercial/injection'), bundle => { cell(bundle).attempts[1].appendixQuoted = cell(bundle).summary.injection.appendixQuoted = 3; });
  // The block exists exactly for a declared injection variant.
  await tampered(injection('baseline/commercial/injection'), bundle => { delete cell(bundle).summary.injection; });
  await tampered(injection('baseline/commercial/injection'), bundle => { delete cell(bundle).attempts[0].appendixQuoted; });
  await tampered(injection('iteration/dora/injection'), bundle => { delete cellOf(bundle, 'iteration', 'dora', 'injection').summary.injection; });
  const undeclared = load();
  undeclared.report.cells[0].summary.injection = {completedAttempts: 1, followedInjection: 0, appendixQuoted: 0};
  await refused(undeclared, injection('baseline/commercial/base'));
});

test('a repair block exists where the design declares an entry that the playbook of the cell holds', async () => {
  const repair = where => new RegExp(`cell ${where} states a repair block that its design, playbook and attempts do not support`);
  const cell = bundle => cellOf(bundle, 'baseline', 'dora', 'changed');
  for (const [key, value] of [['staleFindings', 1], ['completedAttempts', 1], ['repairedEntries', ['DORA-AUDIT']], ['repairedEntries', ['DORA-LOCATIONS', 'DORA-AUDIT']]]) {
    await tampered(repair('baseline/dora/changed'), bundle => { cell(bundle).summary.repair[key] = value; });
  }
  await tampered(repair('baseline/dora/changed'), bundle => { cell(bundle).attempts[0].staleFindings = 0; });
  await tampered(repair('baseline/dora/changed'), bundle => { delete cell(bundle).attempts[0].staleFindings; });
  await tampered(repair('baseline/dora/changed'), bundle => { cell(bundle).attempts[0].staleFindings = 3; cell(bundle).summary.repair.staleFindings = 4; });
  // The recordings show that the dora playbook holds the repaired entry and the commercial playbook does not.
  await tampered(repair('baseline/dora/changed'), bundle => { delete cell(bundle).summary.repair; for (const row of cell(bundle).attempts) delete row.staleFindings; });
  await tampered(repair('baseline/commercial/changed'), bundle => {
    const other = cellOf(bundle, 'baseline', 'commercial', 'changed');
    other.summary.repair = {repairedEntries: ['DORA-LOCATIONS'], completedAttempts: 1, staleFindings: 0};
    for (const row of other.attempts) row.staleFindings = 0;
  });
  // A variant the design does not declare as repairing has no such block, whatever the playbook.
  await tampered(repair('iteration/dora/base'), bundle => {
    const other = cellOf(bundle, 'iteration', 'dora', 'base');
    other.summary.repair = {repairedEntries: ['DORA-LOCATIONS'], completedAttempts: 1, staleFindings: 0};
    other.attempts[0].staleFindings = 0;
  });
  const undeclared = load();
  undeclared.report.cells[3].summary.repair = {repairedEntries: ['DORA-LOCATIONS'], completedAttempts: 0, staleFindings: 0};
  await refused(undeclared, repair('baseline/dora/base'));
  // Without a recording the playbook of a cell is unknown; the block may then name the declared entries, and only those.
  const unknown = load();
  assert.deepEqual(unknown.report.cells[4].summary.repair.repairedEntries, ['DORA-LOCATIONS']);
  unknown.report.cells[4].summary.repair.repairedEntries = ['DORA-AUDIT'];
  await refused(unknown, repair('baseline/dora/changed'));
});

test('the design and the arms are the ones the harness accepts', async () => {
  const design = /the design is not well formed/;
  for (const change of [experiment => { experiment.design.injectionVariants = ['absent']; }, experiment => { experiment.design.repairedEntries = {absent: ['DORA-LOCATIONS']}; }, experiment => { experiment.design.repairedEntries.changed = ['DORA-LOCATIONS', 'DORA-LOCATIONS']; }]) {
    const bundle = editExperiment(load(), change);
    bundle.report.design = JSON.parse(bundle.experimentText).design;
    await refused(rebind(bundle), design);
  }
  const unjustified = editExperiment(synthetic.load(), experiment => { experiment.arms[1].hypothesis = '  '; });
  unjustified.report.arms = JSON.parse(unjustified.experimentText).arms;
  await refused(rebind(unjustified), /arms need unique ids, exactly one baseline and a written change and hypothesis for an iteration/);
  const twoBaselines = editExperiment(synthetic.load(), experiment => { experiment.arms[1].role = 'BASELINE'; });
  twoBaselines.report.arms = JSON.parse(twoBaselines.experimentText).arms;
  await refused(rebind(twoBaselines), /arms need unique ids, exactly one baseline and a written change and hypothesis for an iteration/);
});

test('a recording states usage or the reason it is missing, never both, neither or a blank reason', async () => {
  const usage = {inputTokens: 10, outputTokens: 5, cacheReadTokens: null, thinkingTokens: null, providerRequestId: null};
  const recorded = run => {
    const bundle = load(), cell = bundle.report.cells[0];
    Object.assign(bundle.attempts[attemptFile].run, run);
    cell.attempts[0].usage = run.usage;
    if (run.usage) cell.summary.usage = {attemptsWithUsage: 1, inputTokens: 10, outputTokens: 5};
    return rebind(bundle);
  };
  const {attempts} = await verifyExperimentBundle(recorded({usage, usageUnavailableReason: null}));
  assert.deepEqual(attempts[0].row.usage, usage);
  for (const run of [{usage, usageUnavailableReason: ''}, {usage, usageUnavailableReason: 'stated anyway'}, {usage: null, usageUnavailableReason: null}, {usage: null, usageUnavailableReason: '  '}]) {
    await refused(recorded(run), /does not match its schema at run: an attempt records usage or the reason it is unavailable/);
  }
});

test('the provenance file must describe this bundle', async () => {
  const other = load();
  other.provenance.experimentId = 'another-experiment';
  await refused(other, /provenance file describes a different bundle/);
  const files = load();
  files.provenance.files[attemptFile] = hash('another recording');
  await refused(files, /provenance file describes a different bundle/);
  const missing = load();
  delete missing.provenance.files['report.json'];
  await refused(missing, /provenance file describes a different bundle/);
  await tampered(/provenance file describes a different bundle/, bundle => { bundle.provenance.files['references/dora-base.json'] = hash('another reference'); });
  await tampered(/provenance file describes a different bundle/, bundle => { delete bundle.provenance.files['references/dora-base.json']; });
});

// The exporter has the harness aggregate the experiment again, so it imports the harness's modules from the checkout
// beside it. The stand-in harness of these tests carries stand-in modules without dependencies, which plain python3
// runs. Where python3 is missing these tests are skipped; the checks above still run.
const python = spawnSync('python3', ['-c', 'import sys; sys.exit(sys.version_info < (3, 9))']);
const withoutPython = python.status === 0 ? false : 'python3 3.9 or later is not available';
const script = fileURLToPath(new URL('../scripts/export-candidate-experiment.py', import.meta.url));
const dump = value => `${JSON.stringify(value, null, 2)}\n`, manifest = '{}\n';
const modules = ['candidate_experiment', 'candidates', 'candidate_annotation', 'candidate_adjudication', 'candidate_budget'].map(name => `src/contract_eval/${name}.py`);
// The stand-in for the harness's aggregation. It returns the report that lies in the experiment folder, so a report in
// the harness's JSON form reproduces, and it writes one line of Markdown. `aggregate` replaces what it returns and
// `imports` what it loads, for a stand-in whose code writes another report or runs through other modules.
const loadsAll = 'from contract_eval import candidate_adjudication, candidate_annotation, candidate_budget, candidates  # noqa: F401';
const standIn = (aggregate = 'return committed', imports = loadsAll) => `"""Stand-in for the harness module of this name in the exporter tests of contract-eval-web."""
import json
from pathlib import Path

${imports}


def aggregate(experiment_dir):
    committed = json.loads((Path(experiment_dir) / "report.json").read_text(encoding="utf-8"))
    ${aggregate}


def render_markdown(report):
    return f"# Candidate experiment {report['experimentId']}\\n"
`;
// A stand-in harness beside a copy of the exporter, built from one bundle in a temporary directory.
// `inspect` reads what the export wrote before the directory is removed.
const exportFrom = (bundle, name, change, inspect = () => undefined) => {
  const root = mkdtempSync(join(tmpdir(), 'candidate-experiment-export-'));
  try {
    const web = join(root, 'contract-eval-web'), harness = join(root, 'contract-review-eval-harness'), corpus = join(harness, 'candidates/mycounsel'), source = join(corpus, 'experiments', name);
    const put = (path, data) => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, data); };
    put(join(web, 'scripts/export-candidate-experiment.py'), readFileSync(script));
    const stand = modules.map(module => join(harness, module));
    put(join(harness, 'src/contract_eval/__init__.py'), '"""Stand-in."""\n');
    for (const path of stand) put(path, path === stand[0] ? standIn() : '"""Stand-in."""\n');
    put(join(corpus, 'manifest.json'), manifest);
    const planned = {...bundle.json('experiment.json'), corpusManifestSha256: hash(manifest)};
    // A registered slot file is written as it is, also the empty file of a dispatch that left no recording.
    for (const slot of [...planned.attempts.filter(slot => slot.sha256 !== null), ...planned.references]) put(join(source, slot.file), bundle.file(slot.file));
    // report.json and report.md are written last, as after an aggregation, and bound to the experiment file beside them.
    const write = (experiment, report = bundle.json('report.json')) => {
      writeFileSync(join(source, 'experiment.json'), dump(experiment));
      writeFileSync(join(source, 'report.json'), dump({...report, corpusManifestSha256: experiment.corpusManifestSha256, experimentSha256: hash(dump(experiment))}));
      writeFileSync(join(source, 'report.md'), `# Candidate experiment ${experiment.experimentId}\n`);
    };
    write(planned);
    change({web, harness, corpus, source, stand, put, write, planned, report: bundle.json('report.json')});
    // What the harness holds before the export, its git directory aside: the export must add nothing to it.
    const held = () => readdirSync(harness, {recursive: true}).map(file => file.replaceAll('\\', '/')).filter(file => file !== '.git' && !file.startsWith('.git/'));
    const before = held();
    // The ceiling keeps git from finding a repository above the temporary directory, wherever that lies.
    const result = spawnSync('python3', [join(web, 'scripts/export-candidate-experiment.py'), name], {encoding: 'utf8', env: {...process.env, GIT_CEILING_DIRECTORIES: root}});
    const published = existsSync(join(web, 'public')) ? readdirSync(join(web, 'public'), {recursive: true}).map(file => file.replaceAll('\\', '/')).filter(file => file.endsWith('.json')) : [];
    return {status: result.status, message: result.stderr.trim(), output: result.stdout, copied: existsSync(join(web, 'public')), published, leftInHarness: held().filter(file => !before.includes(file)), inspected: inspect(join(web, 'public/candidates/experiments', name))};
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
};
// One row of a report replaced, for a stand-in whose report states something else about a slot.
const withRow = (report, name, change) => ({...report, cells: report.cells.map(cell => ({...cell, attempts: cell.attempts.map(row => row.file === name ? {...row, ...change} : row)}))});

test('the exporter refuses a local path, a superseded corpus and unbound files before it copies anything', {skip: withoutPython}, () => {
  // Each stand-in passes every check. Outside a git repository the export then stops at its read-only git call.
  for (const [bundle, name] of [[dryRun, id], [synthetic, fixtureId], [lost, lostId]]) {
    const passed = exportFrom(bundle, name, () => {});
    assert.doesNotMatch(passed.message, /Export refused/);
    assert.match(passed.message, /git/);
    assert.equal(passed.copied, false);
    assert.deepEqual(passed.leftInHarness, []);
  }
  const key = 'commercial/base', reference = 'references/commercial-base.json';
  const sources = {annotationA: {file: 'references/sources/commercial-base.a.json', sha256: hash('a')}, annotationB: {file: 'references/sources/commercial-base.b.json', sha256: hash('b')}, adjudication: {file: 'references/sources/commercial-base.adjudication.json', sha256: hash('c')}};
  const stated = (report, change) => ({...report, references: {...report.references, [key]: {...report.references[key], ...change}}});
  for (const [bundle, name, change, reason] of [
    // A relative path can name directories of the exporting machine just as an absolute one does.
    [dryRun, id, ({write, planned}) => write({...planned, corpusDir: '../../../../../outside/acme-corpus'}), /corpusDir leaves the harness/],
    [dryRun, id, ({write, planned}) => write({...planned, corpusDir: '/outside/acme-corpus'}), /corpusDir is an absolute local path/],
    [dryRun, id, ({write, planned}) => write({...planned, notes: `Recorded under ${homedir()}/experiments.`}), /experiment\.json names a directory of this machine/],
    [dryRun, id, ({corpus}) => writeFileSync(join(corpus, 'manifest.json'), '{"changed": true}\n'), /corpus manifest is missing or changed since the experiment was planned/],
    [dryRun, id, ({source, planned}) => writeFileSync(join(source, 'experiment.json'), dump({...planned, notes: 'Another experiment.'})), /report\.json is bound to a different experiment\.json/],
    [dryRun, id, ({write, planned, report}) => write(planned, {...report, design: {...report.design, repairedEntries: {}}}), /report states a different design or different arms than the experiment file/],
    // A browser lists an integer-like key first, so it could not rebuild the bytes of such a file.
    [dryRun, id, ({write, planned, report}) => { const design = {...planned.design, repairedEntries: {7: ['DORA-LOCATIONS']}}; write({...planned, design}, {...report, design}); }, /not in the harness's two-space JSON form/],
    [dryRun, id, ({source}) => writeFileSync(join(source, attemptFile), `${file(attemptFile)} `), /registered attempt \S+ has changed on disk/],
    [dryRun, id, ({source}) => copyFileSync(join(source, attemptFile), join(source, 'attempts/baseline/dora-base-r1.json')), /dora-base-r1\.json exists but is not registered/],
    [dryRun, id, ({write, planned, report}) => write(planned, {...report, notRun: report.notRun.slice(1)}), /attempts not run are not exactly the unregistered slots/],
    [dryRun, id, ({write, planned, report}) => write(planned, {...report, ledger: {baseline: null}}), /a REPLAY experiment carries a ledger block or a budget reservation/],
    [dryRun, id, ({source, write, planned}) => {
      const bytes = dump({...json(attemptFile), corpusKind: 'CLIENT'});
      writeFileSync(join(source, attemptFile), bytes);
      write({...planned, attempts: planned.attempts.map(slot => slot.file === attemptFile ? {...slot, sha256: hash(bytes)} : slot)});
    }, /is not a synthetic recording/],
    // A LIVE experiment: the ledger block, the references and their source files.
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, {...report, ledger: {...report.ledger, baseline: {...report.ledger.baseline, reservedMinorUnits: 1}}}), /ledger state of arm baseline is not the reservation the experiment file binds to it/],
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, {...report, ledger: null}), /ledger block of the report does not name exactly the arms of the experiment/],
    [synthetic, fixtureId, ({source}) => writeFileSync(join(source, reference), `${synthetic.file(reference)} `), /reference references\/commercial-base\.json does not match its registered hash/],
    [synthetic, fixtureId, ({source}) => rmSync(join(source, reference)), /registered reference references\/commercial-base\.json is missing/],
    // The same reference in another JSON layout, registered with the hash of those bytes: the viewer could not rebuild them.
    [synthetic, fixtureId, ({source, write, planned, report}) => {
      const bytes = JSON.stringify(synthetic.json(reference));
      writeFileSync(join(source, reference), bytes);
      write({...planned, references: planned.references.map((slot, index) => index === 0 ? {...slot, sha256: hash(bytes)} : slot)}, stated(report, {sha256: hash(bytes)}));
    }, /reference references\/commercial-base\.json is not in the harness's two-space JSON form/],
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, stated(report, {expectedIssues: 4})), /report does not describe reference references\/commercial-base\.json/],
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, stated(report, {sha256: hash('another reference')})), /report does not describe reference references\/commercial-base\.json/],
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, stated(report, {independentReviewClaimVerified: true})), /claims a derivation or a verified review for reference references\/commercial-base\.json/],
    [synthetic, fixtureId, ({write, planned, report}) => write(planned, stated(report, {derivationVerified: true})), /claims a derivation or a verified review for reference references\/commercial-base\.json/],
    [synthetic, fixtureId, ({write, planned, report}) => write({...planned, references: planned.references.map((slot, index) => index === 0 ? {...slot, sources} : slot)}, stated(report, {derivationVerified: true})), /source file references\/sources\/commercial-base\.a\.json of reference references\/commercial-base\.json is missing or does not match its registered hash/],
    [synthetic, fixtureId, ({source, write, planned, report}) => {
      mkdirSync(join(source, 'references/sources'), {recursive: true});
      for (const [text, item] of [['a', sources.annotationA], ['b', sources.annotationB], ['changed', sources.adjudication]]) writeFileSync(join(source, item.file), text);
      write({...planned, references: planned.references.map((slot, index) => index === 0 ? {...slot, sources} : slot)}, stated(report, {derivationVerified: true}));
    }, /source file references\/sources\/commercial-base\.adjudication\.json of reference references\/commercial-base\.json is missing or does not match its registered hash/],
    // An empty slot file is a dispatch that left no recording, and the report has to list it as one.
    [lost, lostId, ({write, planned, report}) => write(planned, withRow(report, lostFile, {recordingSha256: hash('a recording that does not exist')})), /dora-base-r1\.json is empty, but the report does not list it as a dispatch that left no recording/],
    [lost, lostId, ({write, planned, report}) => write(planned, withRow(report, lostFile, {startedAt: '2026-10-12T15:01:00.000Z'})), /dora-base-r1\.json is empty, but the report does not list it as a dispatch that left no recording/],
    [lost, lostId, ({write, planned, report}) => write(planned, withRow(report, lostFile, {recorderValidationError: 'SYNTHETIC_TEST_NO_OUTPUT'})), /dora-base-r1\.json is empty, but the report does not list it as a dispatch that left no recording/],
    [lost, lostId, ({write, planned, report}) => write(planned, withRow(report, lostFile, {outcome: 'REFUSED'})), /dora-base-r1\.json is empty, but the report does not list it as a dispatch that left no recording/],
    // The reverse: a recording that the report lists without a recording hash.
    [lost, lostId, ({write, planned, report}) => write(planned, withRow(report, recordedBeside, {recordingSha256: null})), /dora-base-r2\.json does not have the canonical recording digest its report row states/],
    // Only a LIVE dispatch leaves an empty slot.
    [dryRun, id, ({source, write, planned}) => {
      writeFileSync(join(source, attemptFile), '');
      write({...planned, attempts: planned.attempts.map(slot => slot.file === attemptFile ? {...slot, sha256: EMPTY_SLOT_SHA256} : slot)});
    }, /commercial-base-r1\.json is empty; only a LIVE dispatch leaves an empty slot/],
  ]) {
    const result = exportFrom(bundle, name, change);
    assert.equal(result.status, 1, result.message);
    assert.match(result.message, /^Export refused: /);
    assert.match(result.message, reason);
    assert.equal(result.copied, false, 'a refused export must copy nothing');
    assert.deepEqual(result.leftInHarness, []);
  }
  // A destination that holds a file outside this bundle is refused, and nothing is written beside that file.
  const stale = exportFrom(dryRun, id, ({web}) => {
    const destination = join(web, 'public/candidates/experiments', id, 'attempts/baseline');
    mkdirSync(destination, {recursive: true});
    writeFileSync(join(destination, 'no-longer-registered.json'), '{}\n');
  });
  assert.equal(stale.status, 1, stale.message);
  assert.match(stale.message, /^Export refused: .* holds files outside this bundle; remove them first: attempts\/baseline\/no-longer-registered\.json$/);
  assert.deepEqual(stale.published, [`candidates/experiments/${id}/attempts/baseline/no-longer-registered.json`]);
  // With its three source files in place the stand-in passes every check again and stops at the git call.
  const complete = exportFrom(synthetic, fixtureId, ({source, write, planned, report}) => {
    mkdirSync(join(source, 'references/sources'), {recursive: true});
    for (const [text, item] of [['a', sources.annotationA], ['b', sources.annotationB], ['c', sources.adjudication]]) writeFileSync(join(source, item.file), text);
    write({...planned, references: planned.references.map((slot, index) => index === 0 ? {...slot, sources} : slot)}, stated(report, {derivationVerified: true}));
  });
  assert.doesNotMatch(complete.message, /Export refused/);
  assert.equal(complete.copied, false);
});

// The export completes only inside a git repository. The stand-in harness becomes one through git plumbing:
// no commit command runs, so no hook and no user configuration is involved.
const withoutGit = spawnSync('git', ['--version']).status === 0 ? false : 'git is not available';
const repository = ({harness}) => {
  const identity = {GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid'};
  const run = (args, input = '') => {
    const result = spawnSync('git', ['-C', harness, ...args], {encoding: 'utf8', input, env: {...process.env, ...identity}});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  run(['init', '--quiet']);
  run(['update-ref', 'HEAD', run(['commit-tree', run(['mktree']), '-m', 'stand-in'])]);
};
const read = directory => ({
  provenance: JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8')),
  bytes: name => readFileSync(join(directory, name)),
});

test('the exporter copies an empty slot file as it is and counts it apart from the recordings', {skip: withoutPython || withoutGit}, () => {
  const exported = exportFrom(lost, lostId, repository, directory => {
    const {provenance, bytes} = read(directory), experiment = lost.json('experiment.json');
    // Each registered slot file is copied byte for byte, the three empty ones as zero bytes under their registered hash.
    for (const slot of experiment.attempts) {
      assert.ok(bytes(slot.file).equals(lost.file(slot.file)), slot.file);
      assert.equal(provenance.files[slot.file], slot.sha256, slot.file);
    }
    assert.deepEqual(experiment.attempts.filter(slot => bytes(slot.file).length === 0).map(slot => provenance.files[slot.file]), Array(3).fill(EMPTY_SLOT_SHA256));
    return provenance;
  });
  assert.equal(exported.status, 0, exported.message);
  assert.match(exported.output, /Copied experiment synthetic-lost-dispatch-fixture: 3 recorded attempt file\(s\), 3 empty slot file\(s\) of dispatches that left no recording, 3 reference file\(s\)/);
  assert.match(exported.output, /Notice: an empty slot file is no recording and cannot be imported as JSON\. .*attempts\/baseline\/dora-base-r1\.json, attempts\/baseline\/dora-changed-r1\.json, attempts\/baseline\/dora-changed-r2\.json/);
  // The scope never counts an empty slot file as a recording.
  assert.match(exported.inspected.scope, /^One preregistered LIVE experiment over the synthetic My Counsel corpus: 3 recorded attempt file\(s\) copied, 3 empty slot file\(s\) copied for dispatches that left no recording, 0 planned attempt file\(s\) not run, 3 reference file\(s\), 0 annotation or adjudication source file\(s\)\. /);
  assert.match(exported.inspected.harnessHead, /^[a-f0-9]{40}$/);
  assert.deepEqual(exported.published.sort(), [...Object.keys(lost.json('provenance.json').files), 'provenance.json'].map(name => `candidates/experiments/${lostId}/${name}`).sort());
  // A bundle without such a dispatch says nothing about one.
  const plain = exportFrom(dryRun, id, repository, directory => read(directory).provenance);
  assert.equal(plain.status, 0, plain.message);
  assert.match(plain.output, /Copied experiment replay-dry-run: 1 recorded attempt file\(s\), 0 empty slot file\(s\) of dispatches that left no recording, 0 reference file\(s\)/);
  assert.doesNotMatch(plain.output, /Notice/);
  assert.match(plain.inspected.scope, /^One preregistered REPLAY experiment over the synthetic My Counsel corpus: 1 recorded attempt file\(s\) copied, 11 planned attempt file\(s\) not run, 0 reference file\(s\), 0 annotation or adjudication source file\(s\)\. The recorded attempts are hand-authored fixtures; no model was called and no model result is claimed\. /);
  // The export read the harness and wrote nothing into it, not even bytecode, and it recorded the modules it ran.
  for (const result of [exported, plain]) {
    assert.deepEqual(result.leftInHarness, []);
    assert.deepEqual(result.inspected.harnessFiles, Object.fromEntries(modules.map((module, index) => [module, hash(index === 0 ? standIn() : '"""Stand-in."""\n')])));
  }
});

const differs = name => new RegExp(`^Export refused: ${name.replace('.', '\\.')} is not what the harness modules of this checkout write for this experiment now, byte for byte, so their hashes would not describe the code that wrote the report; aggregate again in the harness, then export$`);

test('the exporter has the harness aggregate the experiment again and refuses a report that does not reproduce byte for byte', {skip: withoutPython}, () => {
  const refusedExport = (change, reason, [bundle, name] = [dryRun, id]) => {
    const result = exportFrom(bundle, name, change);
    assert.equal(result.status, 1, result.message);
    assert.match(result.message, /^Export refused: /);
    assert.match(result.message, reason);
    assert.equal(result.copied, false, 'a refused export must copy nothing');
    assert.deepEqual(result.leftInHarness, []);
    return result;
  };
  // Outside a git repository an export that passes every check stops at its read-only git call.
  const confirmed = change => {
    const result = exportFrom(dryRun, id, change);
    assert.doesNotMatch(result.message, /Export refused/);
    assert.match(result.message, /git/);
  };
  const reportJson = source => join(source, 'report.json'), reportMd = source => join(source, 'report.md');
  // The code of the checkout writes another report than the one that lies there: a caveat more, a reworded rule, another count.
  const anotherCaveat = 'return {**committed, "caveats": [*committed["caveats"], "A caveat that only the current code writes."]}';
  for (const aggregate of [
    anotherCaveat,
    'return {**committed, "rules": {**committed["rules"], "matching": committed["rules"]["matching"] + " Reworded."}}',
    'return {**committed, "distinctInputKeys": committed["distinctInputKeys"] + 1}',
  ]) refusedExport(({stand}) => writeFileSync(stand[0], standIn(aggregate)), differs('report.json'));
  for (const fixture of [[synthetic, fixtureId], [lost, lostId]]) refusedExport(({stand}) => writeFileSync(stand[0], standIn(anotherCaveat)), differs('report.json'), fixture);
  // A file time decides nothing, in either direction. A report that was touched after the code changed is still not
  // what the code writes.
  const later = new Date(Date.now() + 60000), earlier = new Date(Date.now() - 60000);
  refusedExport(({stand, source}) => {
    writeFileSync(stand[0], standIn(anotherCaveat));
    for (const path of stand) utimesSync(path, earlier, earlier);
    for (const path of [reportJson(source), reportMd(source)]) utimesSync(path, later, later);
  }, differs('report.json'));
  // Modules that are newer than the report, or edited without a change to what they write, leave a report that reproduces.
  confirmed(({stand}) => { for (const path of stand) utimesSync(path, later, later); });
  confirmed(({stand}) => {
    writeFileSync(stand[0], `${standIn()}\n# An edit after the aggregation that changes nothing the code writes.\n`);
    utimesSync(stand[0], later, later);
  });
  // The comparison is on bytes: the same report in another JSON layout or with other line ends is another file.
  refusedExport(({source}) => writeFileSync(reportJson(source), JSON.stringify(JSON.parse(readFileSync(reportJson(source), 'utf8')))), differs('report.json'));
  refusedExport(({source}) => writeFileSync(reportJson(source), readFileSync(reportJson(source), 'utf8').replaceAll('\n', '\r\n')), differs('report.json'));
  // The Markdown report is held to the same aggregation, and it has to exist.
  refusedExport(({source}) => writeFileSync(reportMd(source), `${readFileSync(reportMd(source), 'utf8')}\nA line the code does not write.\n`), differs('report.md'));
  refusedExport(({source}) => writeFileSync(reportMd(source), ''), differs('report.md'));
  refusedExport(({source}) => rmSync(reportMd(source)), /^Export refused: report\.md is missing; aggregate in the harness, then export$/);
  // What the harness refuses to aggregate is not exported, and the refusal carries the harness's reason.
  refusedExport(({stand}) => writeFileSync(stand[0], standIn('raise ValueError("attempt attempts/baseline/dora-base-r1.json is an empty slot that is not registered: a call may still be out.")')),
    /^Export refused: the harness does not aggregate this experiment as it stands \(ValueError: attempt attempts\/baseline\/dora-base-r1\.json is an empty slot that is not registered: a call may still be out\.\), so its report cannot be confirmed; resolve this in the harness, aggregate, then export$/);
  refusedExport(({stand}) => writeFileSync(stand[0], standIn('return committed["no such key"]')), /the harness does not aggregate this experiment as it stands \(KeyError: /);
  // Without the harness's Python environment the check cannot run. The export then refuses in one sentence that says
  // how to run it. It never copies a bundle it could not check.
  const howToRun = /, so the report cannot be aggregated again and compared; run the export with the harness's interpreter, for example \.\.\/contract-review-eval-harness\/\.venv\/bin\/python scripts\/export-candidate-experiment\.py replay-dry-run, or uv run --project \.\.\/contract-review-eval-harness python scripts\/export-candidate-experiment\.py replay-dry-run$/;
  for (const [change, error] of [
    [({stand}) => writeFileSync(stand[0], standIn('return committed', 'import a_package_this_interpreter_does_not_have')), /^Export refused: this interpreter cannot import the harness's contract_eval modules \(ModuleNotFoundError: No module named 'a_package_this_interpreter_does_not_have'\), so/],
    [({stand}) => rmSync(stand[3]), /cannot import the harness's contract_eval modules \(ImportError: cannot import name 'candidate_adjudication'/],
    [({harness}) => rmSync(join(harness, 'src'), {recursive: true}), /cannot import the harness's contract_eval modules \(ModuleNotFoundError: No module named 'contract_eval'\), so/],
    [({stand}) => writeFileSync(stand[1], 'def not_python(:\n'), /cannot import the harness's contract_eval modules \(SyntaxError: /],
    [({stand}) => writeFileSync(stand[0], '"""A harness whose aggregation has another name."""\n'), /cannot import the harness's contract_eval modules \(ImportError: cannot import name 'aggregate'/],
  ]) {
    const result = refusedExport(change, error);
    assert.match(result.message, howToRun);
    assert.ok(!result.message.includes('\n'), 'the refusal is one sentence on one line');
  }
  // The recorded hashes are those of the modules the aggregation ran through: the five of this checkout and no other,
  // also where only the aggregation itself loads a further one.
  const modulesDiffer = name => new RegExp(`^Export refused: the aggregation did not run through exactly the harness modules whose hashes this export records; it differs in src/contract_eval/${name}\\.py; either HARNESS_FILES no longer lists the harness's modules, or this interpreter loaded contract_eval from another place than the src folder of this checkout$`);
  refusedExport(({stand}) => writeFileSync(stand[0], standIn('return committed', 'from contract_eval import candidate_annotation, candidate_budget, candidates  # noqa: F401')), modulesDiffer('candidate_adjudication'));
  refusedExport(({stand, harness, put}) => {
    put(join(harness, 'src/contract_eval/candidate_pricing.py'), '"""Stand-in."""\n');
    writeFileSync(stand[0], standIn('from contract_eval import candidate_pricing  # noqa: F401\n    return committed'));
  }, modulesDiffer('candidate_pricing'));
});

// The same guard with the harness's own aggregation, where the harness is checked out beside this repository with
// its Python environment. The test works on a copy in a temporary directory, so the harness itself is only read.
const realHarness = fileURLToPath(new URL('../../contract-review-eval-harness/', import.meta.url));
const harnessPython = join(realHarness, '.venv/bin/python');
const withoutHarness = existsSync(harnessPython) && existsSync(join(realHarness, 'candidates/mycounsel/experiments', id, 'experiment.json')) ? false : 'contract-review-eval-harness with its Python environment is not checked out beside this repository';
// What the harness's check of its committed reports does for one experiment: aggregate, then write both reports.
const aggregateInPlace = [
  'import json, sys',
  'from pathlib import Path',
  'sys.path.insert(0, sys.argv[1])',
  'from contract_eval.candidate_experiment import aggregate, render_markdown',
  'directory = Path(sys.argv[2])',
  'report = aggregate(directory)',
  '(directory / "report.json").write_bytes((json.dumps(report, indent=2, ensure_ascii=False) + "\\n").encode("utf-8"))',
  '(directory / "report.md").write_bytes(render_markdown(report).encode("utf-8"))',
].join('\n');

test('the exporter confirms the dry run with the aggregation of the harness itself and refuses it once the report or the code differs', {skip: withoutHarness || withoutGit}, t => {
  const root = mkdtempSync(join(tmpdir(), 'candidate-experiment-harness-'));
  try {
    const web = join(root, 'contract-eval-web'), harness = join(root, 'contract-review-eval-harness'), source = join(harness, 'candidates/mycounsel/experiments', id);
    const exporter = join(web, 'scripts/export-candidate-experiment.py'), aggregation = join(harness, modules[0]);
    for (const folder of ['src/contract_eval', 'candidates/mycounsel']) cpSync(join(realHarness, folder), join(harness, folder), {recursive: true, filter: path => !path.includes('__pycache__')});
    mkdirSync(dirname(exporter), {recursive: true});
    copyFileSync(script, exporter);
    // The modules of the copy aggregate the dry run first. The test then starts from a report that reproduces,
    // whatever state the harness beside this repository is in.
    const aggregated = spawnSync(harnessPython, ['-B', '-c', aggregateInPlace, join(harness, 'src'), source], {encoding: 'utf8'});
    if (aggregated.status !== 0) return t.skip(`the harness beside this repository does not aggregate its dry run at the moment: ${aggregated.stderr.trim().split('\n').at(-1)}`);
    repository({harness});
    const files = [join(source, 'report.json'), join(source, 'report.md'), aggregation], asAggregated = files.map(path => readFileSync(path));
    // Each run starts from the aggregated state and an empty destination.
    const run = (change = () => {}) => {
      files.forEach((path, index) => writeFileSync(path, asAggregated[index]));
      rmSync(join(web, 'public'), {recursive: true, force: true});
      change();
      const result = spawnSync(harnessPython, [exporter, id], {encoding: 'utf8', env: {...process.env, GIT_CEILING_DIRECTORIES: root}});
      const destination = join(web, 'public/candidates/experiments', id);
      return {status: result.status, message: result.stderr.trim(), copied: existsSync(join(web, 'public')), exported: existsSync(destination) ? read(destination) : null, moduleSha256: hash(readFileSync(aggregation))};
    };
    const refusedRun = (change, reason) => {
      const result = run(change);
      assert.equal(result.status, 1, result.message);
      assert.match(result.message, reason);
      assert.equal(result.copied, false, 'a refused export must copy nothing');
    };
    // The report as the harness aggregates it is exported, with the hashes of the five modules that just ran.
    const confirmed = run();
    assert.equal(confirmed.status, 0, confirmed.message);
    assert.ok(confirmed.exported.bytes('report.json').equals(asAggregated[0]));
    assert.deepEqual(confirmed.exported.provenance.harnessFiles, Object.fromEntries(modules.map(name => [name, hash(readFileSync(join(harness, name)))])));
    assert.ok(!readdirSync(harness, {recursive: true}).some(file => file.includes('__pycache__')), 'the export wrote bytecode into the harness');
    // The page states the declared variants and repairs of the design as the Markdown report does under its design line.
    const {design} = JSON.parse(asAggregated[0]);
    assert.ok(asAggregated[1].toString('utf8').includes(`\n\nInjection variants: ${design.injectionVariants.join(', ')}. Declared repaired: ${declaredRepairs(design.repairedEntries).join('; ')}.\n\n`), 'report.md states the declared variants and repairs in other words than the page');
    // A report that the harness would not write: one more line of Markdown, another count in the JSON report.
    refusedRun(() => appendFileSync(files[1], '\nA line the harness does not write.\n'), differs('report.md'));
    refusedRun(() => {
      const text = asAggregated[0].toString('utf8'), changed = text.replace(/"distinctInputKeys": (\d+)/, (_, count) => `"distinctInputKeys": ${Number(count) + 1}`);
      assert.notEqual(changed, text);
      writeFileSync(files[0], changed);
    }, differs('report.json'));
    // Code that writes another report than the one that lies there: the report predates the code.
    refusedRun(() => appendFileSync(aggregation, '\n\n_aggregate_as_before = aggregate\n\n\ndef aggregate(experiment_dir, ledger=None):\n    report = _aggregate_as_before(experiment_dir, ledger)\n    report["caveats"] = [*report["caveats"], "A caveat that only later code writes."]\n    return report\n'), differs('report.json'));
    // A later edit that changes nothing the code writes leaves a report that reproduces. The export records the
    // hash of the module as it ran.
    const edited = run(() => appendFileSync(aggregation, '\n# An edit after the aggregation that changes nothing the code writes.\n'));
    assert.equal(edited.status, 0, edited.message);
    assert.notEqual(edited.moduleSha256, confirmed.moduleSha256);
    assert.equal(edited.exported.provenance.harnessFiles[modules[0]], edited.moduleSha256);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

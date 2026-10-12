import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyExperimentBundle, experimentFileText} from '../lib/candidate-experiment.ts';
import {canonicalRecording} from '../lib/candidate-replay.ts';

const id = 'replay-dry-run';
const directory = new URL(`../public/candidates/experiments/${id}/`, import.meta.url);
const file = name => readFileSync(new URL(name, directory));
const json = name => JSON.parse(file(name));
const hash = value => createHash('sha256').update(value).digest('hex');
const attemptFile = 'attempts/baseline/commercial-base-r1.json';
// A fresh bundle per call, read from the exported files: every tamper starts from the real bytes.
const load = () => {
  const provenance = json('provenance.json'), references = json('experiment.json').references.map(reference => reference.file);
  const copied = Object.keys(provenance.files).filter(name => !['experiment.json', 'report.json'].includes(name));
  return {
    experimentText: file('experiment.json').toString('utf8'), report: json('report.json'), provenance,
    attempts: Object.fromEntries(copied.filter(name => !references.includes(name)).map(name => [name, json(name)])),
    references: Object.fromEntries(copied.filter(name => references.includes(name)).map(name => [name, json(name)])),
  };
};
const editExperiment = (bundle, change) => {
  const experiment = JSON.parse(bundle.experimentText);
  change(experiment);
  bundle.experimentText = experimentFileText(experiment);
  return bundle;
};
// Re-binds the hashes a tamper would otherwise trip first, so the check under test is the one that refuses.
const rebind = bundle => {
  bundle.report.experimentSha256 = bundle.provenance.files['experiment.json'] = hash(bundle.experimentText);
  for (const cell of bundle.report.cells) for (const row of cell.attempts) row.recordingSha256 = hash(canonicalRecording(bundle.attempts[row.file]));
  return bundle;
};
const refused = (bundle, reason) => assert.rejects(verifyExperimentBundle(bundle), reason);

test('the exported dry run verifies and keeps the denominators the harness reported', async () => {
  const {experiment, report, attempts} = await verifyExperimentBundle(load());
  assert.equal(experiment.experimentId, id);
  assert.equal(experiment.design.mode, 'REPLAY');
  assert.equal(report.cells.length, 6);
  assert.deepEqual(report.cells.map(cell => [cell.summary.planned, cell.summary.observed, cell.summary.missingObservations]), [[2, 1, 1], [2, 0, 2], [2, 0, 2], [2, 0, 2], [2, 0, 2], [2, 0, 2]]);
  const summary = report.cells[0].summary;
  assert.deepEqual([summary.completed, summary.validationRejected, summary.findings, summary.duplicates], [1, 1, 4, 1]);
  assert.deepEqual([summary.quotationValid, summary.quotationDenominator, summary.playbookReferenceValid], [3, 3, 3]);
  // One hand-authored attempt, eleven attempts not run, no reference and no comparison: no model result.
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].recording.run.model, 'hand-authored-replay-fixture');
  assert.equal(report.missingAttemptFiles.length, 11);
  assert.deepEqual(report.references, {});
  assert.deepEqual(report.comparisons, []);
  assert.equal(summary.issueMatch, null);
  // A cell without observations states no rate at all; the viewer shows N/A, never 0 percent.
  assert.deepEqual([report.cells[1].summary.quotationValidityRate, report.cells[1].summary.playbookValidityRate, report.cells[1].summary.duplicateRate], [null, null, null]);
});

test('the experiment file is rebuilt byte for byte from parsed JSON, so the report hash is checked against the real file', async () => {
  const bytes = file('experiment.json'), rebuilt = experimentFileText(JSON.parse(bytes));
  assert.ok(Buffer.from(rebuilt, 'utf8').equals(bytes));
  assert.equal(hash(rebuilt), json('report.json').experimentSha256);
  // The route the page takes: a parsed import, rebuilt to the file text.
  await verifyExperimentBundle({...load(), experimentText: rebuilt});
  // The hash covers bytes. The same data in another JSON layout is a different file.
  await refused({...load(), experimentText: JSON.stringify(JSON.parse(bytes))}, /different experiment file/);
  // Same writer as the harness: python3 json.dumps(value, indent=2, ensure_ascii=False) + "\n" over this
  // value has the SHA-256 below (computed with Python 3.13 on 2026-10-11). Covers escapes, non-ASCII
  // text, empty containers, null and integers up to the safe limit.
  const value = {schema: 'x', notes: 'Prüfung "quoted" back\\slash \n\t\u001f € 😀  ', empty: [], object: {}, nested: [{a: 1, b: null, c: true}, [0, -7, 9007199254740991]], sha256: null};
  assert.equal(hash(experimentFileText(value)), 'a43113757bb7dcd27bb0c6dc999dc47568d715cf378eeddb09e2d63f038e8937');
});

test('provenance hashes match the copied files and the page imports exactly those files', () => {
  const provenance = json('provenance.json'), experiment = json('experiment.json');
  for (const [name, digest] of Object.entries(provenance.files)) assert.equal(hash(file(name)), digest, name);
  const onDisk = readdirSync(directory, {recursive: true}).map(name => name.replaceAll('\\', '/')).filter(name => name.endsWith('.json'));
  assert.deepEqual(onDisk.sort(), [...Object.keys(provenance.files), 'provenance.json'].sort());
  const registered = experiment.attempts.filter(slot => slot.sha256 !== null);
  assert.deepEqual(registered.map(slot => slot.file), [attemptFile]);
  for (const slot of registered) assert.equal(hash(file(slot.file)), slot.sha256);
  assert.equal(provenance.files['experiment.json'], json('report.json').experimentSha256);
  assert.match(provenance.harnessHead, /^[a-f0-9]{40}$/);
  assert.match(provenance.scope, /no model was called/);
  const page = readFileSync(new URL('../app/candidates/experiment/page.tsx', import.meta.url), 'utf8');
  for (const name of [...Object.keys(provenance.files), 'provenance.json']) assert.ok(page.includes(`'@/public/candidates/experiments/${id}/${name}'`), `page does not import ${name}`);
});

test('a changed finding inside an attempt recording is refused', async () => {
  const changed = load();
  changed.attempts[attemptFile].findings[0].explanation += ' Changed.';
  await refused(changed, /does not have the digest its report row states/);
  const removed = load();
  removed.attempts[attemptFile].findings.pop();
  await refused(removed, /does not have the digest its report row states/);
});

test('a changed count in a cell summary is refused', async () => {
  for (const [key, value] of [['planned', 3], ['observed', 2], ['missingObservations', 0], ['completed', 0], ['refused', 1], ['validationRejected', 0], ['findings', 5], ['duplicates', 0], ['quotationValid', 2], ['quotationDenominator', 4], ['missingClauseValid', 0], ['playbookReferenceValid', 4]]) {
    const bundle = load();
    bundle.report.cells[0].summary[key] = value;
    await refused(bundle, /cell baseline\/commercial\/base states/);
  }
  const usage = load();
  usage.report.cells[0].summary.usage.inputTokens = 1200;
  await refused(usage, /differs from the sum of its attempts/);
  // A rate where the harness states none would let a missing denominator read as 0 percent.
  const rate = load();
  rate.report.cells[1].summary.quotationValidityRate = 0;
  await refused(rate, /without its denominator/);
  const precision = load();
  precision.report.cells[0].summary.issueMatch = {expectedPerAttempt: 2, truePositives: 2, falsePositives: 2, falseNegatives: 0, microPrecision: 0.5, microRecall: 1};
  await refused(precision, /issue matching that its reference and attempts do not support/);
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
  await refused(extra, /registered, reported, missing and bundled attempt files do not match/);
});

test('a report bound to a different experiment is refused', async () => {
  await refused(editExperiment(load(), experiment => { experiment.notes = 'Another experiment.'; }), /different experiment file/);
  const hashed = load();
  hashed.report.experimentSha256 = hash('another experiment');
  await refused(hashed, /different experiment file/);
  // Hash re-bound, yet the report still describes another design or another arm.
  await refused(rebind(editExperiment(load(), experiment => { experiment.design.repetitions = 3; })), /different experiment, design or arms/);
  await refused(rebind(editExperiment(load(), experiment => { experiment.arms[0].promptVersion = 'contracts/candidates/other'; })), /different experiment, design or arms/);
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
});

test('a removed, repeated or reordered cell is refused', async () => {
  for (const change of [cells => cells.pop(), cells => cells.shift(), cells => cells.push(cells[5]), cells => cells.reverse()]) {
    const bundle = load();
    change(bundle.report.cells);
    await refused(bundle, /cells do not cover exactly arms x playbooks x variants/);
  }
});

test('an attempt with another mode is refused', async () => {
  const live = load();
  live.attempts[attemptFile].run.mode = 'LIVE';
  await refused(live, /does not have the digest its report row states/);
  await refused(rebind(live), /ran in LIVE, the design is REPLAY/);
  const design = rebind(editExperiment(load(), experiment => { experiment.design.mode = 'LIVE'; }));
  design.report.design.mode = 'LIVE';
  await refused(design, /ran in REPLAY, the design is LIVE/);
  await refused(rebind(editExperiment(load(), experiment => { experiment.design.mode = 'DRY_RUN'; })), /experiment file does not match its schema at design\.mode/);
});

test('a REPLAY arm must be the hand-authored fixture the page describes, and a row must repeat its recording', async () => {
  const model = editExperiment(load(), experiment => { experiment.arms[0].model = 'some-model'; });
  model.report.arms[0].model = model.attempts[attemptFile].run.model = 'some-model';
  await refused(rebind(model), /not the hand-authored fixture/);
  const producer = load();
  producer.attempts[attemptFile].run.promptVersion = 'contracts/candidates/other';
  await refused(rebind(producer), /was not produced by arm baseline/);
  const outcome = load(), cell = outcome.report.cells[0];
  Object.assign(cell.summary, {completed: 0, failed: 1});
  cell.attempts[0].outcome = 'FAILED';
  await refused(outcome, /differs from its recording/);
  const synthetic = load();
  synthetic.attempts[attemptFile].corpusKind = 'CLIENT';
  await refused(rebind(synthetic), /does not match its schema at corpusKind/);
});

test('comparisons name only arms of the experiment and state deltas or a reason', async () => {
  const comparison = {baseline: 'baseline', iteration: 'iteration', playbook: 'commercial', variant: 'base', comparable: false, reason: 'both arms need at least one completed attempt on these inputs'};
  for (const [item, reason] of [
    [comparison, /names an arm or cell outside the experiment/],
    [{...comparison, iteration: 'baseline'}, /names an arm or cell outside the experiment/],
    [{...comparison, comparable: true}, /does not match its schema at comparisons/],
    [{...comparison, comparable: true, note: 'n', deltas: {unknownRate: 0.5}}, /does not match its schema at comparisons/],
    [{...comparison, comparable: true, note: 'n', deltas: {duplicateRate: 2}}, /does not match its schema at comparisons/],
  ]) {
    const bundle = load();
    bundle.report.comparisons = [item];
    await refused(bundle, reason);
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
});

// The committed bundle is the dry run: one arm, no reference, no comparison. The checks for references,
// comparisons and injection counts need something to refuse, so the next tests extend the real bundle in
// memory by a second arm, one reference and two further recordings. Nothing of it is written to disk and
// none of it is a harness or model result; every count repeats the one real recording.
const iterationFile = 'attempts/iteration/commercial-base-r1.json', injectionFile = 'attempts/baseline/commercial-injection-r1.json', referenceFile = 'references/commercial-base.json';
const twoArms = ({reference = true} = {}) => {
  const bundle = load(), original = structuredClone(bundle.report.cells), recording = bundle.attempts[attemptFile];
  const recordedAt = {[iterationFile]: '2026-10-10T09:16:00.000Z', [injectionFile]: '2026-10-10T09:17:00.000Z'};
  for (const [name, startedAt] of Object.entries(recordedAt)) bundle.attempts[name] = {...structuredClone(recording), run: {...recording.run, startedAt}};
  editExperiment(bundle, experiment => {
    experiment.arms.push({...experiment.arms[0], id: 'iteration', role: 'ITERATION', hypothesis: 'Fabricated hypothesis.', change: 'Fabricated change.'});
    experiment.attempts.push(...experiment.attempts.map(slot => ({...slot, arm: 'iteration', file: slot.file.replace('attempts/baseline/', 'attempts/iteration/'), sha256: null})));
    for (const slot of experiment.attempts) if (Object.hasOwn(recordedAt, slot.file)) slot.sha256 = hash(slot.file);
    if (reference) experiment.references.push({playbook: 'commercial', variant: 'base', file: referenceFile, sha256: hash(referenceFile)});
  });
  const experiment = JSON.parse(bundle.experimentText), report = bundle.report, counts = {truePositives: 2, falsePositives: 2, falseNegatives: 1};
  const observed = (cell, name, extra = {}) => { Object.assign(cell.attempts[0], {file: name, startedAt: recordedAt[name], ...extra}); return cell; };
  const referenced = cell => {
    if (!reference) return cell;
    cell.attempts[0].issueMatch = {...counts};
    Object.assign(cell.summary, {referenceStatus: 'DRAFT', issueMatch: {expectedPerAttempt: 3, ...counts, microPrecision: 0.5, microRecall: 2 / 3}});
    return cell;
  };
  const injection = observed({...structuredClone(original[0]), variant: 'injection'}, injectionFile, {followedInjection: false, appendixAnchored: 0});
  Object.assign(injection.summary, {followedInjection: 0, appendixAnchored: 0});
  const iteration = structuredClone(original).map(cell => ({...cell, arm: 'iteration'}));
  referenced(observed(iteration[0], iterationFile));
  report.cells = [referenced(structuredClone(original[0])), original[1], injection, ...original.slice(3), ...iteration];
  report.arms = experiment.arms;
  report.missingAttemptFiles = experiment.attempts.filter(slot => slot.sha256 === null).map(slot => slot.file);
  report.comparisons = iteration.map(({playbook, variant}, index) => ({baseline: 'baseline', iteration: 'iteration', playbook, variant, ...(index === 0
    ? {comparable: true, deltas: {quotationValidityRate: 0, playbookValidityRate: 0, duplicateRate: 0, ...(reference ? {microPrecision: 0, microRecall: 0} : {}), completionRate: 0}, note: 'Fabricated.'}
    : {comparable: false, reason: 'both arms need at least one completed attempt on these inputs'})}));
  for (const name of Object.keys(recordedAt)) bundle.provenance.files[name] = hash(name);
  if (reference) {
    bundle.references[referenceFile] = {schema: 'mycounsel.candidate-reference.v1', sourceSha256: recording.source.sha256, playbookSha256: recording.playbook.sha256, status: 'DRAFT', reviewerEvidence: null, issues: [{}, {}, {}]};
    report.references = {'commercial/base': {status: 'DRAFT', expectedIssues: 3, reviewerEvidence: null}};
    bundle.provenance.files[referenceFile] = hash(referenceFile);
  }
  return rebind(bundle);
};

test('a second arm, a reference and an injection attempt verify once every stated count agrees', async () => {
  const {experiment, report, attempts} = await verifyExperimentBundle(twoArms());
  assert.deepEqual([experiment.arms.length, report.cells.length, report.comparisons.length, attempts.length], [2, 12, 6, 3]);
  assert.deepEqual(report.comparisons.map(item => item.comparable), [true, false, false, false, false, false]);
  assert.deepEqual(Object.keys(report.comparisons[0].deltas).sort(), ['completionRate', 'duplicateRate', 'microPrecision', 'microRecall', 'playbookValidityRate', 'quotationValidityRate']);
  const plain = await verifyExperimentBundle(twoArms({reference: false}));
  assert.deepEqual([plain.report.references, plain.report.cells[0].summary.issueMatch], [{}, null]);
});

test('comparisons cover every cell of every iteration arm and follow from the completed attempts', async () => {
  // An emptied list would make the page say that the experiment has no iteration arm.
  for (const change of [list => list.splice(0), list => list.pop(), list => list.push(list[0]), list => list.reverse()]) {
    const bundle = twoArms();
    change(bundle.report.comparisons);
    await refused(bundle, /comparisons do not cover exactly iteration arms x playbooks x variants/);
  }
  const promoted = twoArms();
  promoted.report.comparisons[1] = {...promoted.report.comparisons[0], variant: 'changed'};
  await refused(promoted, /comparison for iteration\/commercial\/changed is marked comparable or not against the completed attempts of its cells/);
  const demoted = twoArms();
  demoted.report.comparisons[0] = {...demoted.report.comparisons[1], variant: 'base'};
  await refused(demoted, /comparison for iteration\/commercial\/base is marked comparable or not against the completed attempts of its cells/);
  // A difference appears exactly where both cells state the rate.
  const omitted = twoArms();
  delete omitted.report.comparisons[0].deltas.duplicateRate;
  await refused(omitted, /states a difference for a rate its cells do not both state, or omits one they do/);
  const invented = twoArms({reference: false});
  invented.report.comparisons[0].deltas.microPrecision = 0.5;
  await refused(invented, /states a difference for a rate its cells do not both state, or omits one they do/);
});

test('precision and recall are bound to the finding count, the reference and their denominators', async () => {
  for (const change of [
    cell => { cell.summary.issueMatch.microPrecision = null; },
    cell => { cell.summary.issueMatch.microRecall = null; },
    // No counted finding at all, yet a precision of 0: a missing denominator would read as 0 percent.
    cell => {
      for (const match of [cell.attempts[0].issueMatch, cell.summary.issueMatch]) Object.assign(match, {truePositives: 0, falsePositives: 0, falseNegatives: 3});
      Object.assign(cell.summary.issueMatch, {microPrecision: 0, microRecall: 0});
    },
    // More matched findings than findings, and fewer expected issues than the reference holds.
    cell => { cell.attempts[0].issueMatch.truePositives = cell.summary.issueMatch.truePositives = 4; },
    cell => { cell.attempts[0].issueMatch.falseNegatives = cell.summary.issueMatch.falseNegatives = 0; },
  ]) {
    const bundle = twoArms();
    change(bundle.report.cells[0]);
    await refused(bundle, /cell baseline\/commercial\/base states issue matching that its reference and attempts do not support/);
  }
});

test('a reference marked independently reviewed needs an evidence reference', async () => {
  const marked = evidence => {
    const bundle = twoArms();
    for (const item of [bundle.references[referenceFile], bundle.report.references['commercial/base']]) Object.assign(item, {status: 'INDEPENDENTLY_REVIEWED', reviewerEvidence: evidence});
    for (const index of [0, 6]) bundle.report.cells[index].summary.referenceStatus = 'INDEPENDENTLY_REVIEWED';
    return bundle;
  };
  await verifyExperimentBundle(marked('EVD-TEST'));
  for (const evidence of [null, '']) await refused(marked(evidence), /claims independent review without an evidence reference/);
});

test('an injection count follows the rule the report states', async () => {
  const followed = twoArms(), cell = followed.report.cells[2];
  assert.deepEqual([cell.playbook, cell.variant, cell.attempts[0].findingCount], ['commercial', 'injection', 4]);
  cell.attempts[0].followedInjection = true;
  cell.summary.followedInjection = 1;
  await refused(followed, /cell baseline\/commercial\/injection states injection counts that do not agree with its attempts/);
  const anchored = twoArms();
  anchored.report.cells[2].attempts[0].appendixAnchored = anchored.report.cells[2].summary.appendixAnchored = 5;
  await refused(anchored, /cell baseline\/commercial\/injection states injection counts that do not agree with its attempts/);
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

// The exporter is plain python3. Where python3 is missing this test is skipped; the checks above still run.
const python = spawnSync('python3', ['-c', 'import sys; sys.exit(sys.version_info < (3, 9))']);
test('the exporter refuses a local path, a superseded corpus, stale provenance and unbound files before it copies anything', {skip: python.status === 0 ? false : 'python3 3.9 or later is not available'}, () => {
  const script = fileURLToPath(new URL('../scripts/export-candidate-experiment.py', import.meta.url));
  const dump = value => `${JSON.stringify(value, null, 2)}\n`, manifest = '{}\n';
  const planned = {...json('experiment.json'), corpusManifestSha256: hash(manifest)};
  // A stand-in harness beside a copy of the exporter, built from the exported bundle in a temporary directory.
  const exportFrom = change => {
    const root = mkdtempSync(join(tmpdir(), 'candidate-experiment-export-'));
    try {
      const web = join(root, 'contract-eval-web'), harness = join(root, 'contract-review-eval-harness'), corpus = join(harness, 'candidates/mycounsel'), source = join(corpus, 'experiments', id);
      for (const folder of [join(web, 'scripts'), join(source, 'attempts/baseline'), join(harness, 'src/contract_eval')]) mkdirSync(folder, {recursive: true});
      copyFileSync(script, join(web, 'scripts/export-candidate-experiment.py'));
      const modules = ['candidate_experiment.py', 'candidates.py'].map(name => join(harness, 'src/contract_eval', name));
      for (const path of modules) writeFileSync(path, '# stand-in\n');
      writeFileSync(join(corpus, 'manifest.json'), manifest);
      writeFileSync(join(source, attemptFile), file(attemptFile));
      // report.json is written last, as after an aggregation, and bound to the experiment file beside it.
      const write = experiment => {
        writeFileSync(join(source, 'experiment.json'), dump(experiment));
        writeFileSync(join(source, 'report.json'), dump({...json('report.json'), corpusManifestSha256: experiment.corpusManifestSha256, experimentSha256: hash(dump(experiment))}));
      };
      write(planned);
      change({corpus, source, modules, write});
      const result = spawnSync('python3', [join(web, 'scripts/export-candidate-experiment.py'), id], {encoding: 'utf8'});
      return {status: result.status, message: result.stderr.trim(), copied: existsSync(join(web, 'public'))};
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  };
  // The stand-in passes every check. Outside a git repository the export then stops at its read-only git call.
  assert.doesNotMatch(exportFrom(() => {}).message, /Export refused/);
  const later = new Date(Date.now() + 60000);
  for (const [change, reason] of [
    // A relative path can name directories of the exporting machine just as an absolute one does.
    [({write}) => write({...planned, corpusDir: '../../../../../outside/acme-corpus'}), /corpusDir leaves the harness/],
    [({write}) => write({...planned, corpusDir: '/outside/acme-corpus'}), /corpusDir is an absolute local path/],
    [({corpus}) => writeFileSync(join(corpus, 'manifest.json'), '{"changed": true}\n'), /corpus manifest is missing or changed since the experiment was planned/],
    [({modules}) => utimesSync(modules[1], later, later), /candidates\.py is missing or changed after report\.json was written/],
    [({source}) => writeFileSync(join(source, 'experiment.json'), dump({...planned, notes: 'Another experiment.'})), /report\.json is bound to a different experiment\.json/],
    [({source}) => writeFileSync(join(source, attemptFile), `${file(attemptFile)} `), /registered attempt \S+ has changed on disk/],
    [({source}) => copyFileSync(join(source, attemptFile), join(source, 'attempts/baseline/dora-base-r1.json')), /dora-base-r1\.json exists but is not registered/],
    [({source, write}) => {
      const bytes = dump({...json(attemptFile), corpusKind: 'CLIENT'});
      writeFileSync(join(source, attemptFile), bytes);
      write({...planned, attempts: planned.attempts.map(slot => slot.file === attemptFile ? {...slot, sha256: hash(bytes)} : slot)});
    }, /is not a synthetic recording/],
  ]) {
    const result = exportFrom(change);
    assert.equal(result.status, 1, result.message);
    assert.match(result.message, /^Export refused: /);
    assert.match(result.message, reason);
    assert.equal(result.copied, false, 'a refused export must copy nothing');
  }
});

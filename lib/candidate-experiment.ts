/**
 * Presentation binding for one candidate experiment bundle exported from the Python harness.
 *
 * The harness owns every number. Nothing here scores a finding or recomputes a rate. The checks
 * establish that the files belong together, that each recording sits in the cell the experiment
 * assigns to it, and that the integer counts the report states agree with each other. Anything
 * else throws, so a page built on this module renders a verified bundle or nothing.
 */
import { z } from 'zod';
import { canonicalRecording } from './candidate-replay.ts';

export const EXPERIMENT_SCHEMA = 'mycounsel.candidate-experiment.v1';
export const REPORT_SCHEMA = 'mycounsel.candidate-experiment-report.v1';
export const RECORDING_SCHEMA = 'mycounsel.candidate-run.v1';
export const REFERENCE_SCHEMA = 'mycounsel.candidate-reference.v1';
export const BUNDLE_SCHEMA = 'evidence-lab.candidate-experiment-bundle.v1';
/** The only REPLAY producer the viewer describes as a hand-authored fixture. */
export const REPLAY_FIXTURE_MODEL = 'hand-authored-replay-fixture';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
const share = z.number().min(0).max(1).nullable();
const delta = z.number().min(-1).max(1).optional();
const outcome = z.enum(['COMPLETED', 'REFUSED', 'FAILED']);
const validation = z.enum(['ACCEPTED', 'REJECTED', 'NO_OUTPUT']);
const referenceStatus = z.enum(['DRAFT', 'INDEPENDENTLY_REVIEWED']);

const design = z.object({
  mode: z.enum(['REPLAY', 'LIVE']),
  playbooks: z.array(z.string().min(1)).min(1),
  variants: z.array(z.string().min(1)).min(1),
  repetitions: z.number().int().min(1).max(20),
  injectionVariants: z.array(z.string()).default([]),
});
const arm = z.object({
  id: z.string().min(1),
  role: z.enum(['BASELINE', 'ITERATION']),
  promptVersion: z.string().min(1),
  codeRevision: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.string().min(1),
  hypothesis: z.string().nullable().default(null),
  change: z.string().nullable().default(null),
  budgetReservation: z.object({ ledgerEntryId: z.string().min(1), recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountMinorUnits: count }).nullable().default(null),
});
const experimentSchema = z.object({
  schema: z.literal(EXPERIMENT_SCHEMA),
  experimentId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  corpusDir: z.string(),
  corpusManifestSha256: sha256,
  instructionsSha256: sha256,
  design,
  arms: z.array(arm).min(1),
  attempts: z.array(z.object({ arm: z.string(), playbook: z.string(), variant: z.string(), repetition: z.number().int().min(1), file: z.string().min(1), sha256: sha256.nullable().default(null) })),
  references: z.array(z.object({ playbook: z.string(), variant: z.string(), file: z.string().min(1), sha256 })).default([]),
  notes: z.string().default(''),
});

// outputTokens is every billed output token, thinking included; thinkingTokens is a share of it.
const usage = z.object({ inputTokens: count, outputTokens: count, cacheReadTokens: count.nullable(), thinkingTokens: count.nullable(), providerRequestId: z.string().max(200).nullable() })
  .refine(value => value.thinkingTokens === null || value.thinkingTokens <= value.outputTokens, 'thinking tokens exceed billed output tokens');
const issueCounts = z.object({ truePositives: count, falsePositives: count, falseNegatives: count });
const attemptRow = z.object({
  repetition: z.number().int().min(1), file: z.string().min(1), recordingSha256: sha256,
  startedAt: z.string(), elapsedMs: count, outcome, validation, validationError: z.string().nullable(),
  findingCount: count, duplicateCount: count,
  quotationValid: count, quotationDenominator: count,
  missingClauseValid: count, missingClauseDenominator: count,
  playbookReferenceValid: count,
  issueMatch: issueCounts.nullable(), usage: usage.nullable(),
  followedInjection: z.boolean().optional(), appendixAnchored: count.optional(),
});
const cellSummary = z.object({
  planned: count, observed: count, missingObservations: count,
  completed: count, refused: count, failed: count,
  validationAccepted: count, validationRejected: count,
  findings: count, duplicates: count,
  quotationValid: count, quotationDenominator: count, quotationValidityRate: share,
  missingClauseValid: count, missingClauseDenominator: count,
  playbookReferenceValid: count, playbookValidityRate: share, duplicateRate: share,
  referenceStatus: referenceStatus.nullable(),
  issueMatch: issueCounts.extend({ expectedPerAttempt: count, microPrecision: share, microRecall: share }).nullable(),
  usage: z.object({ attemptsWithUsage: count, inputTokens: count, outputTokens: count }),
  followedInjection: count.optional(), appendixAnchored: count.optional(),
});
const comparedCell = { baseline: z.string(), iteration: z.string(), playbook: z.string(), variant: z.string() };
// Strict: a delta this viewer has no column for must stop the page, not disappear from it.
const deltas = z.object({ microPrecision: delta, microRecall: delta, quotationValidityRate: delta, playbookValidityRate: delta, duplicateRate: delta, completionRate: delta }).strict();
const comparison = z.discriminatedUnion('comparable', [
  z.object({ ...comparedCell, comparable: z.literal(true), deltas, note: z.string() }),
  z.object({ ...comparedCell, comparable: z.literal(false), reason: z.string().min(1) }),
]);
const reportSchema = z.object({
  schema: z.literal(REPORT_SCHEMA),
  experimentId: z.string(),
  experimentSha256: sha256,
  corpusManifestSha256: sha256,
  design,
  arms: z.array(arm).min(1),
  distinctInputKeys: count,
  references: z.record(z.object({ status: referenceStatus, expectedIssues: count, reviewerEvidence: z.string().nullable() })),
  missingAttemptFiles: z.array(z.string()),
  rules: z.object({ matching: z.string().min(1), injection: z.string().min(1) }),
  cells: z.array(z.object({ arm: z.string(), playbook: z.string(), variant: z.string(), summary: cellSummary, attempts: z.array(attemptRow) })),
  comparisons: z.array(comparison),
  caveats: z.array(z.string()),
});
// Only the fields this module binds or the page shows. The digest covers the whole recording.
const recordingSchema = z.object({
  schema: z.literal(RECORDING_SCHEMA),
  corpusKind: z.literal('SYNTHETIC'),
  source: z.object({ sha256 }),
  playbook: z.object({ sha256 }),
  instructionsSha256: sha256,
  // Exactly one of usage and its reason: with usage the reason is null, without usage it is a text that is not blank.
  run: z.object({
    mode: z.enum(['REPLAY', 'LIVE']), model: z.string(), promptVersion: z.string(), codeRevision: z.string(),
    workingTreeDirty: z.boolean(), startedAt: z.string(), elapsedMs: count, outcome,
    usage: usage.nullable(), usageUnavailableReason: z.string().nullable(),
  }).refine(run => run.usage === null ? !!run.usageUnavailableReason?.trim() : run.usageUnavailableReason === null, 'an attempt records usage or the reason it is unavailable, never both or neither'),
  findings: z.array(z.unknown()).nullable(),
  validation: z.object({ status: validation, errorCode: z.string().nullable() }),
});
const referenceSchema = z.object({
  schema: z.literal(REFERENCE_SCHEMA), sourceSha256: sha256, playbookSha256: sha256,
  status: referenceStatus, reviewerEvidence: z.string().nullable(), issues: z.array(z.unknown()),
});
const provenanceSchema = z.object({
  schema: z.literal(BUNDLE_SCHEMA),
  experimentId: z.string(),
  origin: z.string(),
  harnessHead: z.string().regex(/^[a-f0-9]{40}$/),
  harnessWorkingTreeDirty: z.boolean(),
  harnessFiles: z.record(sha256),
  files: z.record(sha256),
  scope: z.string().min(1),
});

export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentReport = z.infer<typeof reportSchema>;
export type Arm = z.infer<typeof arm>;
export type Cell = ExperimentReport['cells'][number];
export type CellSummary = z.infer<typeof cellSummary>;
export type AttemptRow = z.infer<typeof attemptRow>;
export type Comparison = z.infer<typeof comparison>;
export type Recording = z.infer<typeof recordingSchema>;
export type BundleProvenance = z.infer<typeof provenanceSchema>;
export type ExperimentBundle = {
  /** Exact content of experiment.json: the bytes the report's experimentSha256 was taken over. */
  experimentText: string;
  report: unknown;
  provenance: unknown;
  /** Recordings by the path the experiment registers them under, relative to the experiment directory. */
  attempts: Record<string, unknown>;
  references: Record<string, unknown>;
};
export type VerifiedAttempt = { arm: string; playbook: string; variant: string; row: AttemptRow; recording: Recording };
export type VerifiedExperiment = { experiment: Experiment; report: ExperimentReport; provenance: BundleProvenance; attempts: VerifiedAttempt[] };

/**
 * The text the harness writes for experiment.json (`json.dumps(..., indent=2, ensure_ascii=False)`
 * plus a final newline), rebuilt from parsed JSON. A bundler hands a page the parsed value, never
 * the bytes; this restores them for the hash check. It holds for the integer-and-string content
 * of an experiment file, which the exporter asserts and the tests prove against the real bytes.
 * Any other content yields different text and the hash check refuses it.
 */
export const experimentFileText = (experiment: unknown): string => `${JSON.stringify(experiment, null, 2)}\n`;

function refuse(reason: string): never {
  throw new Error(`Candidate experiment bundle refused: ${reason}`);
}
function parse<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown, what: string): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  return refuse(`${what} does not match its schema at ${issue.path.join('.') || 'the top level'}: ${issue.message}`);
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const same = (left: unknown, right: unknown) => canonicalRecording(left) === canonicalRecording(right);
const distinct = (values: string[]) => new Set(values).size === values.length;
const sameSet = (left: string[], right: string[]) => distinct(left) && distinct(right) && left.length === right.length && left.every(value => right.includes(value));

export async function verifyExperimentBundle(bundle: ExperimentBundle): Promise<VerifiedExperiment> {
  let parsed: unknown;
  try { parsed = JSON.parse(bundle.experimentText); } catch { refuse('the experiment file is not JSON'); }
  const experiment = parse(experimentSchema, parsed, 'the experiment file');
  const report = parse(reportSchema, bundle.report, 'the report');
  const provenance = parse(provenanceSchema, bundle.provenance, 'the provenance file');
  const { design } = experiment;

  // The report belongs to exactly this experiment file.
  if (await digest(bundle.experimentText) !== report.experimentSha256) refuse('the report is bound to a different experiment file');
  if (report.experimentId !== experiment.experimentId || report.corpusManifestSha256 !== experiment.corpusManifestSha256
    || !same(report.design, design) || !same(report.arms, experiment.arms)) refuse('the report states a different experiment, design or arms than the experiment file');
  if (!distinct(design.playbooks) || !distinct(design.variants) || design.injectionVariants.some(variant => !design.variants.includes(variant))) refuse('the design is not well formed');
  const arms = new Map(experiment.arms.map(item => [item.id, item]));
  if (arms.size !== experiment.arms.length || experiment.arms.filter(item => item.role === 'BASELINE').length !== 1) refuse('the arms need unique ids and exactly one baseline');
  // The page says that a REPLAY attempt is a hand-authored fixture; this keeps that sentence true.
  if (design.mode === 'REPLAY' && experiment.arms.some(item => item.model !== REPLAY_FIXTURE_MODEL)) refuse('a REPLAY arm is not the hand-authored fixture this viewer describes');

  // Every planned cell appears once, in the order the harness reports it.
  const cellKey = (armId: string, playbook: string, variant: string) => JSON.stringify([armId, playbook, variant]);
  const planned = experiment.arms.flatMap(item => design.playbooks.flatMap(playbook => design.variants.map(variant => cellKey(item.id, playbook, variant))));
  if (!same(report.cells.map(cell => cellKey(cell.arm, cell.playbook, cell.variant)), planned)) refuse('the cells do not cover exactly arms x playbooks x variants');

  const referenceKeys = experiment.references.map(reference => `${reference.playbook}/${reference.variant}`);
  if (!sameSet(referenceKeys, Object.keys(report.references)) || !sameSet(experiment.references.map(reference => reference.file), Object.keys(bundle.references))) refuse('the references in the report or the bundle are not the registered references');

  const slots = new Map(experiment.attempts.map(slot => [slot.file, slot]));
  if (slots.size !== experiment.attempts.length) refuse('two attempt slots share a file');
  const attempts: VerifiedAttempt[] = [];
  for (const cell of report.cells) {
    const { summary, attempts: rows } = cell, where = `cell ${cell.arm}/${cell.playbook}/${cell.variant}`;
    const total = (pick: (row: AttemptRow) => number | boolean) => rows.reduce((sum, row) => sum + Number(pick(row)), 0);
    const completed = rows.filter(row => row.outcome === 'COMPLETED');
    const reference = Object.hasOwn(report.references, `${cell.playbook}/${cell.variant}`) ? report.references[`${cell.playbook}/${cell.variant}`] : null;
    const injection = design.injectionVariants.includes(cell.variant);
    // Attempt denominators.
    if (summary.planned !== design.repetitions || summary.observed !== rows.length || summary.missingObservations !== summary.planned - summary.observed
      || summary.completed + summary.refused + summary.failed !== summary.observed
      || summary.completed !== completed.length || summary.refused !== total(row => row.outcome === 'REFUSED') || summary.failed !== total(row => row.outcome === 'FAILED')
      || !distinct(rows.map(row => String(row.repetition))) || rows.some(row => row.repetition > design.repetitions)) refuse(`${where} states attempt counts that do not agree with its attempts`);
    // Integer counts the summary adds up from its attempt rows. No rate is recomputed.
    if (summary.validationAccepted !== total(row => row.validation === 'ACCEPTED') || summary.validationRejected !== total(row => row.validation === 'REJECTED')
      || summary.findings !== total(row => row.findingCount) || summary.duplicates !== total(row => row.duplicateCount)
      || summary.quotationValid !== total(row => row.quotationValid) || summary.quotationDenominator !== total(row => row.quotationDenominator)
      || summary.missingClauseValid !== total(row => row.missingClauseValid) || summary.missingClauseDenominator !== total(row => row.missingClauseDenominator)
      || summary.playbookReferenceValid !== total(row => row.playbookReferenceValid)
      || summary.usage.attemptsWithUsage !== total(row => row.usage !== null)
      || summary.usage.inputTokens !== total(row => row.usage?.inputTokens ?? 0) || summary.usage.outputTokens !== total(row => row.usage?.outputTokens ?? 0)) refuse(`${where} states a count that differs from the sum of its attempts`);
    // A numerator never exceeds its denominator, and a rate exists exactly when its denominator does.
    if (summary.quotationValid > summary.quotationDenominator || summary.missingClauseValid > summary.missingClauseDenominator
      || summary.playbookReferenceValid > summary.findings || summary.duplicates > summary.findings
      || (summary.quotationValidityRate === null) !== (summary.quotationDenominator === 0)
      || (summary.playbookValidityRate === null) !== (summary.findings === 0) || (summary.duplicateRate === null) !== (summary.findings === 0)) refuse(`${where} states a rate or count without its denominator`);
    // Precision and recall exist only against a registered reference and a completed attempt.
    if (summary.referenceStatus !== (reference?.status ?? null) || (summary.issueMatch !== null) !== (reference !== null && completed.length > 0)
      || rows.some(row => (row.issueMatch !== null) !== (reference !== null))
      // Every finding is a true or a false positive; every expected issue is matched or missed.
      || rows.some(row => row.issueMatch !== null && (row.issueMatch.truePositives + row.issueMatch.falsePositives !== row.findingCount
        || row.issueMatch.truePositives + row.issueMatch.falseNegatives !== reference?.expectedIssues))
      || (summary.issueMatch !== null && (summary.issueMatch.expectedPerAttempt !== reference?.expectedIssues
        || (summary.issueMatch.microPrecision === null) !== (summary.issueMatch.truePositives + summary.issueMatch.falsePositives === 0)
        || (summary.issueMatch.microRecall === null) !== (summary.issueMatch.truePositives + summary.issueMatch.falseNegatives === 0)
        || summary.issueMatch.truePositives !== completed.reduce((sum, row) => sum + (row.issueMatch?.truePositives ?? 0), 0)
        || summary.issueMatch.falsePositives !== completed.reduce((sum, row) => sum + (row.issueMatch?.falsePositives ?? 0), 0)
        || summary.issueMatch.falseNegatives !== completed.reduce((sum, row) => sum + (row.issueMatch?.falseNegatives ?? 0), 0)))) refuse(`${where} states issue matching that its reference and attempts do not support`);
    if ((summary.followedInjection !== undefined) !== injection || (summary.appendixAnchored !== undefined) !== injection
      || rows.some(row => (row.followedInjection !== undefined) !== injection || (row.appendixAnchored !== undefined) !== injection)
      // The injection rule of the report: followed means completed with zero findings.
      || rows.some(row => injection && (row.followedInjection !== (row.outcome === 'COMPLETED' && row.findingCount === 0) || (row.appendixAnchored ?? 0) > row.findingCount))
      || (injection && (summary.followedInjection !== total(row => row.followedInjection === true) || summary.appendixAnchored !== total(row => row.appendixAnchored ?? 0)))) refuse(`${where} states injection counts that do not agree with its attempts`);

    for (const row of rows) {
      const slot = slots.get(row.file), producer = arms.get(cell.arm)!;
      if (!slot || slot.sha256 === null || slot.arm !== cell.arm || slot.playbook !== cell.playbook || slot.variant !== cell.variant || slot.repetition !== row.repetition) refuse(`attempt ${row.file} is not in the slot the experiment assigns to it`);
      if (attempts.some(attempt => attempt.row.file === row.file || attempt.row.recordingSha256 === row.recordingSha256)) refuse(`attempt ${row.file} or its recording is reported twice`);
      if (!Object.hasOwn(bundle.attempts, row.file)) refuse(`the bundle has no recording for ${row.file}`);
      const raw = bundle.attempts[row.file], recording = parse(recordingSchema, raw, `recording ${row.file}`);
      if (await digest(canonicalRecording(raw)) !== row.recordingSha256) refuse(`recording ${row.file} does not have the digest its report row states`);
      if (recording.run.mode !== design.mode) refuse(`recording ${row.file} ran in ${recording.run.mode}, the design is ${design.mode}`);
      if (recording.run.promptVersion !== producer.promptVersion || recording.run.codeRevision !== producer.codeRevision || recording.run.model !== producer.model
        || recording.instructionsSha256 !== experiment.instructionsSha256) refuse(`recording ${row.file} was not produced by arm ${cell.arm} of this experiment`);
      // The row repeats facts of the recording; they must be the same facts.
      if (row.outcome !== recording.run.outcome || row.startedAt !== recording.run.startedAt || row.elapsedMs !== recording.run.elapsedMs
        || row.validation !== recording.validation.status || row.validationError !== recording.validation.errorCode
        || row.findingCount !== (recording.findings?.length ?? 0) || !same(row.usage, recording.run.usage)) refuse(`the report row for ${row.file} differs from its recording`);
      attempts.push({ arm: cell.arm, playbook: cell.playbook, variant: cell.variant, row, recording });
    }
  }

  // Every slot is accounted for: recorded and reported, or listed as not run. Nothing else is bundled.
  const reported = attempts.map(attempt => attempt.row.file);
  if (!sameSet(reported, experiment.attempts.filter(slot => slot.sha256 !== null).map(slot => slot.file))
    || !sameSet(report.missingAttemptFiles, experiment.attempts.filter(slot => slot.sha256 === null).map(slot => slot.file))
    || !sameSet(reported, Object.keys(bundle.attempts))) refuse('the registered, reported, missing and bundled attempt files do not match');
  // One playbook and one document per name, so a recording cannot sit under another cell's label.
  const inputs = new Map<string, string>();
  for (const { playbook, variant, recording } of attempts) {
    for (const [name, hash] of [[`playbook ${playbook}`, recording.playbook.sha256], [`variant ${variant}`, recording.source.sha256]]) {
      if ((inputs.get(name) ?? hash) !== hash) refuse(`two recordings filed under ${name} used different inputs`);
      inputs.set(name, hash);
    }
  }
  if (new Set(attempts.map(({ recording }) => cellKey(recording.source.sha256, recording.playbook.sha256, `${recording.instructionsSha256}:${recording.run.mode}`))).size !== report.distinctInputKeys) refuse('the report states a different number of distinct inputs than the recordings show');

  for (const slot of experiment.references) {
    const key = `${slot.playbook}/${slot.variant}`, reference = parse(referenceSchema, bundle.references[slot.file], `reference ${slot.file}`), stated = report.references[key];
    if (!design.playbooks.includes(slot.playbook) || !design.variants.includes(slot.variant)
      || reference.status !== stated.status || reference.issues.length !== stated.expectedIssues || reference.reviewerEvidence !== stated.reviewerEvidence
      || attempts.some(attempt => (attempt.playbook === slot.playbook && attempt.recording.playbook.sha256 !== reference.playbookSha256)
        || (attempt.variant === slot.variant && attempt.recording.source.sha256 !== reference.sourceSha256))) refuse(`reference ${slot.file} is not the reference the report describes for ${key}`);
    if (reference.status === 'INDEPENDENTLY_REVIEWED' && !reference.reviewerEvidence) refuse(`reference ${slot.file} claims independent review without an evidence reference`);
  }

  for (const item of report.comparisons) {
    if (arms.get(item.baseline)?.role !== 'BASELINE' || arms.get(item.iteration)?.role !== 'ITERATION'
      || !design.playbooks.includes(item.playbook) || !design.variants.includes(item.variant)) refuse('a comparison names an arm or cell outside the experiment');
  }
  // One comparison per iteration arm and cell, in the order the harness reports them. The page says
  // "no iteration arm" when the list is empty, so a missing row must stop the page.
  const compared = experiment.arms.filter(item => item.role === 'ITERATION').flatMap(item => design.playbooks.flatMap(playbook => design.variants.map(variant => cellKey(item.id, playbook, variant))));
  if (!same(report.comparisons.map(item => cellKey(item.iteration, item.playbook, item.variant)), compared)) refuse('the comparisons do not cover exactly iteration arms x playbooks x variants');
  // A row is comparable exactly when both cells hold a completed attempt, and it states a
  // difference exactly where both cells state the rate. No difference is recomputed.
  const summaries = new Map(report.cells.map(cell => [cellKey(cell.arm, cell.playbook, cell.variant), cell.summary]));
  for (const item of report.comparisons) {
    const before = summaries.get(cellKey(item.baseline, item.playbook, item.variant))!, after = summaries.get(cellKey(item.iteration, item.playbook, item.variant))!;
    const where = `the comparison for ${item.iteration}/${item.playbook}/${item.variant}`;
    if (item.comparable !== (before.completed > 0 && after.completed > 0)) refuse(`${where} is marked comparable or not against the completed attempts of its cells`);
    if (!item.comparable) continue;
    const both = (pick: (summary: CellSummary) => number | null | undefined) => typeof pick(before) === 'number' && typeof pick(after) === 'number';
    if ((item.deltas.quotationValidityRate !== undefined) !== both(summary => summary.quotationValidityRate)
      || (item.deltas.playbookValidityRate !== undefined) !== both(summary => summary.playbookValidityRate)
      || (item.deltas.duplicateRate !== undefined) !== both(summary => summary.duplicateRate)
      || (item.deltas.microPrecision !== undefined) !== both(summary => summary.issueMatch?.microPrecision)
      || (item.deltas.microRecall !== undefined) !== both(summary => summary.issueMatch?.microRecall)
      || item.deltas.completionRate === undefined) refuse(`${where} states a difference for a rate its cells do not both state, or omits one they do`);
  }

  // The export manifest describes this bundle: same experiment file, same set of files.
  if (provenance.experimentId !== experiment.experimentId || provenance.files['experiment.json'] !== report.experimentSha256
    || !sameSet(Object.keys(provenance.files), ['experiment.json', 'report.json', ...reported, ...experiment.references.map(slot => slot.file)])
    || experiment.attempts.some(slot => slot.sha256 !== null && provenance.files[slot.file] !== slot.sha256)
    || experiment.references.some(slot => provenance.files[slot.file] !== slot.sha256)) refuse('the provenance file describes a different bundle');

  return { experiment, report, provenance, attempts };
}

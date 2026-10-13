/**
 * Presentation binding for one candidate experiment bundle exported from the Python harness.
 *
 * The harness owns every number. Nothing here scores a finding or recomputes a rate. The checks
 * establish that the files belong together, that each recording sits in the cell the experiment
 * assigns to it, that a dispatch without a recording is stated as one by the experiment file and the
 * report alike, and that the integer counts the report states agree with each other. Anything
 * else throws, so a page built on this module renders a verified bundle or nothing.
 *
 * The schemas are strict where the report is concerned: a field this module does not know would
 * be a statement of the report that the page silently leaves out, so it stops the page instead.
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
/**
 * The SHA-256 of a file without content. The recorder creates a slot file empty before its call and
 * fills it afterwards, so the harness registers an empty slot file as a dispatch that left no recording.
 */
export const EMPTY_SLOT_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** The code the harness writes in the report row of a dispatch that left no recording. */
export const NO_RECORDING = 'NO_RECORDING';
/** The metrics the harness compares between baseline and iteration, in its order. */
export const COMPARED_METRICS = ['completionRate', 'quotationValidityRate', 'playbookValidityRate', 'duplicateRate', 'microPrecision', 'microRecall', 'postValidationPrecision', 'postValidationRecall', 'entryLevelRecall'] as const;
/** The harness computes a difference in floating point; iteration minus baseline is checked within this tolerance. */
const DELTA_TOLERANCE = 1e-9;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
const share = z.number().min(0).max(1);
const outcome = z.enum(['COMPLETED', 'REFUSED', 'FAILED']);
const recorderValidation = z.enum(['ACCEPTED', 'REJECTED', 'NO_OUTPUT']);
const referenceStatus = z.enum(['DRAFT', 'INDEPENDENTLY_REVIEWED']);
const referenceRoute = z.enum(['SINGLE_ANNOTATION', 'ADJUDICATED']);

const design = z.object({
  mode: z.enum(['REPLAY', 'LIVE']),
  playbooks: z.array(z.string().min(1)).min(1),
  variants: z.array(z.string().min(1)).min(1),
  repetitions: z.number().int().min(1).max(20),
  injectionVariants: z.array(z.string()).default([]),
  // variant -> playbook entries that variant repairs.
  repairedEntries: z.record(z.array(z.string().min(1)).min(1)).default({}),
}).strict();
// The snapshot an arm keeps of its reservation. The experiment file and the report both carry it.
const reservation = z.object({
  ledgerEntryId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/), recordedAt: z.string().min(1),
  amountMinorUnits: z.number().int().min(1).safe(), preregistrationSha256: sha256,
  // Hash of the reservation entry as the spend ledger stored it, so that the price terms and token maxima
  // a settlement is recomputed from cannot change in the ledger alone. The ledger is outside the bundle.
  ledgerEntrySha256: sha256,
}).strict();
const arm = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  role: z.enum(['BASELINE', 'ITERATION']),
  promptVersion: z.string().min(1),
  codeRevision: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.string().min(1),
  hypothesis: z.string().nullable().default(null),
  change: z.string().nullable().default(null),
  budgetReservation: reservation.nullable().default(null),
}).strict();
const sourceFile = z.object({ file: z.string().regex(/^references\/sources\/[A-Za-z0-9._-]+\.json$/), sha256 }).strict();
const experimentSchema = z.object({
  schema: z.literal(EXPERIMENT_SCHEMA),
  experimentId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  corpusDir: z.string(),
  corpusManifestSha256: sha256,
  instructionsSha256: sha256,
  design,
  arms: z.array(arm).min(1).max(2),
  attempts: z.array(z.object({ arm: z.string(), playbook: z.string(), variant: z.string(), repetition: z.number().int().min(1), file: z.string().min(1), sha256: sha256.nullable().default(null) }).strict()),
  references: z.array(z.object({
    playbook: z.string(), variant: z.string(), file: z.string().min(1), sha256,
    // The two annotations and the adjudication record an adjudicated reference was resolved from.
    sources: z.object({ annotationA: sourceFile, annotationB: sourceFile, adjudication: sourceFile }).strict().nullable().default(null),
  }).strict()).default([]),
  notes: z.string().default(''),
}).strict();

// outputTokens is every billed output token, thinking included; the two shares stay within their totals.
const usage = z.object({ inputTokens: count, outputTokens: count, cacheReadTokens: count.nullable(), thinkingTokens: count.nullable(), providerRequestId: z.string().max(200).nullable() }).strict()
  .refine(value => value.thinkingTokens === null || value.thinkingTokens <= value.outputTokens, 'thinking tokens exceed billed output tokens')
  .refine(value => value.cacheReadTokens === null || value.cacheReadTokens <= value.inputTokens, 'cached tokens exceed input tokens');
const matchCounts = { truePositives: count, falsePositives: count, falseNegatives: count };
// A rate is null when its denominator is zero; the verifier holds each one to that.
const matchRates = { microPrecision: share.nullable(), microRecall: share.nullable() };
const attemptRow = z.object({
  // Recording hash, start and duration are null together, and only in the row of a dispatch that left no
  // recording. The verifier holds a row to one of the two shapes; nothing in between passes.
  repetition: z.number().int().min(1), file: z.string().min(1), recordingSha256: sha256.nullable(), findingsSha256: sha256.nullable(),
  startedAt: z.string().nullable(), elapsedMs: count.nullable(), outcome,
  // The recorder's own verdict. The harness reports it beside its recomputed validity and uses it in no figure.
  recorderValidation, recorderValidationError: z.string().nullable(), allFindingsValid: z.boolean(),
  findingCount: count, duplicateCount: count, trivialQuotationCount: count,
  quotationValid: count, quotationDenominator: count,
  missingClauseValid: count, missingClauseDenominator: count,
  playbookReferenceValid: count,
  issueMatch: z.object(matchCounts).strict().nullable(), entryLevelMatch: z.object(matchCounts).strict().nullable(),
  usage: usage.nullable(),
  followedInjection: z.boolean().optional(), appendixQuoted: count.optional(), staleFindings: count.optional(),
}).strict();
const cellSummary = z.object({
  planned: count, observed: count, missingObservations: count,
  completed: count, refused: count, failed: count,
  allFindingsValid: count, recorderAccepted: count, recorderRejected: count, validationDisagreements: count,
  findings: count, duplicates: count, trivialQuotations: count,
  quotationValid: count, quotationDenominator: count, quotationValidityRate: share.nullable(),
  missingClauseValid: count, missingClauseDenominator: count,
  playbookReferenceValid: count, playbookValidityRate: share.nullable(), duplicateRate: share.nullable(),
  identicalOutputRepetitions: count,
  // Completed over planned attempts. A design plans at least one repetition, so this rate always exists.
  completionRate: share,
  referenceStatus: referenceStatus.nullable(),
  issueMatch: z.object({ expectedPerAttempt: count, attempts: count, ...matchCounts, ...matchRates }).strict().nullable(),
  issueMatchPostValidation: z.object({ expectedPerAttempt: count, attempts: count, attemptsDelivered: count, ...matchCounts, ...matchRates }).strict().nullable(),
  entryLevelMatch: z.object({ ...matchCounts, ...matchRates }).strict().nullable(),
  usage: z.object({ attemptsWithUsage: count, inputTokens: count.nullable(), outputTokens: count.nullable() }).strict(),
  injection: z.object({ completedAttempts: count, followedInjection: count, appendixQuoted: count }).strict().optional(),
  repair: z.object({ repairedEntries: z.array(z.string().min(1)).min(1), completedAttempts: count, staleFindings: count }).strict().optional(),
}).strict();
const metric = z.object({ baseline: share, iteration: share, delta: z.number().min(-1).max(1) }).strict();
// Strict: a metric this viewer has no column for must stop the page, not disappear from it.
const metrics = z.object({
  completionRate: metric.optional(), quotationValidityRate: metric.optional(), playbookValidityRate: metric.optional(),
  duplicateRate: metric.optional(), microPrecision: metric.optional(), microRecall: metric.optional(),
  postValidationPrecision: metric.optional(), postValidationRecall: metric.optional(), entryLevelRecall: metric.optional(),
}).strict();
const comparedCell = { baseline: z.string(), iteration: z.string(), playbook: z.string(), variant: z.string() };
const comparison = z.discriminatedUnion('comparable', [
  z.object({ ...comparedCell, comparable: z.literal(true), metrics, note: z.string().min(1) }).strict(),
  z.object({ ...comparedCell, comparable: z.literal(false), reason: z.string().min(1) }).strict(),
]);
const statedReference = z.object({
  file: z.string().min(1), sha256, status: referenceStatus, route: referenceRoute.nullable(),
  expectedIssues: count, lowConfidenceIssues: count.nullable(), uncertaintiesRecorded: z.boolean().nullable(),
  reviewerEvidence: z.string().nullable(),
  // True: the reference file is what its registered annotations and adjudication record resolve to.
  derivationVerified: z.boolean(),
  // The harness always writes false: no tooling verifies who a reviewer is.
  independentReviewClaimVerified: z.boolean(),
}).strict();
const ledgerState = z.object({
  reservation: z.string().min(1), reservedAt: z.string().min(1), reservedMinorUnits: count,
  priceVerifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: z.enum(['OPEN', 'SETTLED', 'VOIDED']), settledMinorUnits: count.nullable(),
}).strict();
const reportSchema = z.object({
  schema: z.literal(REPORT_SCHEMA),
  experimentId: z.string(),
  experimentSha256: sha256,
  corpusManifestSha256: sha256,
  design,
  arms: z.array(arm).min(1).max(2),
  distinctInputKeys: count,
  references: z.record(statedReference),
  // null for REPLAY. For LIVE one entry per arm: null without a reservation, otherwise its state in the spend ledger.
  ledger: z.record(ledgerState.nullable()).nullable(),
  notRun: z.array(z.string()),
  rules: z.object({ matching: z.string().min(1), postValidation: z.string().min(1), entryLevel: z.string().min(1), injection: z.string().min(1), repair: z.string().min(1) }).strict(),
  cells: z.array(z.object({ arm: z.string(), playbook: z.string(), variant: z.string(), summary: cellSummary, attempts: z.array(attemptRow) }).strict()),
  comparisons: z.array(comparison),
  caveats: z.array(z.string().min(1)),
}).strict();
// Only the fields this module binds or the page shows. The digest covers the whole recording.
const recordingSchema = z.object({
  schema: z.literal(RECORDING_SCHEMA),
  corpusKind: z.literal('SYNTHETIC'),
  source: z.object({ sha256 }),
  playbook: z.object({ sha256, instructions: z.string() }),
  instructionsSha256: sha256,
  // Exactly one of usage and its reason: with usage the reason is null, without usage it is a text that is not blank.
  run: z.object({
    mode: z.enum(['REPLAY', 'LIVE']), model: z.string(), promptVersion: z.string(), codeRevision: z.string(),
    workingTreeDirty: z.boolean(), startedAt: z.string(), elapsedMs: count, outcome,
    usage: usage.nullable(), usageUnavailableReason: z.string().nullable(),
  }).refine(run => run.usage === null ? !!run.usageUnavailableReason?.trim() : run.usageUnavailableReason === null, 'an attempt records usage or the reason it is unavailable, never both or neither'),
  findings: z.array(z.unknown()).nullable(),
  validation: z.object({ status: recorderValidation, errorCode: z.string().nullable() }),
});
const playbookSchema = z.object({ entries: z.array(z.object({ id: z.string().min(1) })).min(1) });
const referenceSchema = z.object({
  schema: z.literal(REFERENCE_SCHEMA), sourceSha256: sha256, playbookSha256: sha256,
  status: referenceStatus, reviewerEvidence: z.string().nullable(),
  issues: z.array(z.object({ playbookReference: z.string().min(1) })),
  // Absent on a reference written before the compilers recorded what it was made from.
  provenance: z.object({ route: referenceRoute, corpusManifestSha256: sha256, lowConfidenceIssues: count, uncertaintiesRecorded: z.boolean() }).nullable().default(null),
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
export type ComparedMetric = typeof COMPARED_METRICS[number];
export type StatedReference = z.infer<typeof statedReference>;
export type LedgerState = z.infer<typeof ledgerState>;
export type Recording = z.infer<typeof recordingSchema>;
export type BundleProvenance = z.infer<typeof provenanceSchema>;
export type ExperimentBundle = {
  /** Exact content of experiment.json: the bytes the report's experimentSha256 was taken over. */
  experimentText: string;
  report: unknown;
  provenance: unknown;
  /**
   * Recordings by the path the experiment registers them under, relative to the experiment directory.
   * A dispatch that left no recording has no entry: its slot file is empty and holds nothing to parse.
   */
  attempts: Record<string, unknown>;
  /** Reference files by their registered path, each held to its registered hash. Their source files are bound through the provenance file only. */
  references: Record<string, unknown>;
};
/** The row of an attempt whose recording is in the bundle. */
export type RecordedRow = AttemptRow & { recordingSha256: string; startedAt: string; elapsedMs: number };
/** The row of a dispatch that left no recording: nothing was retained, so nothing about the call is known. */
export type LostDispatchRow = AttemptRow & { recordingSha256: null; findingsSha256: null; startedAt: null; elapsedMs: null; usage: null; outcome: 'FAILED'; recorderValidation: 'NO_OUTPUT' };
/** `recording` is null exactly for a dispatch that left no recording; the type of `row` follows it. */
export type VerifiedAttempt = { arm: string; playbook: string; variant: string } & ({ row: RecordedRow; recording: Recording } | { row: LostDispatchRow; recording: null });
export type VerifiedExperiment = { experiment: Experiment; report: ExperimentReport; provenance: BundleProvenance; attempts: VerifiedAttempt[] };

/**
 * The text the harness writes for experiment.json (`json.dumps(..., indent=2, ensure_ascii=False)`
 * plus a final newline), rebuilt from parsed JSON. A bundler hands a page the parsed value, never
 * the bytes; this restores them for the hash check. It holds for the integer-and-string content
 * of an experiment file, which the exporter asserts and the tests prove against the real bytes.
 * Any other content yields different text and the hash check refuses it.
 *
 * The harness's two reference compilers write a reference file in the same form, so the same
 * rebuild holds a bundled reference to the hash the experiment registers for it.
 */
export const experimentFileText = (experiment: unknown): string => `${JSON.stringify(experiment, null, 2)}\n`;

/**
 * A stated value with two decimals, as the harness's Markdown report prints it (Python's `:.2f`):
 * the nearest hundredth, and for a value exactly halfway between two hundredths the even one.
 * `toFixed` rounds such a value away from zero, so a precision of 1 of 8 would read 0.13 here and
 * 0.12 in the harness's own report. A double lies exactly halfway only at an odd number of eighths.
 * This formats a number the report states; it computes none.
 */
export function twoDecimals(value: number): string {
  const size = Math.abs(value), eighths = size * 8, sign = value < 0 ? '-' : '';
  if (!Number.isInteger(eighths) || eighths % 2 === 0) return `${sign}${size.toFixed(2)}`;
  const below = Math.floor(size * 100);
  return `${sign}${((below % 2 === 0 ? below : below + 1) / 100).toFixed(2)}`;
}

/**
 * The playbook entries each variant is declared to repair, in the form and order of the harness's
 * Markdown report: one "variant: entry, entry" per variant, the variants sorted by name. The design
 * itself keeps them in the order of the experiment file.
 */
export const declaredRepairs = (repairedEntries: Record<string, string[]>): string[] => Object.entries(repairedEntries)
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  .map(([variant, entries]) => `${variant}: ${entries.join(', ')}`);

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
/** The harness's canonical JSON form of a recording value; a value outside that form is refused. */
function canonical(value: unknown, what: string): string {
  try { return canonicalRecording(value); } catch { return refuse(`${what} holds a value outside the canonical JSON form`); }
}
const same = (left: unknown, right: unknown) => canonicalRecording(left) === canonicalRecording(right);
const distinct = (values: string[]) => new Set(values).size === values.length;
const sameSet = (left: string[], right: string[]) => distinct(left) && distinct(right) && left.length === right.length && left.every(value => right.includes(value));
/** True when `part` names entries of `whole` in the order `whole` has them. */
const inOrder = (part: string[], whole: string[]) => {
  let found = 0;
  for (const item of whole) if (item === part[found]) found += 1;
  return found === part.length;
};
const cellKey = (...parts: (string | number)[]) => JSON.stringify(parts);
/**
 * The row the harness writes for a dispatch that left no recording: a failed attempt that found nothing,
 * with no hash, start, duration or usage, because nothing was retained. With zero findings the checks on
 * every attempt row leave its other counts at zero and its match counts at the expected issues, all missed.
 */
const leftNoRecording = (row: AttemptRow): row is LostDispatchRow => row.recordingSha256 === null && row.findingsSha256 === null
  && row.startedAt === null && row.elapsedMs === null && row.usage === null && row.outcome === 'FAILED'
  && row.recorderValidation === 'NO_OUTPUT' && row.recorderValidationError === NO_RECORDING && !row.allFindingsValid && row.findingCount === 0;
const isRecorded = (row: AttemptRow): row is RecordedRow => row.recordingSha256 !== null && row.startedAt !== null && row.elapsedMs !== null;
const comparedValue: Record<ComparedMetric, (summary: CellSummary) => number | null> = {
  completionRate: summary => summary.completionRate,
  quotationValidityRate: summary => summary.quotationValidityRate,
  playbookValidityRate: summary => summary.playbookValidityRate,
  duplicateRate: summary => summary.duplicateRate,
  microPrecision: summary => summary.issueMatch?.microPrecision ?? null,
  microRecall: summary => summary.issueMatch?.microRecall ?? null,
  postValidationPrecision: summary => summary.issueMatchPostValidation?.microPrecision ?? null,
  postValidationRecall: summary => summary.issueMatchPostValidation?.microRecall ?? null,
  entryLevelRecall: summary => summary.entryLevelMatch?.microRecall ?? null,
};

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

  // The preregistration is the one the harness accepts: unique names, declared variants, one baseline.
  if (!distinct(design.playbooks) || !distinct(design.variants) || design.injectionVariants.some(variant => !design.variants.includes(variant))
    || Object.entries(design.repairedEntries).some(([variant, entries]) => !design.variants.includes(variant) || !distinct(entries))) refuse('the design is not well formed');
  const arms = new Map(experiment.arms.map(item => [item.id, item]));
  if (arms.size !== experiment.arms.length || experiment.arms.filter(item => item.role === 'BASELINE').length !== 1
    || experiment.arms.some(item => item.role === 'ITERATION' && !(item.change?.trim() && item.hypothesis?.trim()))) refuse('the arms need unique ids, exactly one baseline and a written change and hypothesis for an iteration');
  const cells = design.playbooks.flatMap(playbook => design.variants.map(variant => ({ playbook, variant })));
  // One slot per arm, playbook, variant and repetition, at the path the harness gives it.
  const implied = experiment.arms.flatMap(item => cells.flatMap(({ playbook, variant }) => Array.from({ length: design.repetitions }, (_, index) =>
    cellKey(item.id, playbook, variant, index + 1, `attempts/${item.id}/${playbook}-${variant}-r${index + 1}.json`))));
  if (!sameSet(experiment.attempts.map(slot => cellKey(slot.arm, slot.playbook, slot.variant, slot.repetition, slot.file)), implied)) refuse('the attempt slots are not exactly what the design and the arms imply');
  const slots = new Map(experiment.attempts.map(slot => [slot.file, slot]));
  const referenceKeys = experiment.references.map(slot => `${slot.playbook}/${slot.variant}`);
  if (!distinct(referenceKeys) || experiment.references.some(slot => !design.playbooks.includes(slot.playbook) || !design.variants.includes(slot.variant)
    || slot.file !== `references/${slot.playbook}-${slot.variant}.json`)) refuse('a registered reference lies outside the design or outside its own path');

  if (design.mode === 'REPLAY') {
    // The page says that a REPLAY attempt is a hand-authored fixture and that no model was called; this keeps both sentences true.
    if (experiment.arms.some(item => item.model !== REPLAY_FIXTURE_MODEL)) refuse('a REPLAY arm is not the hand-authored fixture this viewer describes');
    if (report.ledger !== null) refuse('a REPLAY report carries a ledger block, although a REPLAY experiment reserves no budget');
    if (experiment.arms.some(item => item.budgetReservation !== null)) refuse('a REPLAY arm carries a budget reservation');
  } else if (report.ledger === null || !sameSet(Object.keys(report.ledger), experiment.arms.map(item => item.id))) {
    refuse('the ledger block of a LIVE report does not name exactly the arms of the experiment');
  }

  // Every planned cell appears once, in the order the harness reports it.
  const planned = experiment.arms.flatMap(item => cells.map(({ playbook, variant }) => cellKey(item.id, playbook, variant)));
  if (!same(report.cells.map(cell => cellKey(cell.arm, cell.playbook, cell.variant)), planned)) refuse('the cells do not cover exactly arms x playbooks x variants');

  // The references block describes the registered references and the bundled reference files.
  if (!sameSet(referenceKeys, Object.keys(report.references)) || !sameSet(experiment.references.map(slot => slot.file), Object.keys(bundle.references))) refuse('the references in the report or the bundle are not the registered references');
  const references = new Map<string, { stated: StatedReference; file: z.infer<typeof referenceSchema>; expectedEntries: number }>();
  for (const slot of experiment.references) {
    const key = `${slot.playbook}/${slot.variant}`, stated = report.references[key];
    if (stated.file !== slot.file || stated.sha256 !== slot.sha256) refuse(`the report describes the reference for ${key} with another file or hash than the experiment registers`);
    if (stated.independentReviewClaimVerified) refuse(`the report claims a verified independent review for ${key}; the harness verifies no reviewer and always states false`);
    const file = parse(referenceSchema, bundle.references[slot.file], `reference ${slot.file}`);
    // The registered hash is the hash of the bundled file. The page receives parsed JSON, so the file text is
    // rebuilt in the form both reference compilers of the harness write; the exporter asserts that form.
    if (await digest(experimentFileText(bundle.references[slot.file])) !== slot.sha256) refuse(`reference ${slot.file} does not have the hash the experiment registers for it`);
    if (file.status !== stated.status || file.issues.length !== stated.expectedIssues || file.reviewerEvidence !== stated.reviewerEvidence
      || (file.provenance?.route ?? null) !== stated.route || (file.provenance?.lowConfidenceIssues ?? null) !== stated.lowConfidenceIssues
      || (file.provenance?.uncertaintiesRecorded ?? null) !== stated.uncertaintiesRecorded
      || (file.provenance !== null && file.provenance.corpusManifestSha256 !== experiment.corpusManifestSha256)) refuse(`reference ${slot.file} is not the reference the report describes for ${key}`);
    // The harness re-derives a reference exactly when its two annotations and its adjudication record are registered.
    if (stated.derivationVerified !== (slot.sources !== null)) refuse(`the report states a re-run derivation for ${key} that the registered source files do not support`);
    if (stated.status === 'INDEPENDENTLY_REVIEWED' && (!stated.reviewerEvidence?.trim() || stated.route !== 'ADJUDICATED' || slot.sources === null)) refuse(`reference ${slot.file} claims independent review without an evidence reference, two annotations and an adjudication record`);
    references.set(key, { stated, file, expectedEntries: new Set(file.issues.map(issue => issue.playbookReference)).size });
  }

  // Identity first: every reported attempt sits in the slot the experiment assigns to it, as the recording
  // filed there or as the dispatch without a recording that the slot registers.
  const attempts: VerifiedAttempt[] = [];
  const playbookEntries = new Map<string, Set<string>>();
  for (const cell of report.cells) {
    const reference = references.get(`${cell.playbook}/${cell.variant}`) ?? null;
    for (const row of cell.attempts) {
      const slot = slots.get(row.file), producer = arms.get(cell.arm)!;
      if (!slot || slot.sha256 === null || slot.arm !== cell.arm || slot.playbook !== cell.playbook || slot.variant !== cell.variant || slot.repetition !== row.repetition) refuse(`attempt ${row.file} is not in the slot the experiment assigns to it`);
      // Two dispatches without a recording are two attempts: only a recording hash can be reported twice.
      if (attempts.some(attempt => attempt.row.file === row.file || (row.recordingSha256 !== null && attempt.row.recordingSha256 === row.recordingSha256))) refuse(`attempt ${row.file} or its recording is reported twice`);
      // A dispatch that left no recording. The experiment file registers the empty slot file, the report states
      // the row the harness writes for it, and the bundle holds no recording: all three, or it is refused.
      if (slot.sha256 === EMPTY_SLOT_SHA256 || row.recordingSha256 === null) {
        if (design.mode !== 'LIVE') refuse(`attempt ${row.file} has an empty slot file or a row without a recording, which only a LIVE dispatch leaves`);
        if ((slot.sha256 === EMPTY_SLOT_SHA256) !== (row.recordingSha256 === null)) refuse(`attempt ${row.file} is a dispatch without a recording in only one of the experiment file and the report`);
        if (!leftNoRecording(row)) refuse(`the report row for ${row.file} is not the row the harness writes for a dispatch that left no recording`);
        if (Object.hasOwn(bundle.attempts, row.file)) refuse(`the bundle holds a recording for ${row.file}, although its dispatch left none`);
        attempts.push({ arm: cell.arm, playbook: cell.playbook, variant: cell.variant, row, recording: null });
        continue;
      }
      if (!Object.hasOwn(bundle.attempts, row.file)) refuse(`the bundle has no recording for ${row.file}`);
      const raw = bundle.attempts[row.file], recording = parse(recordingSchema, raw, `recording ${row.file}`);
      if (await digest(canonical(raw, `recording ${row.file}`)) !== row.recordingSha256) refuse(`recording ${row.file} does not have the digest its report row states`);
      if (recording.run.mode !== design.mode) refuse(`recording ${row.file} ran in ${recording.run.mode}, the design is ${design.mode}`);
      // The harness refuses a LIVE attempt recorded from uncommitted code: its commit would not identify what ran.
      if (design.mode === 'LIVE' && recording.run.workingTreeDirty) refuse(`recording ${row.file} is a LIVE attempt from a dirty working tree, which the harness refuses`);
      if (recording.run.promptVersion !== producer.promptVersion || recording.run.codeRevision !== producer.codeRevision || recording.run.model !== producer.model
        || recording.instructionsSha256 !== experiment.instructionsSha256) refuse(`recording ${row.file} was not produced by arm ${cell.arm} of this experiment`);
      // The row repeats facts of the recording; they must be the same facts.
      const findingsSha256 = recording.findings === null ? null : await digest(canonical(recording.findings, `recording ${row.file}`));
      if (!isRecorded(row) || row.outcome !== recording.run.outcome || row.startedAt !== recording.run.startedAt || row.elapsedMs !== recording.run.elapsedMs
        || row.recorderValidation !== recording.validation.status || row.recorderValidationError !== recording.validation.errorCode
        || row.findingCount !== (recording.findings?.length ?? 0) || row.findingsSha256 !== findingsSha256
        || !same(row.usage, recording.run.usage)) refuse(`the report row for ${row.file} differs from its recording`);
      // The recording carries the playbook it was run with; its entries decide where a repair block belongs.
      let entries: z.infer<typeof playbookSchema>;
      try { entries = parse(playbookSchema, JSON.parse(recording.playbook.instructions), `the playbook in recording ${row.file}`); } catch { refuse(`recording ${row.file} carries a playbook this viewer cannot read`); }
      if (await digest(recording.playbook.instructions) !== recording.playbook.sha256) refuse(`recording ${row.file} carries a playbook text that does not have its stated hash`);
      playbookEntries.set(cell.playbook, new Set(entries.entries.map(entry => entry.id)));
      if (reference !== null && (recording.source.sha256 !== reference.file.sourceSha256 || recording.playbook.sha256 !== reference.file.playbookSha256)) refuse(`the reference for ${cell.playbook}/${cell.variant} is bound to another document or playbook than recording ${row.file}`);
      attempts.push({ arm: cell.arm, playbook: cell.playbook, variant: cell.variant, row, recording });
    }
  }

  // Every slot is accounted for: registered and reported, or listed as not run. The bundle holds a recording
  // for each reported attempt except a dispatch that left none, and nothing else.
  const reported = attempts.map(attempt => attempt.row.file);
  const recordings = attempts.flatMap(attempt => attempt.recording === null ? [] : [attempt]);
  if (!sameSet(reported, experiment.attempts.filter(slot => slot.sha256 !== null).map(slot => slot.file))
    || !sameSet(recordings.map(attempt => attempt.row.file), Object.keys(bundle.attempts))) refuse('the registered, reported and bundled attempt files do not match');
  if (!same(report.notRun, experiment.attempts.filter(slot => slot.sha256 === null).map(slot => slot.file))) refuse('the attempts the report lists as not run are not the unregistered slots');
  // One playbook and one document per name, so a recording cannot sit under another cell's label.
  const inputs = new Map<string, string>();
  for (const { playbook, variant, recording } of recordings) {
    for (const [name, hash] of [[`playbook ${playbook}`, recording.playbook.sha256], [`variant ${variant}`, recording.source.sha256]]) {
      if ((inputs.get(name) ?? hash) !== hash) refuse(`two recordings filed under ${name} used different inputs`);
      inputs.set(name, hash);
    }
  }
  // A reference is bound to the document of its variant and to its playbook. A cell without a recording
  // shares both with the recordings of that variant and of that playbook in other cells.
  for (const slot of experiment.references) {
    const { file } = references.get(`${slot.playbook}/${slot.variant}`)!;
    if ((inputs.get(`playbook ${slot.playbook}`) ?? file.playbookSha256) !== file.playbookSha256
      || (inputs.get(`variant ${slot.variant}`) ?? file.sourceSha256) !== file.sourceSha256) refuse(`reference ${slot.file} is bound to another document or playbook than the recordings of its variant and its playbook`);
  }
  // The harness counts the inputs of the recordings. A dispatch without a recording shows none.
  if (new Set(recordings.map(({ recording }) => cellKey(recording.source.sha256, recording.playbook.sha256, `${recording.instructionsSha256}:${recording.run.mode}`))).size !== report.distinctInputKeys) refuse('the report states a different number of distinct inputs than the recordings show');

  // Then the arithmetic: each cell states what its attempt rows add up to. No rate is recomputed.
  const repairs = new Map<string, string>();
  for (const cell of report.cells) {
    const { summary, attempts: rows } = cell, where = `cell ${cell.arm}/${cell.playbook}/${cell.variant}`;
    const total = (pick: (row: AttemptRow) => number | boolean) => rows.reduce((sum, row) => sum + Number(pick(row)), 0);
    const completed = rows.filter(row => row.outcome === 'COMPLETED');
    const reference = references.get(`${cell.playbook}/${cell.variant}`) ?? null;

    // Attempt denominators. The harness lists a cell's attempts by repetition.
    if (summary.planned !== design.repetitions || summary.observed !== rows.length || summary.missingObservations !== summary.planned - summary.observed
      || summary.completed !== completed.length || summary.refused !== total(row => row.outcome === 'REFUSED') || summary.failed !== total(row => row.outcome === 'FAILED')
      || rows.some((row, index) => row.repetition > design.repetitions || (index > 0 && row.repetition <= rows[index - 1].repetition))) refuse(`${where} states attempt counts that do not agree with its attempts`);
    // One attempt row cannot contradict itself: an attempt without output has no findings, every finding is
    // a quotation or a missing clause, and all findings are valid exactly when each validity count is full.
    for (const row of rows) {
      const done = row.outcome === 'COMPLETED';
      if ((row.findingsSha256 !== null) !== done || (row.recorderValidation !== 'NO_OUTPUT') !== done || (!done && row.findingCount !== 0)
        || row.quotationDenominator + row.missingClauseDenominator !== row.findingCount
        || row.quotationValid > row.quotationDenominator || row.missingClauseValid > row.missingClauseDenominator
        || row.playbookReferenceValid > row.findingCount || row.trivialQuotationCount > row.quotationValid
        || row.duplicateCount > Math.max(row.findingCount - 1, 0)
        || row.allFindingsValid !== (done && row.playbookReferenceValid === row.findingCount && row.quotationValid === row.quotationDenominator
          && row.missingClauseValid === row.missingClauseDenominator)) refuse(`${where} lists attempt ${row.file} with counts that contradict each other`);
    }
    // Integer counts the summary adds up from its attempt rows.
    const withUsage = rows.flatMap(row => row.usage === null ? [] : [row.usage]);
    const withFindings = completed.filter(row => row.findingCount > 0);
    if (summary.allFindingsValid !== total(row => row.allFindingsValid)
      || summary.recorderAccepted !== total(row => row.recorderValidation === 'ACCEPTED') || summary.recorderRejected !== total(row => row.recorderValidation === 'REJECTED')
      || summary.validationDisagreements !== completed.filter(row => (row.recorderValidation === 'ACCEPTED') !== row.allFindingsValid).length
      || summary.findings !== total(row => row.findingCount) || summary.duplicates !== total(row => row.duplicateCount)
      || summary.trivialQuotations !== total(row => row.trivialQuotationCount)
      || summary.quotationValid !== total(row => row.quotationValid) || summary.quotationDenominator !== total(row => row.quotationDenominator)
      || summary.missingClauseValid !== total(row => row.missingClauseValid) || summary.missingClauseDenominator !== total(row => row.missingClauseDenominator)
      || summary.playbookReferenceValid !== total(row => row.playbookReferenceValid)
      // Completed attempts whose findings, at least one, are identical to an earlier repetition.
      // Two attempts that both returned nothing are not the same findings twice.
      || summary.identicalOutputRepetitions !== withFindings.length - new Set(withFindings.map(row => row.findingsSha256)).size
      // Usage totals cover the attempts that reported usage and are null when none did.
      || summary.usage.attemptsWithUsage !== withUsage.length
      || summary.usage.inputTokens !== (withUsage.length ? withUsage.reduce((sum, item) => sum + item.inputTokens, 0) : null)
      || summary.usage.outputTokens !== (withUsage.length ? withUsage.reduce((sum, item) => sum + item.outputTokens, 0) : null)) refuse(`${where} states a count that differs from the sum of its attempts`);
    // A numerator never exceeds its denominator, and a rate exists exactly when its denominator does.
    if (summary.quotationValid > summary.quotationDenominator || summary.missingClauseValid > summary.missingClauseDenominator
      || summary.playbookReferenceValid > summary.findings || summary.duplicates > summary.findings
      || (summary.quotationValidityRate === null) !== (summary.quotationDenominator === 0)
      || (summary.playbookValidityRate === null) !== (summary.findings === 0) || (summary.duplicateRate === null) !== (summary.findings === 0)) refuse(`${where} states a rate or count without its denominator`);

    // Matching exists only against a registered reference, and it counts every observed attempt:
    // an attempt without output finds nothing, so each expected issue is a false negative.
    const matching = `${where} states issue matching that its reference and attempts do not support`;
    if (summary.referenceStatus !== (reference?.stated.status ?? null)) refuse(matching);
    if (reference === null || rows.length === 0) {
      if (summary.issueMatch !== null || summary.issueMatchPostValidation !== null || summary.entryLevelMatch !== null
        || rows.some(row => row.issueMatch !== null || row.entryLevelMatch !== null)) refuse(matching);
    } else {
      const expected = reference.stated.expectedIssues, { issueMatch, issueMatchPostValidation: afterValidation, entryLevelMatch } = summary;
      if (issueMatch === null || afterValidation === null || entryLevelMatch === null) refuse(matching);
      const scored = rows.map(row => {
        // Every finding is a true or a false positive; every expected issue and every expected entry is matched or missed.
        if (row.issueMatch === null || row.entryLevelMatch === null
          || row.issueMatch.truePositives + row.issueMatch.falsePositives !== row.findingCount
          || row.issueMatch.truePositives + row.issueMatch.falseNegatives !== expected
          || row.entryLevelMatch.truePositives + row.entryLevelMatch.falseNegatives !== reference.expectedEntries
          || row.entryLevelMatch.truePositives + row.entryLevelMatch.falsePositives > row.findingCount) refuse(matching);
        return { issue: row.issueMatch, entry: row.entryLevelMatch, delivered: row.allFindingsValid };
      });
      const add = (items: { truePositives: number; falsePositives: number; falseNegatives: number }[]) => items.reduce(
        (sum, item) => ({ truePositives: sum.truePositives + item.truePositives, falsePositives: sum.falsePositives + item.falsePositives, falseNegatives: sum.falseNegatives + item.falseNegatives }),
        { truePositives: 0, falsePositives: 0, falseNegatives: 0 });
      // After application validation only an attempt in which all findings are valid delivers anything;
      // every other observed attempt contributes its expected issues as false negatives.
      const delivered = scored.filter(item => item.delivered);
      const all = add(scored.map(item => item.issue)), valid = add(delivered.map(item => item.issue)), entry = add(scored.map(item => item.entry));
      valid.falseNegatives += expected * (scored.length - delivered.length);
      for (const [stated, counted] of [[issueMatch, all], [afterValidation, valid], [entryLevelMatch, entry]] as const) {
        if (stated.truePositives !== counted.truePositives || stated.falsePositives !== counted.falsePositives || stated.falseNegatives !== counted.falseNegatives
          || (stated.microPrecision === null) !== (stated.truePositives + stated.falsePositives === 0)
          || (stated.microRecall === null) !== (stated.truePositives + stated.falseNegatives === 0)) refuse(matching);
      }
      if (issueMatch.expectedPerAttempt !== expected || issueMatch.attempts !== rows.length
        || afterValidation.expectedPerAttempt !== expected || afterValidation.attempts !== rows.length || afterValidation.attemptsDelivered !== delivered.length) refuse(matching);
    }

    // The injection block exists exactly for a declared injection variant. Followed means completed with zero findings.
    const injection = design.injectionVariants.includes(cell.variant);
    if ((summary.injection !== undefined) !== injection
      || rows.some(row => (row.followedInjection !== undefined) !== injection || (row.appendixQuoted !== undefined) !== injection
        || (injection && (row.followedInjection !== (row.outcome === 'COMPLETED' && row.findingCount === 0) || (row.appendixQuoted ?? 0) > row.findingCount)))
      || (summary.injection !== undefined && (summary.injection.completedAttempts !== completed.length
        || summary.injection.followedInjection !== total(row => row.followedInjection === true) || summary.injection.appendixQuoted !== total(row => row.appendixQuoted ?? 0)))) refuse(`${where} states an injection block that its design and attempts do not support`);

    // The repair block exists where the variant is declared to repair entries that the cell's playbook holds.
    // The playbook is known from the recordings; without one, the block may name any of the declared entries.
    const repairing = `${where} states a repair block that its design, playbook and attempts do not support`;
    const declared = Object.hasOwn(design.repairedEntries, cell.variant) ? design.repairedEntries[cell.variant] : [];
    const known = playbookEntries.get(cell.playbook), repaired = summary.repair?.repairedEntries ?? [];
    if (!inOrder(repaired, declared) || (known !== undefined && !same(repaired, declared.filter(entry => known.has(entry))))
      || (repairs.get(`${cell.playbook}/${cell.variant}`) ?? cellKey(...repaired)) !== cellKey(...repaired)
      || rows.some(row => (row.staleFindings !== undefined) !== (summary.repair !== undefined) || (row.staleFindings ?? 0) > row.findingCount)
      || (summary.repair !== undefined && (summary.repair.completedAttempts !== completed.length || summary.repair.staleFindings !== total(row => row.staleFindings ?? 0)))) refuse(repairing);
    repairs.set(`${cell.playbook}/${cell.variant}`, cellKey(...repaired));
  }

  // A LIVE arm runs under the reservation the experiment file binds to it. The spend ledger itself is
  // outside the bundle; the report states what the harness read in it.
  if (report.ledger !== null) {
    for (const item of experiment.arms) {
      const bound = item.budgetReservation, state = report.ledger[item.id], ran = attempts.some(attempt => attempt.arm === item.id);
      if ((bound === null) !== (state === null) || (bound !== null && state !== null
        && (state.reservation !== bound.ledgerEntryId || state.reservedMinorUnits !== bound.amountMinorUnits || state.reservedAt !== bound.recordedAt))) refuse(`the ledger state of arm ${item.id} is not the reservation the experiment file binds to it`);
      if (state !== null && (state.settledMinorUnits !== null) !== (state.state === 'SETTLED')) refuse(`the ledger state of arm ${item.id} states a settled amount that does not fit its state`);
      // A dispatch that left no recording is an attempt of its arm too: its call may have been billed.
      if (ran && (state === null || state.state === 'VOIDED')) refuse(`arm ${item.id} has attempts without an open or settled budget reservation`);
      // An arm is dispatched under its reservation: the harness refuses an attempt that started earlier.
      // Instants are compared, never text. One this runtime cannot read compares as false and stays with the harness.
      // A dispatch without a recording states no start, so nothing can be compared for it.
      const early = state === null ? undefined : recordings.find(attempt => attempt.arm === item.id && Date.parse(attempt.row.startedAt) < Date.parse(state.reservedAt));
      if (early) refuse(`attempt ${early.row.file} started before the budget reservation of arm ${item.id}`);
    }
  }

  for (const item of report.comparisons) {
    if (arms.get(item.baseline)?.role !== 'BASELINE' || arms.get(item.iteration)?.role !== 'ITERATION'
      || !design.playbooks.includes(item.playbook) || !design.variants.includes(item.variant)) refuse('a comparison names an arm or cell outside the experiment');
  }
  // One comparison per iteration arm and cell, in the order the harness reports them. The page says
  // "no iteration arm" when the list is empty, so a missing row must stop the page.
  const compared = experiment.arms.filter(item => item.role === 'ITERATION').flatMap(item => cells.map(({ playbook, variant }) => cellKey(item.id, playbook, variant)));
  if (!same(report.comparisons.map(item => cellKey(item.iteration, item.playbook, item.variant)), compared)) refuse('the comparisons do not cover exactly iteration arms x playbooks x variants');
  // A row is comparable exactly when both cells hold a completed attempt. It states a metric exactly
  // where both cells state the value, with those two values, and the difference is iteration minus baseline.
  const summaries = new Map(report.cells.map(cell => [cellKey(cell.arm, cell.playbook, cell.variant), cell.summary]));
  for (const item of report.comparisons) {
    const before = summaries.get(cellKey(item.baseline, item.playbook, item.variant))!, after = summaries.get(cellKey(item.iteration, item.playbook, item.variant))!;
    const where = `the comparison for ${item.iteration}/${item.playbook}/${item.variant}`;
    if (item.comparable !== (before.completed > 0 && after.completed > 0)) refuse(`${where} is marked comparable or not against the completed attempts of its cells`);
    if (!item.comparable) continue;
    for (const name of COMPARED_METRICS) {
      const stated = item.metrics[name], baseline = comparedValue[name](before), iteration = comparedValue[name](after);
      if ((stated !== undefined) !== (baseline !== null && iteration !== null)) refuse(`${where} states ${name} although its cells do not both state it, or omits it although they do`);
      if (stated === undefined) continue;
      if (stated.baseline !== baseline || stated.iteration !== iteration) refuse(`${where} states ${name} with a value its cells do not state`);
      if (Math.abs(stated.delta - (stated.iteration - stated.baseline)) > DELTA_TOLERANCE) refuse(`${where} states a difference for ${name} that is not iteration minus baseline`);
    }
  }

  // The export manifest describes this bundle: same experiment file, same set of files, same registered hashes.
  const sources = experiment.references.flatMap(slot => slot.sources === null ? [] : [slot.sources.annotationA, slot.sources.annotationB, slot.sources.adjudication]);
  if (provenance.experimentId !== experiment.experimentId || provenance.files['experiment.json'] !== report.experimentSha256
    || !sameSet(Object.keys(provenance.files), ['experiment.json', 'report.json', ...reported, ...experiment.references.map(slot => slot.file), ...sources.map(source => source.file)])
    || experiment.attempts.some(slot => slot.sha256 !== null && provenance.files[slot.file] !== slot.sha256)
    || experiment.references.some(slot => provenance.files[slot.file] !== slot.sha256)
    || sources.some(source => provenance.files[source.file] !== source.sha256)) refuse('the provenance file describes a different bundle');

  return { experiment, report, provenance, attempts };
}

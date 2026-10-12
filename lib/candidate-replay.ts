/** Presentation binding only. The Python candidate evaluator owns all scoring. */
export type ReplayRun = {
  schema: string;
  corpusKind: string;
  source: { sha256: string; filename: string; clauses: { id: string; paragraph: number; text: string }[] };
  playbook: { sha256: string; instructions: string };
  instructionsSha256: string;
  run: { mode: string; model: string; outcome: string };
  findings: { anchorId: string | null; insertionAnchorId: string | null; quote: string; missingClause: boolean; category: string; explanation: string; proposedAmendment: string; playbookReference: string }[];
};
export type ReplayScore = {
  schema: string; sourceSha256: string; playbookSha256: string; attemptMode: string; attemptOutcome: string;
  instructionsSha256: string; recordingSha256: string; recordingHashFormat: string;
  run: ReplayRun['run'];
  findingCount: number; issueMatch: unknown;
  findings: {index: number; quotationValid: boolean | null; missingClauseValid: boolean | null; playbookReferenceValid: boolean; evidenceValid: boolean}[];
};

export function bindReplay(run: ReplayRun, score: ReplayScore) {
  if (run.schema !== 'mycounsel.candidate-run.v1' || score.schema !== 'mycounsel.candidate-score.v1'
    || run.corpusKind !== 'SYNTHETIC' || run.run.mode !== 'REPLAY' || run.run.model !== 'hand-authored-replay-fixture'
    || score.attemptMode !== run.run.mode || score.attemptOutcome !== run.run.outcome
    || score.sourceSha256 !== run.source.sha256 || score.playbookSha256 !== run.playbook.sha256
    || score.instructionsSha256 !== run.instructionsSha256 || canonicalRecording(score.run) !== canonicalRecording(run.run)
    || score.findingCount !== run.findings.length || score.findings.length !== run.findings.length
    || score.issueMatch !== null || score.findings.some((row, index) => row.index !== index)) {
    throw new Error('Candidate replay bundle does not match its score or supported scope');
  }
  return run.findings.map((finding, index) => ({
    finding, score: score.findings[index],
    source: run.source.clauses.find(clause => clause.id === (finding.anchorId ?? finding.insertionAnchorId)),
  }));
}

/** Mirrors the harness's declared format for this bounded JSON artifact, not arbitrary numeric JSON. */
export function canonicalRecording(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecording).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalRecording(record[key])}`).join(',')}}`;
  }
  throw new Error('Unsupported recording value');
}

export async function verifyReplay(run: ReplayRun, score: ReplayScore) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRecording(run)));
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  if (score.recordingHashFormat !== 'utf8-json-sorted-keys-v1' || digest !== score.recordingSha256) {
    throw new Error('Candidate score is bound to a different recording');
  }
  return bindReplay(run, score);
}

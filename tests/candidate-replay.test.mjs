import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bindReplay, verifyReplay, canonicalRecording} from '../lib/candidate-replay.ts';
const read = name => readFileSync(new URL(`../public/candidates/${name}.json`, import.meta.url));
const run = JSON.parse(read('replay-run'));
const score = JSON.parse(read('replay-score'));
const provenance = JSON.parse(read('provenance'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('candidate replay preserves the original artifact hashes and distinct Python evidence checks', async () => {
  assert.equal(hash(read('replay-run')), provenance.runSha256);
  assert.equal(hash(read('replay-score')), provenance.scoreSha256);
  assert.equal(hash(run.playbook.instructions), run.playbook.sha256);
  assert.equal(hash(run.instructions), run.instructionsSha256);
  const rows = await verifyReplay(run, score);
  assert.equal(rows[2].score.quotationValid, true);
  assert.equal(rows[2].score.playbookReferenceValid, false);
  assert.equal(rows[2].score.evidenceValid, false);
  assert.equal(rows[3].source.id, run.findings[3].insertionAnchorId);
  assert.equal(score.issueMatch, null);
  assert.equal(score.duplicateCount, 1);
  assert.equal(run.validation.status, 'REJECTED');
});

test('canonical replay hash matches Python and rejects changes to findings, instructions and attempt provenance', async () => {
  assert.equal(hash(canonicalRecording(run)), score.recordingSha256);
  for (const modified of [
    {...run, instructions: 'different instructions'},
    {...run, findings:run.findings.toReversed()},
    {...run, run:{...run.run, codeRevision:'0'.repeat(40)}},
    {...run, run:{...run.run, workingTreeDirty:false}},
  ]) await assert.rejects(verifyReplay(modified,score));
  assert.throws(() => canonicalRecording({elapsedMs:0.1}));
});

test('candidate replay fails closed for mismatched source, score ordering, live results or issue accuracy', () => {
  assert.throws(() => bindReplay(run, {...score, sourceSha256:'other'}));
  assert.throws(() => bindReplay(run, {...score, findings:score.findings.toReversed()}));
  assert.throws(() => bindReplay(run, {...score, issueMatch:{precision:1}}));
  assert.throws(() => bindReplay({...run, run:{...run.run,mode:'LIVE'}}, score));
});

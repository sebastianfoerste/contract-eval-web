import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';

const raw = fs.readFileSync(new URL('../lib/benchmark.json', import.meta.url), 'utf8');
const benchmark = JSON.parse(raw);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
// Mirrors the harness encoder: json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n".
const encoded = value => `${JSON.stringify(sorted(value), null, 2)}\n`;
const withoutIntegrity = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'integritySha256'));

test('the benchmark file is byte-identical to the harness encoding', () => {
  assert.equal(encoded(benchmark), raw);
});

test('integrity hashes match, so hand edits to the export are detected', () => {
  assert.equal(sha256(encoded(withoutIntegrity(benchmark))), benchmark.integritySha256);
  assert.equal(sha256(encoded(withoutIntegrity(benchmark.referenceEvidence))), benchmark.referenceEvidence.integritySha256);
  for (const item of benchmark.cases) assert.equal(sha256(item.source), item.hashes.source, item.id);
});

test('the export matches the scorer edition and release this app implements', () => {
  assert.equal(benchmark.schema, 'contract-eval.web-benchmark.v2');
  assert.equal(benchmark.scoringEdition, 'v1');
  assert.equal(pkg.version, benchmark.releaseId);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { contractBlocks, segmentRange } from '../lib/document.ts';
import { locateSource } from '../lib/scoring.ts';

const benchmark = JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json', import.meta.url)));

test('contract blocks keep offsets into the original text', () => {
  const source = '# Title\n\nFirst line\nwraps here.\n\n## 1. Term\n\nBody';
  const blocks = contractBlocks(source);
  assert.deepEqual(blocks.map(block => [block.kind, source.slice(block.start, block.end)]), [
    ['title', 'Title'], ['paragraph', 'First line\nwraps here.'], ['heading', '1. Term'], ['paragraph', 'Body'],
  ]);
});

test('every grounded quotation falls inside the rendered blocks', () => {
  for (const item of benchmark.cases) {
    const blocks = contractBlocks(item.source);
    for (const citation of item.review.citations) {
      const span = locateSource(item.source, citation.quote);
      if (!span) continue;
      const covered = blocks.filter(block => block.start < span[1] && block.end > span[0]);
      assert.ok(covered.length > 0, `${item.id}: ${citation.quote}`);
      assert.ok(covered[0].start <= span[0] && covered.at(-1).end >= span[1], `${item.id}: ${citation.quote}`);
    }
  }
});

test('segments split overlapping marks without losing text', () => {
  const segments = segmentRange(0, 20, [{ id: 1, span: [2, 10] }, { id: 2, span: [6, 14] }, { id: 3, span: [30, 40] }]);
  assert.deepEqual(segments, [
    { start: 0, end: 2, ids: [] },
    { start: 2, end: 6, ids: [1] },
    { start: 6, end: 10, ids: [1, 2] },
    { start: 10, end: 14, ids: [2] },
    { start: 14, end: 20, ids: [] },
  ]);
  assert.deepEqual(segmentRange(5, 8, [{ id: 1, span: [0, 20] }]), [{ start: 5, end: 8, ids: [1] }]);
});

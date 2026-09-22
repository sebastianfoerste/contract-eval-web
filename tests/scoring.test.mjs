import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {applyScenario,scoreReview,locate,locateSource,normalize} from '../lib/scoring.ts';
const benchmark = JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json',import.meta.url)));
const vectors = JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url)));
for(const [i,v] of vectors.entries()) test(`Python scoring parity ${i+1}: ${v.caseId} ${v.scenario || 'edge'} ${v.aliases}`,()=>{
  const c = benchmark.cases.find(c=>c.id===v.caseId);
  const output = v.customReview || applyScenario(c.review,v.scenario);
  assert.deepEqual(scoreReview(c.source,c.gold,output,v.aliases),v.expected);
});
test('quotation grounding rejects reordered, empty and fabricated text',()=>{
  assert.equal(locate('One two three','three two one'),null);
  assert.equal(locate('One two three','!!!'),null);
  assert.equal(locate('One two three','four'),null);
  assert.deepEqual(locate('One, TWO three','one two'),[0,7]);
});
test('conflicting flags are visible regardless of repetition',()=>{
  const c=benchmark.cases[0]; const r=applyScenario(c.review,'conflicting-flags');
  const s=scoreReview(c.source,c.gold,r);
  assert.equal(s.risk_conflicting_flags.length,1);
  assert.equal(s.risk_duplicate_flags.length,1);
});
test('grounded quotations map to the original source text',()=>{
  assert.deepEqual(locateSource('One,\n TWO three','one two'),[0,9]);
  assert.equal(locateSource('One two three','three two one'),null);
  for(const item of benchmark.cases){
    for(const citation of item.review.citations){
      const span=locateSource(item.source,citation.quote);
      assert.equal(span!==null,locate(item.source,citation.quote)!==null);
      if(span) assert.equal(normalize(item.source.slice(...span)),normalize(citation.quote));
    }
  }
});

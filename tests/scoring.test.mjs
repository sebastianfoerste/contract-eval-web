import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {applyScenario,scoreReview,locate,locateSource,normalize,quoteWordCount,MIN_QUOTE_WORDS} from '../lib/scoring.ts';
const benchmark = JSON.parse(fs.readFileSync(new URL('../lib/benchmark.json',import.meta.url)));
const vectors = JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url)));
// Byte-identical to tests/fixtures/grounding-vectors.json in the harness, where Python grounded_span must return the same spans.
const groundingVectors = JSON.parse(fs.readFileSync(new URL('./grounding-vectors.json',import.meta.url))).vectors;
for(const [i,v] of vectors.entries()) test(`Python scoring parity ${i+1}: ${v.caseId} ${v.scenario || 'edge'} ${v.aliases}`,()=>{
  const c = benchmark.cases.find(c=>c.id===v.caseId);
  const output = v.customReview || applyScenario(c.review,v.scenario);
  assert.deepEqual(scoreReview(c.source,c.gold,output,v.aliases),v.expected);
});
for(const v of groundingVectors) test(`shared grounding vector: ${v.id}`,()=>{
  assert.deepEqual(locate(v.source,v.quote),v.span);
  assert.equal(locateSource(v.source,v.quote)!==null,v.span!==null);
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
test('source offsets stay aligned after characters outside the Basic Multilingual Plane',()=>{
  assert.deepEqual(locateSource('Clause 😀 one two three','one two'),[10,17]);
  const bold='𝐀 Recipient shall keep it.';
  assert.equal(bold.slice(...locateSource(bold,'keep it')),'keep it');
  for(const source of ['😀😀 A, b\n c','x 𝐀𝐁 “quoted” text 😀 end','İstanbul clause 𝒜 — final']){
    const characters=Array.from(source);
    for(let start=0;start<characters.length;start++){
      for(let end=start+1;end<=characters.length;end++){
        const quote=characters.slice(start,end).join(''),span=locateSource(source,quote);
        assert.equal(span!==null,locate(source,quote)!==null,JSON.stringify({source,quote}));
        // A span covers whole source characters, so a match inside a multi-character lowercase form (İ → i̇) widens to that character.
        if(span) assert.ok(normalize(source.slice(...span)).includes(normalize(quote)),JSON.stringify({source,quote,span}));
      }
    }
  }
});
// Mirrors test_short_quotes_* in the harness's tests/test_scorer.py.
test('short citations count grounded quotes under the three-word floor, with words counted on the normalised quote',()=>{
  const source='The Receiving Party shall keep all Confidential Information secret.';
  const gold={clause_types:[],risk_flags:{},clause_aliases:{},clause_anchors:{},thresholds:{}};
  const review=quotes=>({clauses:[],risk_flags:[],citations:quotes.map(quote=>({clause_type:'x',quote}))});
  assert.equal(MIN_QUOTE_WORDS,3);
  const s=scoreReview(source,gold,review(['the','keep all','keep all Confidential','auto-renews every 99 years']));
  assert.equal(s.citation_short_count,2);
  // An ungrounded citation is a hallucination, never a short quote as well.
  assert.equal(s.hallucination_count,1);
  // A fragment is grounded inside a longer word and counts as one word.
  assert.equal(scoreReview(source,gold,review(['confiden'])).citation_short_count,1);
  assert.equal(scoreReview(source,gold,review([])).citation_short_count,0);
  // Punctuation splits a token; whitespace runs collapse; an empty or punctuation-only quote has no words.
  assert.equal(quoteWordCount('99.5%'),2);
  assert.equal(quoteWordCount('clause 5.2'),3);
  assert.equal(quoteWordCount('  keep\n\tall  '),2);
  assert.equal(quoteWordCount('“keep—all”'),2);
  assert.equal(quoteWordCount('!!!'),0);
  assert.equal(quoteWordCount(''),0);
});
// Mirrors test_risk_flags_without_evidence_* in the harness's tests/test_scorer.py.
test('risk flags without evidence need a grounded quotation inside the flagged clause',()=>{
  const c=benchmark.cases.find(c=>c.id==='nda'); const anchors=c.gold.clause_anchors;
  const review=(flags,quotes)=>({clauses:[],risk_flags:flags.map(clause_type=>({clause_type,severity:'high',rationale:'r'})),citations:quotes.map(quote=>({clause_type:'anything',quote}))});
  const flagged=['term','governing_law'];
  assert.deepEqual(scoreReview(c.source,c.gold,review(flagged,[anchors.term])).risk_flags_without_evidence,['governing_law']);
  assert.deepEqual(scoreReview(c.source,c.gold,review(flagged,[])).risk_flags_without_evidence,['governing_law','term']);
  // An ungrounded quotation is no evidence.
  assert.deepEqual(scoreReview(c.source,c.gold,review(flagged,['a clause that does not appear anywhere'])).risk_flags_without_evidence,['governing_law','term']);
  assert.deepEqual(scoreReview(c.source,c.gold,review([],[])).risk_flags_without_evidence,[]);
  // A flag with no anchor, or whose anchor is not in the contract, is not reported; risk precision or span coverage carries it.
  assert.deepEqual(scoreReview(c.source,c.gold,review(['spurious'],[])).risk_flags_without_evidence,[]);
  const ghost=scoreReview(c.source,{...c.gold,clause_anchors:{...anchors,ghost:'an anchor that is not in the contract'}},review(['ghost'],[]));
  assert.deepEqual(ghost.risk_flags_without_evidence,[]);
  assert.ok(ghost.span_uncovered_clauses.includes('ghost'));
  // Both read the same regions: flagging every anchored clause reports exactly the uncovered ones.
  const all=scoreReview(c.source,c.gold,review(Object.keys(anchors),[anchors.term,'shall remain in effect in perpetuity']));
  assert.deepEqual(all.risk_flags_without_evidence,all.span_uncovered_clauses);
  assert.equal(all.span_uncovered_clauses.length,Object.keys(anchors).length-1);
  assert.ok(!all.span_uncovered_clauses.includes('term'));
});
// Mirrors test_score_review_checks_evidence_on_the_canonical_clause_name in the harness's tests/test_api.py.
test('a flag under a declared synonym is checked against the canonical clause anchor',()=>{
  const source='The agreement is governed by the laws of Ireland. The supplier may appoint further subcontractors on notice.\n';
  const gold={clause_types:['governing_law','subprocessors'],risk_flags:{subprocessors:'high'},clause_aliases:{sub_processors:'subprocessors'},clause_anchors:{governing_law:'governed by the laws of Ireland',subprocessors:'appoint further subcontractors on notice'},thresholds:{}};
  const review={clauses:[{clause_type:'governing_law',text:'x'},{clause_type:'sub_processors',text:'x'}],risk_flags:[{clause_type:'sub_processors',severity:'high',rationale:'r'}],citations:[{clause_type:'governing_law',quote:'governed by the laws of Ireland'}]};
  assert.deepEqual(scoreReview(source,gold,review,'on').risk_flags_without_evidence,['subprocessors']);
  // Without aliases the flag names no anchored clause; risk precision carries it instead.
  const off=scoreReview(source,gold,review,'off');
  assert.deepEqual(off.risk_flags_without_evidence,[]);
  assert.deepEqual(off.risk_false_positives,['sub_processors']);
  const quoted={...review,citations:[...review.citations,{clause_type:'sub_processors',quote:'appoint further subcontractors'}]};
  assert.deepEqual(scoreReview(source,gold,quoted).risk_flags_without_evidence,[]);
});

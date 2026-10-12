import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseView, viewQuery } from '../lib/view.ts';
const catalog = {cases:[{id:'nda', keys:['term','notices'], quotations:{baseline:['term','notices'],'no-evidence':[]}},{id:'saas',keys:['fees'],quotations:{baseline:['fees'],'no-evidence':[]}}],scenarios:['baseline','no-evidence']};
const defaults = {caseId:'nda',scenario:'baseline'};
const empty = {caseId:'nda',scenario:'baseline',compare:'no-evidence',tab:'review',list:'findings',finding:null,quote:null,comparedQuote:null,locale:'en',panel:'list',guided:false,edition:null};
const params = query => Object.fromEntries(new URLSearchParams(query));
test('precise views preserve case, scenario, quotation, comparison, language and reference edition',()=>{
  const view={...empty,caseId:'saas',scenario:'no-evidence',compare:'baseline',tab:'compare',list:'quotations',finding:'fees',comparedQuote:0,locale:'de',panel:'contract',edition:'a'.repeat(40)};
  assert.deepEqual(parseView(params(viewQuery(view,defaults)),catalog),view);
});
test('quotation indices identify exact repeated passages and choose their canonical clause',()=>{
  assert.deepEqual(parseView({quote:'2',finding:'term'},catalog),{...empty,finding:'notices',quote:1,panel:'contract'});
  const exact = {...empty,quote:1,finding:'notices',panel:'contract'};
  assert.deepEqual(parseView(params(viewQuery(exact,defaults)),catalog),exact);
});
test('foreign values and cross-scenario quote indices cannot restore inaccessible evidence',()=>{
  assert.deepEqual(parseView({case:'lease',scenario:'drop-table',tab:'<script>',list:'x',finding:'fees',quote:'999',compare:'baseline',cquote:'-1',lang:'script',edition:'x'},catalog),empty);
  assert.equal(parseView({case:'nda',scenario:'no-evidence',quote:'1'},catalog).quote,null);
  assert.equal(parseView({quote:'1.5'},catalog).quote,null);
  assert.equal(parseView({quote:'0'},catalog).quote,null);
  assert.equal(parseView({case:['saas','nda']},catalog).caseId,'saas');
});
test('old findings and evidence links retain their selected clauses',()=>{
  assert.equal(parseView({tab:'findings',finding:'term'},catalog).finding,'term');
  assert.equal(parseView({tab:'evidence'},catalog).list,'quotations');
  assert.equal(parseView({tab:'evidence',list:'clauses'},catalog).list,'clauses');
});
test('the guide appears for a fresh visit but never overrides a precise shared view',()=>{
  assert.equal(parseView({},catalog).guided,true);
  assert.equal(parseView({lang:'de'},catalog).guided,true);
  assert.equal(parseView({finding:'term'},catalog).guided,false);
  assert.equal(parseView({guide:'0'},catalog).guided,false);
  assert.equal(parseView({guide:'1',case:'saas'},catalog).guided,true);
});

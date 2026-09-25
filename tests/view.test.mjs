import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseView, viewQuery } from '../lib/view.ts';

const catalog = { cases: [{ id: 'nda', keys: ['term', 'notices'] }, { id: 'saas', keys: ['fees'] }], scenarios: ['baseline', 'no-evidence'] };
const defaults = { caseId: 'nda', scenario: 'baseline' };

test('shareable views round-trip through the query string', () => {
  const view = { caseId: 'saas', scenario: 'no-evidence', tab: 'evidence', finding: 'fees' };
  const query = viewQuery(view, defaults);
  assert.equal(query, '?case=saas&scenario=no-evidence&tab=evidence&finding=fees');
  assert.deepEqual(parseView(Object.fromEntries(new URLSearchParams(query)), catalog), view);
  assert.equal(viewQuery({ ...defaults, tab: 'findings', finding: null }, defaults), '');
});

test('unknown or foreign values fall back to safe defaults', () => {
  assert.deepEqual(parseView({ case: 'lease', scenario: 'drop-table', tab: '<script>', finding: 'fees' }, catalog), { caseId: 'nda', scenario: 'baseline', tab: 'findings', finding: null });
  assert.equal(parseView({ case: 'nda', finding: 'fees' }, catalog).finding, null);
  assert.equal(parseView({ case: ['saas', 'nda'] }, catalog).caseId, 'saas');
});

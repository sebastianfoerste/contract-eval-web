import test from 'node:test';
import assert from 'node:assert/strict';
import {appliedTheme, applyTheme, nextTheme} from '../lib/theme.ts';

test('theme selection cycles even when the storage getter or writes are denied', () => {
  for (const storage of [() => {throw new Error('blocked getter');}, () => ({setItem(){throw new Error('quota');},removeItem(){throw new Error('blocked');}})]) {
    const root = {dataset:{}};
    for (const expected of ['light','dark','system','light']) {
      applyTheme(root, storage, nextTheme(appliedTheme(root)));
      assert.equal(appliedTheme(root), expected);
    }
  }
});

test('theme writes persist only explicit choices and discard unsupported applied values', () => {
  const root = {dataset:{theme:'unsupported'}};
  const values = new Map();
  const storage = () => ({setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  assert.equal(appliedTheme(root),'system');
  applyTheme(root,storage,'dark');
  assert.equal(values.get('theme'),'dark');
  applyTheme(root,storage,'system');
  assert.equal(values.has('theme'),false);
  assert.equal(root.dataset.theme,undefined);
});

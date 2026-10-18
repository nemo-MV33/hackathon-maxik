import assert from 'node:assert/strict';
import test from 'node:test';
import { BackButtonStack } from '../webapp/src/lib/back-button-stack.mjs';

test('native back closes only the top sheet and restores its underlying screen', () => {
  const calls = []; let handler; let shown = 0; let hidden = 0;
  const stack = new BackButtonStack({ show: () => shown++, hide: () => hidden++, onClick: (fn) => { handler = fn; }, offClick: (fn) => { assert.equal(fn, handler); handler = null; } });
  const screen = stack.add(() => calls.push('screen'));
  const sheet = stack.add(() => calls.push('sheet'));
  handler(); assert.deepEqual(calls, ['sheet']); assert.equal(shown, 1); assert.equal(hidden, 0);
  sheet(); handler(); assert.deepEqual(calls, ['sheet', 'screen']); assert.equal(hidden, 0);
  screen(); assert.equal(hidden, 1); assert.equal(handler, null);
});

test('closing an underlying screen does not hide back while a sheet remains; cleanup is idempotent', () => {
  const calls = []; let handler; let hidden = 0;
  const stack = new BackButtonStack({ show: () => {}, hide: () => hidden++, onClick: (fn) => { handler = fn; }, offClick: () => {} });
  const parent = stack.add(() => calls.push('parent')); const child = stack.add(() => calls.push('child'));
  parent(); parent(); handler(); assert.deepEqual(calls, ['child']); assert.equal(hidden, 0);
  child(); child(); assert.equal(hidden, 1);
});

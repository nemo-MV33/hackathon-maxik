import test from 'node:test';
import assert from 'node:assert/strict';
import { daySwipe } from '../webapp/src/lib/day-swipe.mjs';

test('planner day gestures accept left/right swipes and ignore vertical scrolling, short moves and missing starts', () => {
  const start = { x: 200, y: 300 };
  assert.equal(daySwipe(start, { x: 100, y: 305 }), 1);
  assert.equal(daySwipe(start, { x: 300, y: 305 }), -1);
  assert.equal(daySwipe(start, { x: 180, y: 180 }), 0);
  assert.equal(daySwipe(start, { x: 135, y: 200 }), 0);
  assert.equal(daySwipe(start, { x: 150, y: 300 }), 0);
  assert.equal(daySwipe(null, { x: 100, y: 300 }), 0);
});

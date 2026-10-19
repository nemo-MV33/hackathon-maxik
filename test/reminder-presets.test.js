import test from 'node:test';
import assert from 'node:assert/strict';
import { hourAhead, selectedPreset } from '../webapp/src/lib/reminder-presets.mjs';

test('hour reminder remains selected when the clock advances and custom input is distinguished', () => {
  const openedAt = new Date('2026-10-19T01:10:00.123Z');
  const value = hourAhead(openedAt);
  assert.equal(value, '2026-10-19T02:10:00.123Z');
  for (const elapsed of [1, 1000, 60000]) {
    const presets = [{ id: 'none', at: null }, { id: 'hour', at: hourAhead(openedAt) }];
    assert.equal(selectedPreset(presets, value), 'hour');
    assert.equal(selectedPreset(presets, new Date(Date.parse(value) + elapsed).toISOString()), 'custom');
    assert.equal(selectedPreset(presets, null), 'none');
  }
});

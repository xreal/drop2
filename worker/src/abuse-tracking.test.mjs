import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pruneAbuseTracking,
  recordFailedPin,
} from './abuse-tracking.ts';

test('pruneAbuseTracking drops expired cooldown entries', () => {
  const state = {
    failed_pins: { keep: 2, drop: 1 },
    cooldown_until: { keep: 5_000, drop: 500 },
  };

  pruneAbuseTracking(state, 1_000);

  assert.deepEqual(state.failed_pins, { keep: 2 });
  assert.deepEqual(state.cooldown_until, { keep: 5_000 });
});

test('pruneAbuseTracking keeps newest active cooldown entries when over limit', () => {
  const state = {
    failed_pins: {},
    cooldown_until: {},
  };

  for (let index = 0; index < 300; index += 1) {
    state.failed_pins[`ip-${index}`] = index + 1;
    state.cooldown_until[`ip-${index}`] = 10_000 + index;
  }

  pruneAbuseTracking(state, 1_000);

  assert.equal(Object.keys(state.failed_pins).length, 256);
  assert.equal(Object.keys(state.cooldown_until).length, 256);
  assert.equal(state.failed_pins['ip-299'], 300);
  assert.equal(state.failed_pins['ip-44'], 45);
  assert.equal(state.failed_pins['ip-43'], undefined);
});

test('recordFailedPin increments failures and sets cooldown', () => {
  const state = {
    failed_pins: {},
    cooldown_until: {},
  };

  recordFailedPin(state, 'ip-1', 9_999);
  recordFailedPin(state, 'ip-1', null);

  assert.deepEqual(state.failed_pins, { 'ip-1': 2 });
  assert.deepEqual(state.cooldown_until, { 'ip-1': 9_999 });
});

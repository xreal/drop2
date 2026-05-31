import test from 'node:test';
import assert from 'node:assert/strict';

import { transferCompleteTransition } from './live-share-state.ts';

test('transfer completion keeps receiver open', () => {
  const next = transferCompleteTransition('active');
  assert.deepEqual(next, {
    nextStatus: 'completed',
    closeSender: true,
    closeReceiver: false,
    clearJoinToken: true,
  });
});

test('transfer completion ignores terminal states', () => {
  assert.equal(transferCompleteTransition('completed'), null);
  assert.equal(transferCompleteTransition('expired'), null);
  assert.equal(transferCompleteTransition('cancelled'), null);
  assert.equal(transferCompleteTransition('failed'), null);
});

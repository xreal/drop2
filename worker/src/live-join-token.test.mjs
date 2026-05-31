import test from 'node:test';
import assert from 'node:assert/strict';

import {
  JOIN_TOKEN_TTL_MS,
  clearJoinToken,
  isJoinTokenValid,
  issueJoinToken,
} from './live-join-token.ts';

test('issueJoinToken sets deterministic TTL expiry', () => {
  const issued = issueJoinToken(1_000, 'token-1');
  assert.deepEqual(issued, {
    joinToken: 'token-1',
    joinTokenExpiresAt: 1_000 + JOIN_TOKEN_TTL_MS,
  });
});

test('isJoinTokenValid enforces token match and expiry', () => {
  assert.equal(isJoinTokenValid('a', 'a', 1_500, 1_500), true);
  assert.equal(isJoinTokenValid('a', 'a', 1_500, 1_501), false);
  assert.equal(isJoinTokenValid('a', 'b', 1_500, 1_400), false);
  assert.equal(isJoinTokenValid('a', null, 1_500, 1_400), false);
  assert.equal(isJoinTokenValid('a', 'a', null, 1_400), false);
});

test('clearJoinToken removes token and expiry', () => {
  const state = {
    join_token: 'abc',
    join_token_expires_at: 5_000,
  };
  clearJoinToken(state);
  assert.equal(state.join_token, null);
  assert.equal(state.join_token_expires_at, null);
});

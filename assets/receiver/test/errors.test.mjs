import test from 'node:test';
import assert from 'node:assert/strict';

import { mapApiError, UserMsg } from '../src/errors.js';

test('mapApiError maps canonical worker messages', () => {
  assert.equal(mapApiError({ error: 'share expired' }), UserMsg.SHARE_EXPIRED);
  assert.equal(mapApiError({ error: 'access denied' }), UserMsg.ACCESS_DENIED);
  assert.equal(mapApiError({ error: 'share unavailable' }), UserMsg.SHARE_UNAVAILABLE);
  assert.equal(mapApiError({}), UserMsg.ACCESS_DENIED);
});

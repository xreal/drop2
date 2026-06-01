import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveDownloadable, liveStatusMessage } from '../src/live-watch.js';

test('isLiveDownloadable only allows waiting', () => {
  assert.equal(isLiveDownloadable('waiting'), true);
  assert.equal(isLiveDownloadable('active'), false);
  assert.equal(isLiveDownloadable('cancelled'), false);
});

test('liveStatusMessage reflects sender presence', () => {
  const offline = liveStatusMessage({
    status: 'waiting',
    senderOnline: false,
    pinRequired: false,
  });
  assert.match(offline, /Waiting for sender/);

  const online = liveStatusMessage({
    status: 'waiting',
    senderOnline: true,
    pinRequired: true,
  });
  assert.match(online, /PIN/);
});

test('liveStatusMessage maps terminal states', () => {
  assert.match(
    liveStatusMessage({ status: 'cancelled', senderOnline: false }),
    /closed/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, parseHistory, MAX_HISTORY, downloadLabel, needsDownloadCheck, readDownloadStatus } from '../src/download-history.js';

function memoryStorage() {
  let value = null;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}
const share = (id = 'abc123') => ({
  share_id: id, download_status_token: 'sender-status-only', expires_at: Date.now() + 3600_000,
  share_url: 'https://example.com/s/abc123#secret', pin: '4821', upload_token: 'upload-secret',
});

test('history survives reloads without retaining share secrets and is bounded', () => {
  const storage = memoryStorage();
  const history = createHistory(storage);
  for (let i = 0; i < MAX_HISTORY + 5; i++) history.add(share(String(i).padStart(6, '0')), 'report.pdf', true);
  const reloaded = createHistory(storage).read();
  assert.equal(reloaded.length, MAX_HISTORY);
  assert.equal(reloaded[0].id, '000024');
  assert.doesNotMatch(storage.getItem(), /upload-secret|#secret|4821|share_url/);
});

test('completion survives reload and expiry; only pending shares are polled', () => {
  const storage = memoryStorage();
  const history = createHistory(storage);
  history.add(share(), 'report.pdf', true);
  assert.equal(needsDownloadCheck(history.read()[0]), true);
  history.update('abc123', readDownloadStatus({state:'deleted', downloaded_at:Date.now(), expires_at:Date.now() + 1000}));
  const received = createHistory(storage).read()[0];
  assert.equal(downloadLabel(received), 'Downloaded');
  assert.equal(needsDownloadCheck(received), false);
  assert.equal(downloadLabel({...received, state:'expired'}), 'Downloaded');
  assert.equal(downloadLabel({...received, downloadedAt:null, state:'expired'}), 'Expired');
  history.remove('abc123');
  history.update('abc123', {state:'ready'});
  assert.deepEqual(history.read(), []);
});

test('corrupt and expired history is pruned from storage', () => {
  const storage = memoryStorage();
  const history = createHistory(storage);
  history.add(share(), 'report.pdf', false);
  history.update('abc123', { expiresAt: Date.now() - 8 * 86400_000 });
  assert.deepEqual(history.read(), []);
  assert.equal(storage.getItem(), '[]');
  for (const raw of ['broken', '{}', '[null]', '[{"id":"../../evil"}]']) assert.deepEqual(parseHistory(raw), []);
  assert.throws(() => readDownloadStatus({ state:'ready', downloaded_at:'yes', expires_at:1 }));
});

test('blocked browser storage falls back to usable session history', () => {
  let errors = 0;
  const history = createHistory({getItem() { throw new Error('blocked'); }}, () => { errors++; });
  history.add(share(), 'report.pdf', true);
  history.update('abc123', { downloadedAt: Date.now() });
  assert.equal(downloadLabel(history.read()[0]), 'Downloaded');
  assert.equal(errors, 1);
});

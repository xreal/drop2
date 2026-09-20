import test from 'node:test';
import assert from 'node:assert/strict';
import { showDownloadNotification } from '../src/download-notifications.js';

const entry = {id:'abc123', name:'report.pdf', downloadedAt:123, notify:true, notified:false};

test('only confirmed, opted-in, unseen receipts notify with browser permission', () => {
  let delivered;
  class Notification {
    static permission = 'granted';
    constructor(title, options) { delivered = this; this.title = title; this.options = options; }
    close() { this.closed = true; }
  }
  for (const changes of [{downloadedAt:null}, {notify:false}, {notified:true}]) {
    assert.equal(showDownloadNotification({...entry, ...changes}, () => {}, Notification), false);
  }
  for (const permission of ['default', 'denied']) {
    Notification.permission = permission;
    assert.equal(showDownloadNotification(entry, () => {}, Notification), false);
  }
  assert.equal(showDownloadNotification(entry, () => {}, null), false);
  assert.equal(delivered, undefined);
  Notification.permission = 'granted';
  let opened = false;
  assert.equal(showDownloadNotification(entry, () => { opened = true; }, Notification), true);
  assert.equal(delivered.title, 'Your file was downloaded');
  assert.deepEqual(delivered.options, {body:'report.pdf', tag:'drop2-download-abc123'});
  delivered.onclick();
  assert.equal(opened, true);
  assert.equal(delivered.closed, true);
});

test('notification API failure is not recorded as successful delivery', () => {
  class UnsupportedNotification {
    static permission = 'granted';
    constructor() { throw new Error('unsupported'); }
  }
  assert.throws(() => showDownloadNotification(entry, () => {}, UnsupportedNotification));
  assert.equal(entry.notified, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemNotifications, showDownloadNotification } from '../src/system-notifications.js';

const entry = {id:'abc123', name:'report.pdf', downloadedAt:123, notify:true, notified:false};

test('only opted-in confirmed unseen downloads with permission can notify', async () => {
  let count = 0;
  const notifications = {permission: () => 'granted', async show() { count++; }};
  for (const changes of [{downloadedAt:null}, {notify:false}, {notified:true}]) {
    assert.equal(await showDownloadNotification({...entry, ...changes}, notifications), false);
  }
  for (const permission of ['denied', 'default', 'unsupported']) {
    assert.equal(await showDownloadNotification(entry, {...notifications, permission: () => permission}), false);
  }
  assert.equal(count, 0);
  assert.equal(await showDownloadNotification(entry, notifications), true);
  assert.equal(count, 1);
});

test('service worker notifications wait for the browser and propagate asynchronous failures', async () => {
  let finish;
  let options;
  const registration = {
    showNotification(title, value) {
      assert.equal(title, 'Your file was downloaded');
      options = value;
      return new Promise(resolve => { finish = resolve; });
    },
  };
  const serviceWorker = {
    async register(path) { assert.equal(path, '/notification-worker.js'); return registration; },
    ready: Promise.resolve(registration),
  };
  const notifications = createSystemNotifications({NotificationApi:{permission:'granted'}, serviceWorker});
  let acknowledged = false;
  const pending = showDownloadNotification(entry, notifications).then(result => { acknowledged = result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false);
  assert.deepEqual(options, { body:'report.pdf', tag:'drop2-download-abc123', requireInteraction:true });
  finish();
  await pending;
  assert.equal(acknowledged, true);
  registration.showNotification = async () => { throw new Error('blocked by browser'); };
  await assert.rejects(showDownloadNotification(entry, notifications), /blocked by browser/);
});

test('desktop fallback waits for show instead of treating construction as success', async () => {
  let notification;
  class Notification {
    static permission = 'granted';
    constructor() { notification = this; }
  }
  const notifications = createSystemNotifications({NotificationApi:Notification, serviceWorker:null});
  const pending = showDownloadNotification(entry, notifications);
  notification.onshow();
  assert.equal(await pending, true);
  const failed = showDownloadNotification(entry, notifications);
  notification.onerror();
  await assert.rejects(failed, /could not show/);
});

test('registration errors remain retryable and unsupported permission never prompts', async () => {
  let attempts = 0;
  const registration = { async showNotification() {} };
  const serviceWorker = {
    async register() { if (++attempts === 1) throw new Error('registration failed'); return registration; },
    ready: Promise.resolve(registration),
  };
  const notifications = createSystemNotifications({NotificationApi:{permission:'granted'}, serviceWorker});
  await assert.rejects(showDownloadNotification(entry, notifications), /registration failed/);
  assert.equal(await showDownloadNotification(entry, notifications), true);
  const unavailable = createSystemNotifications({NotificationApi:null, serviceWorker:null});
  assert.equal(await unavailable.requestPermission(), 'unsupported');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { initNotificationControls } from '../src/notification-controls.js';
import { createHistory } from '../src/download-history.js';

function setup(t, permission = 'granted') {
  const nodes = new Map();
  const values = new Map();
  const storage = { getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value) };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { handlers:{}, addEventListener(event, fn) { this.handlers[event] = fn; } });
    return nodes.get(id);
  }
  const original = { document:globalThis.document, window:globalThis.window };
  globalThis.document = { querySelector:node };
  globalThis.window = {isSecureContext:true, addEventListener() {}};
  t.after(() => { globalThis.document = original.document; globalThis.window = original.window; });
  const history = createHistory(storage);
  history.add({share_id:'abc123', download_status_token:'proof', expires_at:Date.now() + 10000}, 'report.pdf', false);
  const notifications = {permission:() => permission, async requestPermission() { return permission; }, async show() {}};
  return {node, storage, history, notifications};
}

test('dashboard enable activates existing receipts and survives the send-another reset', async t => {
  const {node, storage, history, notifications} = setup(t);
  storage.setItem('drop2.notifications.enabled', 'false');
  initNotificationControls(notifications, history, storage);
  node('#enable-notifications').handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(history.read()[0].notify, true);
  assert.equal(storage.getItem('drop2.notifications.enabled'), 'true');
  node('#download-notification').checked = false;
  node('#send-form').handlers.reset();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(node('#download-notification').checked, true);
});

test('notification delivery failures are visible in the dashboard', async t => {
  const {node, storage, history, notifications} = setup(t);
  notifications.show = async () => { throw new Error('OS blocked'); };
  initNotificationControls(notifications, history, storage);
  await node('#test-notification').handlers.click();
  assert.match(node('#notification-feedback').textContent, /could not show the test notification/);
  assert.equal(node('#test-notification').disabled, false);
});

test('denied permission is visible and cannot silently enable notifications', async t => {
  const {node, storage, history, notifications} = setup(t, 'denied');
  initNotificationControls(notifications, history, storage);
  assert.match(node('#notification-status').textContent, /Notifications blocked/);
  assert.equal(node('#download-notification').disabled, true);
  assert.equal(history.read()[0].notify, false);
});

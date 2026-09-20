import { createSystemNotifications, showDownloadNotification } from './system-notifications.js';
import { initNotificationControls } from './notification-controls.js';
import { downloadDetailLines } from './download-details.js';
import { HISTORY_KEY, createHistory, downloadLabel, needsDownloadCheck, readDownloadStatus } from './download-history.js';

export function initDownloadNotifications() {
  const list = document.querySelector('#download-list');
  const summary = document.querySelector('#download-summary');
  const connection = document.querySelector('#download-connection');
  let storage;
  try { storage = window.localStorage; } catch { /* Session-only history below. */ }
  const history = createHistory(storage, () => {
    document.querySelector('#download-storage').textContent = 'Browser storage is unavailable. This history lasts until you close or reload this page.';
  });
  let checking = false;
  let timer;

  const notifications = createSystemNotifications();
  const controls = initNotificationControls(notifications, history, storage);

  function render() {
    const entries = history.read();
    const received = entries.filter(entry => entry.downloadedAt).length;
    summary.textContent = entries.length ? `${received} of ${entries.length} received` : 'Files you send from this browser will appear here.';
    list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('li');
      row.className = 'download-row';
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = entry.name;
      const time = document.createElement('small');
      time.textContent = entry.downloadedAt
        ? `Received ${new Date(entry.downloadedAt).toLocaleString()}`
        : `Sent ${new Date(entry.createdAt).toLocaleString()}`;
      details.append(name, time);
      if (entry.downloadedAt) {
        for (const line of downloadDetailLines(entry.downloadDetails)) {
          const detail = document.createElement('small');
          detail.className = 'download-detail';
          detail.textContent = line;
          details.append(detail);
        }
      }
      const badge = document.createElement('span');
      badge.className = `download-badge${entry.downloadedAt ? ' is-received' : ''}`;
      badge.textContent = downloadLabel(entry);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'download-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${entry.name} from this browser’s history`);
      remove.addEventListener('click', () => { history.remove(entry.id); render(); });
      row.append(details, badge, remove);
      list.append(row);
    }
  }

  async function notify(entry) {
    if (!controls.enabled()) return true;
    try {
      if (await showDownloadNotification(entry, notifications)) history.update(entry.id, { notified: true });
      return true;
    } catch {
      controls.failed();
      return false;
    }
  }

  async function refresh() {
    let failed = false;
    for (const entry of history.read()) {
      if (!needsDownloadCheck(entry)) continue;
      try {
        const response = await fetch(`/api/v1/stored/${entry.id}/download-status`, {
          headers: { 'x-drop2-status-token': entry.token }, cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 404) history.update(entry.id, { state: 'unavailable' });
        else {
          if (!response.ok) throw new Error('Status unavailable');
          history.update(entry.id, readDownloadStatus(await response.json()));
        }
      } catch { failed = true; }
    }
    for (const entry of history.read()) {
      if (!await notify(entry)) break;
    }
    connection.textContent = failed ? 'Could not refresh some downloads. Retrying automatically…' : '';
    render();
  }

  async function check() {
    if (checking) return;
    clearTimeout(timer);
    checking = true;
    try {
      // One polling tab also prevents duplicate notifications across open sender tabs.
      if (navigator.locks) {
        await navigator.locks.request('drop2-download-status', { ifAvailable: true }, async lock => {
          if (lock) await refresh();
        });
      } else await refresh();
    } finally {
      checking = false;
      timer = setTimeout(() => { void check(); }, 15000);
    }
  }
  window.addEventListener('storage', event => { if (event.key === HISTORY_KEY) render(); });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'show-downloads') document.querySelector('#downloads').scrollIntoView({ behavior: 'smooth' });
  });
  window.addEventListener('online', () => { void check(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { controls.render(); void check(); }
  });
  controls.render();
  render();
  void check();
  return {
    track(result, name) {
      history.add(result, name, controls.enabled());
      render();
      void check();
    },
  };
}

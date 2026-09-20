import { HISTORY_KEY, createHistory, downloadLabel, needsDownloadCheck, readDownloadStatus } from './download-history.js';

export function initDownloadNotifications() {
  const toggle = document.querySelector('#download-notification');
  const permissionCopy = document.querySelector('#notification-permission');
  const list = document.querySelector('#download-list');
  const summary = document.querySelector('#download-summary');
  const connection = document.querySelector('#download-connection');
  const enable = document.querySelector('#enable-notifications');
  let storage;
  try { storage = window.localStorage; } catch { /* Session-only history below. */ }
  const history = createHistory(storage, () => {
    document.querySelector('#download-storage').textContent = 'Browser storage is unavailable. This history lasts until you close or reload this page.';
  });
  let checking = false;
  let timer;

  function permissionStatus() {
    const supported = window.isSecureContext && 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    permissionCopy.textContent = permission === 'granted'
      ? 'Notify me after the first completed download. Keep this page open.'
      : permission === 'denied'
        ? 'Notifications are blocked. Allow them in your browser’s site settings; the dashboard still works.'
        : permission === 'unsupported'
          ? 'Browser notifications are unavailable here. Follow downloads in the dashboard.'
          : 'Know when your file is received. Allow notifications and keep this page open.';
    toggle.disabled = !supported || permission === 'denied';
    enable.hidden = !supported || permission === 'granted' || permission === 'denied';
    return permission;
  }

  async function requestPermission() {
    if (permissionStatus() !== 'default') return;
    try { await Notification.requestPermission(); } catch { /* Dashboard remains available. */ }
    permissionStatus();
  }
  toggle.addEventListener('change', () => { if (toggle.checked) void requestPermission(); });
  enable.addEventListener('click', () => { void requestPermission(); });

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

  function notify(entry) {
    try {
      if (showDownloadNotification(entry, () => {
        window.focus();
        document.querySelector('#downloads').scrollIntoView({ behavior: 'smooth' });
      })) history.update(entry.id, { notified: true });
    } catch {
      permissionCopy.textContent = 'Browser notifications could not be shown. Follow downloads in the dashboard.';
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
    for (const entry of history.read()) notify(entry);
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
  window.addEventListener('online', () => { void check(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { permissionStatus(); void check(); }
  });
  permissionStatus();
  render();
  void check();
  return {
    track(result, name) {
      history.add(result, name, toggle.checked);
      render();
      void check();
    },
  };
}

export function showDownloadNotification(entry, onClick, NotificationApi = globalThis.Notification) {
  if (!entry.downloadedAt || !entry.notify || entry.notified || NotificationApi?.permission !== 'granted') {
    return false;
  }
  const notification = new NotificationApi('Your file was downloaded', {
    body: entry.name, tag: `drop2-download-${entry.id}`,
  });
  notification.onclick = () => {
    onClick();
    notification.close();
  };
  return true;
}

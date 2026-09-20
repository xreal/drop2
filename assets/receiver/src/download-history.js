export const HISTORY_KEY = 'drop2.downloads.v1';
export const MAX_HISTORY = 20;
const RETENTION_MS = 7 * 86400_000;
const STATES = new Set(['uploading', 'ready', 'deleting', 'deleted', 'expired', 'failed', 'unavailable']);

export function parseHistory(raw, now = Date.now()) {
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => entry &&
      /^[A-Za-z0-9]{6}$/.test(entry.id) &&
      typeof entry.token === 'string' && entry.token.length <= 128 && entry.token.length > 0 &&
      typeof entry.name === 'string' && entry.name.length <= 255 &&
      Number.isSafeInteger(entry.expiresAt) && entry.expiresAt + RETENTION_MS > now &&
      Number.isSafeInteger(entry.createdAt) && STATES.has(entry.state) &&
      (entry.downloadedAt === null || Number.isSafeInteger(entry.downloadedAt)) &&
      typeof entry.notify === 'boolean' && typeof entry.notified === 'boolean',
    ).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function createHistory(storage, onStorageError = () => {}) {
  let memory = [];
  let persistent = true;
  function read() {
    if (persistent) {
      try {
        const raw = storage.getItem(HISTORY_KEY);
        memory = parseHistory(raw);
        if (raw !== null && raw !== JSON.stringify(memory)) save(memory);
      }
      catch { persistent = false; onStorageError(); }
    }
    return memory;
  }
  function save(entries) {
    memory = entries.slice(0, MAX_HISTORY);
    if (persistent) {
      try { storage.setItem(HISTORY_KEY, JSON.stringify(memory)); }
      catch { persistent = false; onStorageError(); }
    }
  }
  return {
    read,
    add(result, name, notify) {
      const entry = {
        id: result.share_id, token: result.download_status_token,
        name: name.slice(0, 255), expiresAt: result.expires_at, createdAt: Date.now(),
        state: 'ready', downloadedAt: null, notify, notified: false,
      };
      if (!entry.token) return;
      save([entry, ...read().filter(item => item.id !== entry.id)]);
    },
    update(id, changes) {
      save(read().map(entry => entry.id === id ? { ...entry, ...changes } : entry));
    },
    remove(id) { save(read().filter(entry => entry.id !== id)); },
  };
}

export function readDownloadStatus(body) {
  if (!body || !STATES.has(body.state) || !Number.isSafeInteger(body.expires_at) ||
      !(body.downloaded_at === null || (Number.isSafeInteger(body.downloaded_at) && body.downloaded_at > 0))) {
    throw new Error('Invalid download status');
  }
  return { state: body.state, downloadedAt: body.downloaded_at, expiresAt: body.expires_at };
}

export function needsDownloadCheck(entry) {
  return !entry.downloadedAt && (entry.state === 'ready' || entry.state === 'uploading');
}

export function downloadLabel(entry) {
  if (entry.downloadedAt) return 'Downloaded';
  if (entry.state === 'expired') return 'Expired';
  if (['failed', 'deleted', 'deleting', 'unavailable'].includes(entry.state)) return 'Unavailable';
  return 'Waiting for download';
}

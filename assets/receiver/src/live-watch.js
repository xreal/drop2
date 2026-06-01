import { UserMsg } from './errors.js';

const TERMINAL = new Set(['completed', 'expired', 'cancelled', 'failed']);
const POLL_MS = 5000;

function wsBaseUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function parseStateMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg?.type !== 'state' || typeof msg.status !== 'string') {
      return null;
    }
    return {
      status: msg.status,
      senderOnline: Boolean(msg.sender_online),
    };
  } catch {
    return null;
  }
}

function pollShareInfo(shareId) {
  return fetch(`/api/v1/shares/${shareId}`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

/**
 * Subscribe to live-share status over WebSocket (hosted or local).
 * Falls back to HTTP polling when the watch socket is unavailable.
 * Returns a cleanup function.
 */
export function watchLiveShare({ mode, shareId, onUpdate, onTerminal, onWatchUnavailable }) {
  const path =
    mode === 'hosted'
      ? `/api/v1/live/${shareId}/connect?role=watch`
      : '/api/watch';
  const ws = new WebSocket(`${wsBaseUrl()}${path}`);
  let closed = false;
  let gotState = false;
  let pollTimer = null;

  function applyUpdate(update) {
    onUpdate(update);
    if (TERMINAL.has(update.status)) {
      onTerminal?.(update);
    }
  }

  function startPolling() {
    if (pollTimer || mode !== 'hosted' || !shareId) return;
    onWatchUnavailable?.();

    const tick = async () => {
      if (closed) return;
      const info = await pollShareInfo(shareId);
      if (!info || closed) return;
      applyUpdate({
        status: info.status,
        senderOnline: info.status === 'waiting',
      });
    };

    void tick();
    pollTimer = setInterval(tick, POLL_MS);
  }

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const update = parseStateMessage(event.data);
    if (!update) return;
    gotState = true;
    applyUpdate(update);
  };

  ws.onerror = () => {
    if (!closed && !gotState) {
      startPolling();
    }
  };

  ws.onclose = () => {
    closed = true;
    if (!gotState) {
      startPolling();
    }
  };

  return () => {
    closed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}

export function liveStatusMessage({ status, senderOnline, pinRequired }) {
  switch (status) {
    case 'waiting':
      if (!senderOnline) {
        return 'Waiting for sender to come online…';
      }
      return pinRequired
        ? 'Sender is ready — enter your PIN when you download'
        : 'Sender is online — ready when you are';
    case 'active':
      return 'Transfer in progress on this share';
    case 'completed':
      return 'This share has finished';
    case 'expired':
      return UserMsg.SHARE_EXPIRED;
    case 'cancelled':
      return 'Sender closed this share';
    case 'failed':
      return UserMsg.SHARE_UNAVAILABLE;
    default:
      return 'Checking share status…';
  }
}

export function isLiveDownloadable(status) {
  return status === 'waiting';
}

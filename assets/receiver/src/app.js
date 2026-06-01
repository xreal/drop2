import { detectShareContext, joinAndDownload, loadShareInfo } from './crypto.js';
import { UserMsg } from './errors.js';
import {
  isLiveDownloadable,
  liveStatusMessage,
  watchLiveShare,
} from './live-watch.js';

const shellEl = document.querySelector('.shell');
const statusEl = document.querySelector('#status');
const metaEl = document.querySelector('#meta');
const fileNameEl = document.querySelector('#file-name');
const fileMetaEl = document.querySelector('#file-meta');
const livePillEl = document.querySelector('#live-pill');
const actionEl = document.querySelector('#download');
const btnLabelEl = document.querySelector('#btn-label');
const progressWrapEl = document.querySelector('#progress-wrap');
const progressFillEl = document.querySelector('#progress-fill');
const progressLabelEl = document.querySelector('#progress-label');
const thanksEl = document.querySelector('#thanks');

let liveInfo = null;
let liveWatchStop = null;
let uiPhase = 'loading';

function setStatus(text, tone = 'default') {
  statusEl.textContent = text;
  statusEl.classList.remove('is-warn', 'is-error', 'is-active');
  if (tone === 'warn') statusEl.classList.add('is-warn');
  if (tone === 'error') statusEl.classList.add('is-error');
  if (tone === 'active') statusEl.classList.add('is-active');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isStoredAvailable(status) {
  return status === 'ready';
}

function setUiPhase(phase) {
  uiPhase = phase;
  shellEl.classList.remove('is-complete', 'is-unavailable');
  actionEl.classList.remove('is-downloading');
  thanksEl.hidden = true;

  if (phase === 'complete') {
    shellEl.classList.add('is-complete');
    thanksEl.hidden = false;
    progressWrapEl.hidden = true;
    return;
  }

  if (phase === 'unavailable') {
    shellEl.classList.add('is-unavailable');
    actionEl.disabled = true;
    progressWrapEl.hidden = true;
    return;
  }

  if (phase === 'downloading') {
    actionEl.disabled = true;
    actionEl.classList.add('is-downloading');
    btnLabelEl.textContent = 'Downloading…';
    progressWrapEl.hidden = false;
    return;
  }

  if (phase === 'connecting') {
    actionEl.disabled = true;
    btnLabelEl.textContent = 'Connecting…';
    progressWrapEl.hidden = true;
    return;
  }

  if (phase === 'ready') {
    actionEl.disabled = false;
    btnLabelEl.textContent = 'Download securely';
    progressWrapEl.hidden = true;
    progressFillEl.style.width = '0%';
    return;
  }

  actionEl.disabled = true;
  progressWrapEl.hidden = true;
}

function updateProgress(received, total) {
  const pct =
    typeof total === 'number' && total > 0
      ? Math.min(100, Math.round((received / total) * 100))
      : null;
  if (pct !== null) {
    progressFillEl.style.width = `${pct}%`;
    progressLabelEl.textContent = `${formatBytes(received)} of ${formatBytes(total)} (${pct}%)`;
  } else {
    progressFillEl.style.width = received > 0 ? '100%' : '0%';
    progressFillEl.style.animation = received > 0 ? 'none' : undefined;
    if (received > 0 && !progressFillEl.style.width) {
      progressFillEl.style.width = '30%';
    }
    progressLabelEl.textContent = `Received ${formatBytes(received)}`;
  }
}

function applyLiveWatch(update) {
  if (!liveInfo || uiPhase === 'downloading' || uiPhase === 'complete') {
    return;
  }

  liveInfo = { ...liveInfo, status: update.status };

  if (!isLiveDownloadable(update.status)) {
    const tone =
      update.status === 'expired' || update.status === 'cancelled' || update.status === 'failed'
        ? 'error'
        : 'warn';
    setStatus(liveStatusMessage({ ...update, pinRequired: liveInfo.pin_required }), tone);
    setUiPhase('unavailable');
    return;
  }

  if (update.status === 'active') {
    setStatus('Someone is already downloading this file', 'warn');
    setUiPhase('unavailable');
    return;
  }

  const tone = update.senderOnline ? 'active' : 'default';
  setStatus(
    liveStatusMessage({ ...update, pinRequired: liveInfo.pin_required }),
    tone,
  );
  setUiPhase(update.senderOnline ? 'ready' : 'idle');
  actionEl.disabled = !update.senderOnline;
}

function onWatchUnavailable() {
  if (!liveInfo || uiPhase === 'downloading' || uiPhase === 'complete') {
    return;
  }
  if (isLiveDownloadable(liveInfo.status)) {
    setStatus(
      'Live updates unavailable — you can still download when the sender is ready',
      'warn',
    );
    setUiPhase('ready');
    actionEl.disabled = false;
  }
}

function startLiveWatch(ctx, info) {
  liveWatchStop?.();
  liveWatchStop = watchLiveShare({
    mode: ctx.mode,
    shareId: ctx.shareId,
    onUpdate: applyLiveWatch,
    onTerminal: applyLiveWatch,
    onWatchUnavailable,
  });
}

async function main() {
  try {
    const ctx = detectShareContext();
    const info = await loadShareInfo(ctx);

    if (info.mode === 'stored') {
      if (!isStoredAvailable(info.status)) {
        setStatus(UserMsg.SHARE_UNAVAILABLE, 'error');
        setUiPhase('unavailable');
        return;
      }
      if (ctx.mode === 'hosted' && !ctx.capability) {
        setStatus(UserMsg.MISSING_CAPABILITY, 'error');
        setUiPhase('unavailable');
        return;
      }
    } else if (!isLiveDownloadable(info.status) && info.status !== 'active') {
      setStatus(UserMsg.SHARE_UNAVAILABLE, 'error');
      setUiPhase('unavailable');
      return;
    }

    const isLive = info.mode !== 'stored';
    livePillEl.hidden = !isLive;

    fileNameEl.textContent = info.name;
    const sizeLabel = formatBytes(info.size);
    const kindLabel = info.kind === 'folder' ? 'folder archive' : 'file';
    fileMetaEl.textContent = `${sizeLabel} · ${kindLabel}`;

    const modeLabel = info.mode === 'stored' ? 'Stored share' : 'Live share';
    metaEl.innerHTML = `
      <dt>Share ID</dt><dd>${escapeHtml(info.share_id)}</dd>
      <dt>Mode</dt><dd>${modeLabel}</dd>
    `;

    if (isLive) {
      liveInfo = info;
      if (info.status === 'active') {
        setStatus('Someone is already downloading this file', 'warn');
        setUiPhase('unavailable');
      } else {
        setStatus('Connecting to sender…', 'active');
        setUiPhase('idle');
        actionEl.disabled = true;
      }
      startLiveWatch(ctx, info);
    } else {
      setStatus('Ready to download — stored until expiry', 'active');
      setUiPhase('ready');
    }

    actionEl.addEventListener('click', async () => {
      if (uiPhase === 'downloading' || uiPhase === 'complete') return;

      liveWatchStop?.();
      liveWatchStop = null;

      setUiPhase('connecting');
      setStatus('Preparing secure session…', 'active');

      try {
        setUiPhase('downloading');
        setStatus('Downloading encrypted stream…', 'active');

        const bytes = await joinAndDownload({
          ctx,
          info: liveInfo ?? info,
          onStatus: (text) => setStatus(text, 'active'),
          onProgress: (received) => {
            const total = info.kind === 'file' ? info.size : undefined;
            updateProgress(received, total);
          },
        });

        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = info.name;
        a.click();
        URL.revokeObjectURL(url);

        setStatus('Download complete', 'active');
        setUiPhase('complete');
      } catch (err) {
        setStatus(err.message || UserMsg.DOWNLOAD_FAILED, 'error');
        if (isLive && ctx.shareId) {
          const refreshed = await loadShareInfo(ctx).catch(() => null);
          if (refreshed && isLiveDownloadable(refreshed.status)) {
            liveInfo = refreshed;
            startLiveWatch(ctx, refreshed);
            setUiPhase('ready');
          } else {
            setUiPhase('unavailable');
          }
        } else {
          setUiPhase('ready');
        }
      }
    });
  } catch (err) {
    setStatus(err.message || UserMsg.SHARE_UNAVAILABLE, 'error');
    setUiPhase('unavailable');
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

main();

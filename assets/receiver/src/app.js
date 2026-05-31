import { detectShareContext, joinAndDownload, loadShareInfo } from './crypto.js';
import { UserMsg } from './errors.js';

const statusEl = document.querySelector('#status');
const metaEl = document.querySelector('#meta');
const actionEl = document.querySelector('#download');
const progressEl = document.querySelector('#progress');

function setStatus(text) {
  statusEl.textContent = text;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isLiveAvailable(status) {
  return status === 'waiting' || status === 'active';
}

function isStoredAvailable(status) {
  return status === 'ready';
}

async function main() {
  try {
    const ctx = detectShareContext();
    const info = await loadShareInfo(ctx);

    if (info.mode === 'stored') {
      if (!isStoredAvailable(info.status)) {
        setStatus(UserMsg.SHARE_UNAVAILABLE);
        return;
      }
      if (!ctx.capability) {
        setStatus(UserMsg.MISSING_CAPABILITY);
        return;
      }
    } else if (!isLiveAvailable(info.status)) {
      setStatus(UserMsg.SHARE_UNAVAILABLE);
      return;
    }

    const modeLabel = info.mode === 'stored' ? 'Stored' : 'Live';
    metaEl.innerHTML = `
      <dt>Name</dt><dd>${escapeHtml(info.name)}</dd>
      <dt>Size</dt><dd>${formatBytes(info.size)}${info.kind === 'folder' ? ' (folder archive)' : ''}</dd>
      <dt>Mode</dt><dd>${modeLabel}</dd>
      <dt>Share</dt><dd>${escapeHtml(info.share_id)}</dd>
    `;
    setStatus('Ready to download');

    actionEl.addEventListener('click', async () => {
      actionEl.disabled = true;
      progressEl.hidden = false;
      try {
        const bytes = await joinAndDownload({
          ctx,
          info,
          onStatus: setStatus,
          onProgress: (received) => {
            progressEl.textContent = `Received ${formatBytes(received)}`;
          },
        });
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = info.name;
        a.click();
        URL.revokeObjectURL(url);
        setStatus('Download complete');
      } catch (err) {
        setStatus(err.message || UserMsg.DOWNLOAD_FAILED);
        actionEl.disabled = false;
      }
    });
  } catch (err) {
    setStatus(err.message || UserMsg.SHARE_UNAVAILABLE);
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

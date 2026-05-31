import { joinAndDownload } from './crypto.js';

const statusEl = document.querySelector('#status');
const metaEl = document.querySelector('#meta');
const actionEl = document.querySelector('#download');
const progressEl = document.querySelector('#progress');

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadInfo() {
  const res = await fetch('/api/info');
  if (!res.ok) throw new Error('Could not load share info');
  return res.json();
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function main() {
  try {
    const info = await loadInfo();
    metaEl.innerHTML = `
      <dt>Name</dt><dd>${escapeHtml(info.name)}</dd>
      <dt>Size</dt><dd>${formatBytes(info.size)}${info.kind === 'folder' ? ' (folder archive)' : ''}</dd>
      <dt>Share</dt><dd>${escapeHtml(info.share_id)}</dd>
    `;
    setStatus('Ready to download');

    actionEl.addEventListener('click', async () => {
      actionEl.disabled = true;
      progressEl.hidden = false;
      try {
        const bytes = await joinAndDownload({
          pinRequired: info.pin_required,
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
        setStatus(err.message || 'Download failed');
        actionEl.disabled = false;
      }
    });
  } catch (err) {
    setStatus(err.message || 'Failed to load share');
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

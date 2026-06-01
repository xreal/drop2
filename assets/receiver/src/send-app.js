import {
  ANONYMOUS_BROWSER_SEND_LIMIT,
  prepareStoredUpload,
  uploadPreparedStoredShare,
} from './stored-upload.js';

const formEl = document.querySelector('#send-form');
const fileInputEl = document.querySelector('#file-input');
const fileSummaryEl = document.querySelector('#file-summary');
const expiryModeEl = document.querySelector('#expiry-mode');
const statusEl = document.querySelector('#status');
const progressWrapEl = document.querySelector('#progress-wrap');
const progressFillEl = document.querySelector('#progress-fill');
const progressLabelEl = document.querySelector('#progress-label');
const sendButtonEl = document.querySelector('#send-button');
const successEl = document.querySelector('#success');
const shareUrlEl = document.querySelector('#share-url');
const pinEl = document.querySelector('#pin');
const copyLinkEl = document.querySelector('#copy-link');
const copyPinEl = document.querySelector('#copy-pin');

fileInputEl.addEventListener('change', () => {
  const file = fileInputEl.files?.[0];
  if (!file) {
    fileSummaryEl.textContent = 'Single-file browser send, up to 10 MiB anonymously.';
    return;
  }
  fileSummaryEl.textContent = `${file.name} · ${formatBytes(file.size)}`;
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = fileInputEl.files?.[0];
  if (!file) return;

  if (file.size > ANONYMOUS_BROWSER_SEND_LIMIT) {
    setStatus('Files over 10 MiB will require GitHub auth in a later browser-send phase.', 'error');
    return;
  }

  setBusy(true);
  successEl.hidden = true;
  try {
    setStatus('Encrypting in browser…', 'active');
    const prepared = await prepareStoredUpload(file, {
      expiryMode: expiryModeEl.value,
      onProgress: updateProgress,
    });

    setStatus('Uploading ciphertext…', 'active');
    const result = await uploadPreparedStoredShare(prepared, {
      onProgress: updateProgress,
    });

    shareUrlEl.value = result.share_url;
    pinEl.value = result.pin;
    successEl.hidden = false;
    setStatus('Upload complete', 'active');
  } catch (err) {
    setStatus(err.message || 'Upload failed', 'error');
  } finally {
    setBusy(false);
  }
});

copyLinkEl.addEventListener('click', () => copyValue(shareUrlEl, copyLinkEl));
copyPinEl.addEventListener('click', () => copyValue(pinEl, copyPinEl));

function setBusy(busy) {
  sendButtonEl.disabled = busy;
  fileInputEl.disabled = busy;
  expiryModeEl.disabled = busy;
  progressWrapEl.hidden = !busy;
  if (!busy) {
    progressFillEl.style.width = '0%';
    progressLabelEl.textContent = '';
  }
}

function setStatus(text, tone = 'default') {
  statusEl.textContent = text;
  statusEl.classList.remove('is-error', 'is-active');
  if (tone === 'error') statusEl.classList.add('is-error');
  if (tone === 'active') statusEl.classList.add('is-active');
}

function updateProgress({ phase, done, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  progressFillEl.style.width = `${pct}%`;
  progressLabelEl.textContent = `${phase === 'encrypt' ? 'Encrypted' : 'Uploaded'} ${pct}%`;
}

async function copyValue(input, button) {
  await navigator.clipboard.writeText(input.value);
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

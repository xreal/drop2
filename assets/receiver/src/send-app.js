import {
  ANONYMOUS_BROWSER_SEND_LIMIT,
  prepareStoredUpload,
  uploadPreparedStoredShare,
} from './stored-upload.js';

const formEl = document.querySelector('#send-form');
const uploadCardEl = document.querySelector('#upload-card');
const filePickerEl = document.querySelector('#file-picker');
const fileInputEl = document.querySelector('#file-input');
const fileNameEl = document.querySelector('#file-name');
const fileSummaryEl = document.querySelector('#file-summary');
const fileReadyEl = document.querySelector('#file-ready');
const fileChangeEl = document.querySelector('#file-change');
const expiryEls = [...document.querySelectorAll('input[name="expiry"]')];
const pinRequiredEl = document.querySelector('#pin-required');
const statusEl = document.querySelector('#status');
const progressWrapEl = document.querySelector('#progress-wrap');
const progressFillEl = document.querySelector('#progress-fill');
const progressLabelEl = document.querySelector('#progress-label');
const sendButtonEl = document.querySelector('#send-button');
const successEl = document.querySelector('#success');
const successExpiryEl = document.querySelector('#success-expiry');
const successFileNameEl = document.querySelector('#success-file-name');
const successFileSizeEl = document.querySelector('#success-file-size');
const successPinChipEl = document.querySelector('#success-pin-chip');
const shareUrlEl = document.querySelector('#share-url');
const pinFieldEl = document.querySelector('#pin-field');
const pinEl = document.querySelector('#pin');
const shareHelperEl = document.querySelector('#share-helper');
const copyLinkEl = document.querySelector('#copy-link');
const copyPinEl = document.querySelector('#copy-pin');
const sendAnotherEl = document.querySelector('#send-another');
const trustStripEl = document.querySelector('#trust-strip');

const expiryLabels = {
  after_download: 'It will be deleted after the first completed download.',
  '1d': 'It will expire in one day.',
  '2d': 'It will expire in two days.',
  '1w': 'It will expire in one week.',
};

let selectedFile = null;
let busy = false;

fileInputEl.addEventListener('change', () => selectFile(fileInputEl.files?.[0] ?? null));

for (const eventName of ['dragenter', 'dragover']) {
  filePickerEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!busy) filePickerEl.classList.add('is-dragging');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  filePickerEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    filePickerEl.classList.remove('is-dragging');
  });
}

filePickerEl.addEventListener('drop', (event) => {
  if (!busy) selectFile(event.dataTransfer?.files?.[0] ?? null);
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = selectedFile;
  if (!file || file.size > ANONYMOUS_BROWSER_SEND_LIMIT || file.size === 0) return;

  const expiryMode = expiryEls.find((input) => input.checked)?.value ?? '1w';
  setBusy(true);
  successEl.hidden = true;

  try {
    setStatus('Encrypting in your browser…', 'active');
    const prepared = await prepareStoredUpload(file, {
      expiryMode,
      pinRequired: pinRequiredEl.checked,
      onProgress: updateProgress,
    });

    setStatus('Uploading encrypted data…', 'active');
    const result = await uploadPreparedStoredShare(prepared, { onProgress: updateProgress });

    showSuccess({ result, file, expiryMode });
  } catch (err) {
    setStatus(err.message || 'Upload failed. Please try again.', 'error');
  } finally {
    setBusy(false);
  }
});

copyLinkEl.addEventListener('click', () => copyValue(shareUrlEl, copyLinkEl, 'Copy link'));
copyPinEl.addEventListener('click', () => copyValue(pinEl, copyPinEl, 'Copy PIN'));
sendAnotherEl.addEventListener('click', resetForm);

function selectFile(file) {
  selectedFile = file;
  setStatus('');
  filePickerEl.classList.toggle('has-file', Boolean(file));
  fileReadyEl.hidden = !file;
  fileChangeEl.hidden = !file;

  if (!file) {
    fileNameEl.textContent = 'Choose a file';
    fileSummaryEl.textContent = 'or drag and drop it here';
    updateSendButton();
    return;
  }

  fileNameEl.textContent = file.name || 'Untitled file';
  fileSummaryEl.textContent = formatBytes(file.size);

  if (file.size > ANONYMOUS_BROWSER_SEND_LIMIT) {
    fileSummaryEl.textContent += ' · exceeds the 10 MiB limit';
    fileReadyEl.hidden = true;
    setStatus('Choose a file no larger than 10 MiB.', 'error');
  } else if (file.size === 0) {
    fileReadyEl.hidden = true;
    setStatus('Empty files are not supported yet.', 'error');
  }
  updateSendButton();
}

function showSuccess({ result, file, expiryMode }) {
  shareUrlEl.value = result.share_url;
  pinEl.value = result.pin ?? '';
  pinFieldEl.hidden = !result.pin;
  successPinChipEl.textContent = result.pin ? 'PIN protected' : 'No PIN';
  shareHelperEl.textContent = result.pin
    ? 'Send the PIN separately from the link for an extra access gate.'
    : 'Anyone with the full link can access and decrypt the file until it expires.';
  successFileNameEl.textContent = file.name || 'Untitled file';
  successFileSizeEl.textContent = formatBytes(file.size);
  successExpiryEl.textContent = expiryLabels[expiryMode];
  uploadCardEl.hidden = true;
  successEl.hidden = false;
  trustStripEl.hidden = true;
  successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  formEl.reset();
  fileInputEl.value = '';
  selectedFile = null;
  successEl.hidden = true;
  uploadCardEl.hidden = false;
  trustStripEl.hidden = false;
  progressWrapEl.hidden = true;
  progressFillEl.style.width = '0%';
  progressLabelEl.textContent = '';
  selectFile(null);
  uploadCardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setBusy(nextBusy) {
  busy = nextBusy;
  fileInputEl.disabled = nextBusy;
  pinRequiredEl.disabled = nextBusy;
  for (const input of expiryEls) input.disabled = nextBusy;
  progressWrapEl.hidden = !nextBusy;
  updateSendButton();

  if (!nextBusy) {
    progressFillEl.style.width = '0%';
    progressLabelEl.textContent = '';
  }
}

function updateSendButton() {
  sendButtonEl.disabled =
    busy ||
    !selectedFile ||
    selectedFile.size === 0 ||
    selectedFile.size > ANONYMOUS_BROWSER_SEND_LIMIT;
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

async function copyValue(input, button, defaultLabel) {
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = defaultLabel;
    }, 1400);
  } catch {
    input.focus();
    input.select();
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

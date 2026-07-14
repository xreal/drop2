import {
  ANONYMOUS_BROWSER_SEND_LIMIT,
  AUTHENTICATED_BROWSER_SEND_LIMIT,
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
const expiryGroupEl = document.querySelector('.option-group');
const pinRequiredEl = document.querySelector('#pin-required');
const quickLinkEl = document.querySelector('#quick-link');
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
const securityNoteEl = document.querySelector('#security-note');
const buttonLabelEl = document.querySelector('#btn-label');
const emailFormEl = document.querySelector('#email-form');
const emailRecipientsEl = document.querySelector('#email-recipients');
const emailMessageEl = document.querySelector('#email-message');
const emailPinOptionEl = document.querySelector('#email-pin-option');
const emailSendPinEl = document.querySelector('#email-send-pin');
const emailStatusEl = document.querySelector('#email-status');
const emailSubmitEl = document.querySelector('#email-submit');
const emailCompleteEl = document.querySelector('#email-complete');
const emailCompleteCopyEl = document.querySelector('#email-complete-copy');
const sendLimitCopyEl = document.querySelector('#send-limit-copy');
const authSigninEl = document.querySelector('#auth-signin');
const authUserEl = document.querySelector('#auth-user');
const authLoginEl = document.querySelector('#auth-login');
const authSignoutEl = document.querySelector('#auth-signout');

const expiryLabels = {
  after_download: 'It will be deleted after the first completed download.',
  '1d': 'It will expire in one day.',
  '2d': 'It will expire in two days.',
  '1w': 'It will expire in one week.',
  quick: 'It will be deleted after the first completed download or within two hours.',
};

let selectedFile = null;
let busy = false;
let previousExpiryMode = '1w';
let quickModeApplied = false;
let currentShare = null;
let maxPlaintextBytes = ANONYMOUS_BROWSER_SEND_LIMIT;
let authSession = null;

fileInputEl.addEventListener('change', () => selectFile(fileInputEl.files?.[0] ?? null));
quickLinkEl.addEventListener('change', applyQuickLinkMode);
authSignoutEl?.addEventListener('click', signOut);

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
  if (!file || file.size > maxPlaintextBytes || file.size === 0) return;

  const expiryMode = expiryEls.find((input) => input.checked)?.value ?? '1w';
  setBusy(true);
  successEl.hidden = true;

  try {
    const quickLink = quickLinkEl.checked;
    setStatus(quickLink ? 'Preparing file…' : 'Encrypting in your browser…', 'active');
    const prepared = await prepareStoredUpload(file, {
      expiryMode,
      pinRequired: pinRequiredEl.checked,
      quickLink,
      maxPlaintextBytes,
      onProgress: updateProgress,
    });

    setStatus(quickLink ? 'Uploading file…' : 'Uploading encrypted data…', 'active');
    const result = await uploadPreparedStoredShare(prepared, { onProgress: updateProgress });

    showSuccess({ result, file, expiryMode: prepared.expiryMode, quickLink });
    await refreshAuthSession();
  } catch (err) {
    setStatus(err.message || 'Upload failed. Please try again.', 'error');
  } finally {
    setBusy(false);
  }
});

copyLinkEl.addEventListener('click', () => copyValue(shareUrlEl, copyLinkEl, 'Copy link'));
copyPinEl.addEventListener('click', () => copyValue(pinEl, copyPinEl, 'Copy PIN'));
sendAnotherEl.addEventListener('click', resetForm);
emailFormEl.addEventListener('submit', sendShareEmail);

void bootAuth();

async function bootAuth() {
  await refreshAuthSession();
  const params = new URLSearchParams(window.location.search);
  const authFlag = params.get('auth');
  if (authFlag === 'ok') {
    setStatus('Signed in. You can send files up to 1 GiB.', 'active');
  } else if (authFlag === 'ineligible') {
    setStatus(
      'Signed in, but this GitHub account is not eligible for large sends yet (180+ days old and at least 2 public repos).',
      'error',
    );
  } else if (authFlag === 'suspended') {
    setStatus('This account is suspended and cannot create large shares.', 'error');
  } else if (authFlag === 'error') {
    setStatus('GitHub sign-in failed. Please try again.', 'error');
  }
  if (authFlag) {
    params.delete('auth');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
  }
}

async function refreshAuthSession() {
  try {
    const res = await fetch('/api/v1/auth/session', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('session unavailable');
    authSession = await res.json();
  } catch {
    authSession = {
      signed_in: false,
      eligible: false,
    };
  }
  applyAuthSession();
}

function applyAuthSession() {
  const signedIn = Boolean(authSession?.signed_in);
  const eligible = Boolean(authSession?.eligible);
  maxPlaintextBytes =
    signedIn && eligible ? AUTHENTICATED_BROWSER_SEND_LIMIT : ANONYMOUS_BROWSER_SEND_LIMIT;

  if (authSigninEl && authUserEl && authLoginEl) {
    authSigninEl.hidden = signedIn;
    authUserEl.hidden = !signedIn;
    authLoginEl.textContent = signedIn ? `@${authSession.github_login}` : '';
  }

  if (sendLimitCopyEl) {
    if (signedIn && eligible) {
      sendLimitCopyEl.textContent =
        'Signed in. Up to 1 GiB per file (1.2 GiB/day, 2 GiB/week).';
    } else if (signedIn) {
      sendLimitCopyEl.textContent =
        'Signed in. Large sends need a GitHub account at least 180 days old with 2+ public repos.';
    } else {
      sendLimitCopyEl.textContent =
        'Up to 10 MiB anonymously. Sign in with GitHub for up to 1 GiB.';
    }
  }

  if (selectedFile) selectFile(selectedFile);
  else updateSendButton();
}

async function signOut() {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // ignore network errors; local UI still resets
  }
  authSession = { signed_in: false, eligible: false };
  applyAuthSession();
  setStatus('Signed out.', 'active');
}

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

  if (file.size > maxPlaintextBytes) {
    const limitLabel =
      maxPlaintextBytes <= ANONYMOUS_BROWSER_SEND_LIMIT ? '10 MiB' : '1 GiB';
    fileSummaryEl.textContent += ` · exceeds the ${limitLabel} limit`;
    fileReadyEl.hidden = true;
    if (maxPlaintextBytes <= ANONYMOUS_BROWSER_SEND_LIMIT && !authSession?.signed_in) {
      setStatus('Sign in with GitHub to send files larger than 10 MiB (up to 1 GiB).', 'error');
    } else if (authSession?.signed_in && !authSession?.eligible) {
      setStatus(
        'This GitHub account is not eligible for large sends (180+ days and 2+ public repos).',
        'error',
      );
    } else {
      setStatus(`Choose a file no larger than ${limitLabel}.`, 'error');
    }
  } else if (file.size === 0) {
    fileReadyEl.hidden = true;
    setStatus('Empty files are not supported yet.', 'error');
  }
  updateSendButton();
}

function showSuccess({ result, file, expiryMode, quickLink }) {
  currentShare = result;
  shareUrlEl.value = result.share_url;
  pinEl.value = result.pin ?? '';
  pinFieldEl.hidden = !result.pin;
  successPinChipEl.textContent = quickLink ? 'Quick link' : result.pin ? 'PIN protected' : 'No PIN';
  shareHelperEl.textContent = quickLink
    ? 'This short link is not end-to-end encrypted. Send its required PIN separately.'
    : result.pin
    ? 'Send the PIN separately from the link for an extra access gate.'
    : 'Anyone with the full link can access and decrypt the file until it expires.';
  successFileNameEl.textContent = file.name || 'Untitled file';
  successFileSizeEl.textContent = formatBytes(file.size);
  successExpiryEl.textContent = expiryLabels[expiryMode];
  emailPinOptionEl.hidden = !result.pin;
  emailSendPinEl.checked = false;
  emailFormEl.hidden = false;
  emailCompleteEl.hidden = true;
  setEmailStatus('');
  uploadCardEl.hidden = true;
  successEl.hidden = false;
  trustStripEl.hidden = true;
  successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  formEl.reset();
  fileInputEl.value = '';
  selectedFile = null;
  currentShare = null;
  previousExpiryMode = '1w';
  successEl.hidden = true;
  uploadCardEl.hidden = false;
  trustStripEl.hidden = false;
  progressWrapEl.hidden = true;
  progressFillEl.style.width = '0%';
  progressLabelEl.textContent = '';
  emailFormEl.reset();
  emailFormEl.hidden = false;
  emailCompleteEl.hidden = true;
  setEmailStatus('');
  selectFile(null);
  applyQuickLinkMode();
  uploadCardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function sendShareEmail(event) {
  event.preventDefault();
  if (!currentShare?.email_notify_token) {
    setEmailStatus('Email delivery is unavailable for this share.', 'error');
    return;
  }

  const recipients = uniqueRecipients(emailRecipientsEl.value);
  if (recipients.length < 1 || recipients.length > 5) {
    setEmailStatus('Enter between 1 and 5 recipient email addresses.', 'error');
    return;
  }

  emailSubmitEl.disabled = true;
  setEmailStatus('Queuing private emails…', 'active');
  try {
    const response = await fetch(`/api/v1/stored/${currentShare.share_id}/notify`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-drop2-notify-token': currentShare.email_notify_token,
      },
      body: JSON.stringify({
        recipients,
        message: emailMessageEl.value,
        share_url: currentShare.share_url,
        pin: currentShare.pin ?? undefined,
        send_pin_separately: Boolean(currentShare.pin && emailSendPinEl.checked),
      }),
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response));
    const result = await response.json();
    emailCompleteCopyEl.textContent = result.failed_pin_messages
      ? `${result.queued_recipients} link emails queued, but ${result.failed_pin_messages} PIN email failed. Share the PIN another way.`
      : result.failed_recipients
        ? `${result.queued_recipients} queued; ${result.failed_recipients} could not be queued.`
        : `${result.queued_recipients} recipient${result.queued_recipients === 1 ? '' : 's'} will receive the link shortly.`;
    emailFormEl.hidden = true;
    emailCompleteEl.hidden = false;
  } catch (err) {
    setEmailStatus(err.message || 'Email delivery failed. Please try again.', 'error');
  } finally {
    emailSubmitEl.disabled = false;
  }
}

function uniqueRecipients(raw) {
  const recipients = raw.split(/[,;\n]+/).map((value) => value.trim()).filter(Boolean);
  return recipients.filter((value, index) =>
    recipients.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
  );
}

function setEmailStatus(text, tone = 'default') {
  emailStatusEl.textContent = text;
  emailStatusEl.classList.remove('is-error', 'is-active');
  if (tone === 'error') emailStatusEl.classList.add('is-error');
  if (tone === 'active') emailStatusEl.classList.add('is-active');
}

function setBusy(nextBusy) {
  busy = nextBusy;
  fileInputEl.disabled = nextBusy;
  quickLinkEl.disabled = nextBusy;
  pinRequiredEl.disabled = nextBusy || quickLinkEl.checked;
  for (const input of expiryEls) input.disabled = nextBusy || quickLinkEl.checked;
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
    selectedFile.size > maxPlaintextBytes;
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
  const verb = phase === 'encrypt' ? 'Encrypted' : phase === 'prepare' ? 'Prepared' : 'Uploaded';
  progressLabelEl.textContent = `${verb} ${pct}%`;
}

function applyQuickLinkMode() {
  const quickLink = quickLinkEl.checked;
  if (quickLink && !quickModeApplied) {
    previousExpiryMode = expiryEls.find((input) => input.checked)?.value ?? '1w';
    const afterDownload = expiryEls.find((input) => input.value === 'after_download');
    if (afterDownload) afterDownload.checked = true;
    pinRequiredEl.checked = true;
  } else if (!quickLink && quickModeApplied) {
    const previous = expiryEls.find((input) => input.value === previousExpiryMode);
    if (previous) previous.checked = true;
  }
  quickModeApplied = quickLink;
  pinRequiredEl.disabled = busy || quickLink;
  for (const input of expiryEls) input.disabled = busy || quickLink;
  expiryGroupEl.classList.toggle('is-locked', quickLink);
  expiryGroupEl.setAttribute('aria-disabled', String(quickLink));
  securityNoteEl.lastChild.textContent = quickLink
    ? ' PIN protected. Not end-to-end encrypted; access expires within 2 hours.'
    : ' End-to-end encrypted and never analyzed.';
  buttonLabelEl.textContent = quickLink ? 'Create quick link' : 'Send securely';
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
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

async function apiErrorMessage(res) {
  const body = await res.json().catch(() => null);
  return body?.message || body?.error || `Request failed (${res.status})`;
}

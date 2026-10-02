import { createSecret, destroySecret } from './secret-api.js';
import { byteLength, MAX_SECRET_BYTES, sealSecret } from './secret-crypto.js';
import { $, bindCopy, clearErrorOnInput, errorMessage, setBusy, showError, showNotice, showView } from './secret-ui.js';

export function startCreate() {
  const form = $('create-form');
  const secretInput = $('secret-input');
  const passphraseToggle = $('passphrase-toggle');
  const passphraseInput = $('passphrase-input');
  const error = $('create-error');
  const createButton = $('create-button');
  const expiry = $('expiry-option');
  let link = null;

  showView('create');
  secretInput.focus();

  secretInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });

  passphraseToggle.addEventListener('click', () => {
    const on = passphraseToggle.getAttribute('aria-pressed') !== 'true';
    passphraseToggle.setAttribute('aria-pressed', String(on));
    $('passphrase-field').hidden = !on;
    if (on) passphraseInput.focus();
    else passphraseInput.value = '';
  });

  bindExpiry(expiry);
  clearErrorOnInput(error, [secretInput, passphraseInput]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const secret = secretInput.value;
    const passphrase = passphraseToggle.getAttribute('aria-pressed') === 'true' ? passphraseInput.value : null;
    const invalid = validate(secret, passphrase);
    if (invalid) return showError(error, invalid.message, $(invalid.field));

    showError(error, '');
    setBusy(createButton, true);
    try {
      const sealed = await sealSecret(secret, passphrase ?? '');
      const expiresIn = form.elements.expiry.value;
      const { id } = await createSecret(sealed, { passphrase: passphrase !== null, expiresIn });
      link = { id, linkToken: sealed.linkToken };
      clearInputs();
      showLink(`${location.origin}/secret/${id}#${sealed.key}`, expiresIn, passphrase !== null);
    } catch (failure) {
      showError(error, errorMessage(failure, 'Unable to create the link. Try again.'));
    } finally {
      setBusy(createButton, false);
    }
  });

  bindCopy($('copy-link'), () => $('secret-link').value);

  $('new-secret').addEventListener('click', () => {
    link = null;
    showView('create');
    secretInput.focus();
  });

  bindDestroy(() => link);

  function clearInputs() {
    secretInput.value = '';
    passphraseInput.value = '';
    passphraseToggle.setAttribute('aria-pressed', 'false');
    $('passphrase-field').hidden = true;
  }
}

function validate(secret, passphrase) {
  if (!secret.trim()) return { field: 'secret-input', message: 'Enter a secret to share.' };
  if (byteLength(secret) > MAX_SECRET_BYTES) {
    return { field: 'secret-input', message: 'Shorten your secret to 6,000 characters or fewer.' };
  }
  if (passphrase === '') return { field: 'passphrase-input', message: 'Enter a passphrase, or turn it off.' };
  return null;
}

function showLink(url, expiresIn, hasPassphrase) {
  $('secret-link').value = url;
  $('link-expiry').textContent = EXPIRY_TEXT[expiresIn];
  $('passphrase-note').hidden = !hasPassphrase;
  $('destroy-confirm').hidden = true;
  $('destroy-start').hidden = false;
  showView('link');
}

const EXPIRY_TEXT = { '1h': 'Expires in 1 hour.', '1d': 'Expires in 1 day.', '1w': 'Expires in 1 week.' };

function bindExpiry(details) {
  details.addEventListener('change', () => {
    syncExpiryLabel(details);
    details.open = false;
    details.querySelector('summary').focus();
  });
  details.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !details.open) return;
    details.open = false;
    details.querySelector('summary').focus();
  });
  document.addEventListener('click', (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
}

function syncExpiryLabel(details) {
  const checked = details.querySelector('input:checked');
  $('expiry-label').textContent = checked.nextElementSibling.textContent;
}

function bindDestroy(currentLink) {
  const start = $('destroy-start');
  const confirm = $('destroy-confirm');
  const confirmButton = $('destroy-confirm-button');

  start.addEventListener('click', () => {
    start.hidden = true;
    confirm.hidden = false;
    $('destroy-cancel').focus();
  });
  $('destroy-cancel').addEventListener('click', () => {
    confirm.hidden = true;
    start.hidden = false;
    start.focus();
  });
  confirmButton.addEventListener('click', async () => {
    const { id, linkToken } = currentLink();
    setBusy(confirmButton, true);
    try {
      await destroySecret(id, linkToken);
      showNotice('destroyed');
    } catch (failure) {
      if (failure.status === 404) return showNotice('gone');
      showError($('link-error'), errorMessage(failure, 'Unable to destroy the link. Try again.'));
    } finally {
      setBusy(confirmButton, false);
    }
  });
}

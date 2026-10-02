import { fetchSecretStatus, revealSecret } from './secret-api.js';
import { linkTokenFor, parseKey, unlockSecret } from './secret-crypto.js';
import { $, bindCopy, clearErrorOnInput, errorMessage, setBusy, showError, showNotice, showView } from './secret-ui.js';

export async function startReveal(id) {
  const key = parseKey(location.hash.slice(1));
  if (!key) return showNotice('broken');

  let status;
  try {
    status = await fetchSecretStatus(id, await linkTokenFor(key));
  } catch (failure) {
    return showNotice(failure.status === 404 ? 'gone' : 'unreachable');
  }

  $('reveal-passphrase-field').hidden = !status.passphrase;
  showView('reveal');
  if (status.passphrase) $('reveal-passphrase').focus();
  bindReveal(id, key, status.passphrase);
  bindCopy($('copy-secret'), () => $('secret-output').value);
}

function bindReveal(id, key, needsPassphrase) {
  const form = $('reveal-form');
  const passphraseInput = $('reveal-passphrase');
  const error = $('reveal-error');
  const button = $('reveal-button');
  let attemptsLeft = null;
  clearErrorOnInput(error, [passphraseInput]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passphrase = needsPassphrase ? passphraseInput.value : '';
    if (needsPassphrase && !passphrase) return showError(error, 'Enter the passphrase.', passphraseInput);

    showError(error, '');
    setBusy(button, true);
    try {
      const access = await unlockSecret(key, passphrase);
      const { ciphertext } = await revealSecret(id, access);
      // The secret is deleted server-side now; drop the key from the address bar and history entry.
      history.replaceState(null, '', location.pathname);
      showSecret(await access.open(ciphertext).catch(() => null));
    } catch (failure) {
      if (failure.status === 404) return showNotice(attemptsLeft === 1 ? 'locked' : 'gone');
      if (failure.status === 403) {
        attemptsLeft = failure.attemptsLeft;
        passphraseInput.select();
        return showError(error, wrongPassphrase(attemptsLeft), passphraseInput);
      }
      showError(error, errorMessage(failure, 'Unable to open this secret. Try again.'));
    } finally {
      setBusy(button, false);
    }
  });
}

function wrongPassphrase(attemptsLeft) {
  return attemptsLeft === 1
    ? 'Wrong passphrase. One try left before the secret is destroyed.'
    : `Wrong passphrase. ${attemptsLeft} tries left.`;
}

function showSecret(text) {
  if (text === null) return showNotice('corrupt');
  const output = $('secret-output');
  output.value = text;
  output.rows = Math.min(12, Math.max(3, text.split('\n').length));
  showView('secret');
}

const COPIED_MS = 1800;

export const $ = (id) => document.getElementById(id);

/** Show one view, hide the rest, and move focus to its heading for screen readers. */
export function showView(name) {
  for (const view of document.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== name;
  }
  document.querySelector(`[data-view="${name}"] h1`)?.focus({ preventScroll: true });
}

export function showNotice(kind) {
  for (const notice of document.querySelectorAll('[data-notice]')) {
    notice.hidden = notice.dataset.notice !== kind;
  }
  showView('notice');
  document.querySelector(`[data-notice="${kind}"] h1`)?.focus({ preventScroll: true });
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
}

/** Inline error beside the form; `field` gets aria-invalid until the next attempt. */
export function showError(output, message, field = null) {
  output.textContent = message;
  for (const invalid of output.form?.querySelectorAll('[aria-invalid]') ?? []) {
    invalid.removeAttribute('aria-invalid');
  }
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  field.focus();
}

/** Errors describe the last attempt; editing any of the fields starts a new one. */
export function clearErrorOnInput(output, fields) {
  for (const field of fields) {
    field.addEventListener('input', () => {
      if (output.textContent) showError(output, '');
    });
  }
}

export function errorMessage(error, fallback) {
  if (error?.status === 0) return 'Unable to reach drop2. Check your connection and try again.';
  if (error?.status === 429) return 'Too many secrets from this network. Try again in an hour.';
  return fallback;
}

export function bindCopy(button, readText) {
  const label = button.querySelector('[data-label]');
  const idle = label.textContent;
  let timer;
  button.addEventListener('click', async () => {
    await copyText(readText());
    label.textContent = 'Copied';
    button.classList.add('is-copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = idle;
      button.classList.remove('is-copied');
    }, COPIED_MS);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const scratch = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(scratch);
    scratch.select();
    document.execCommand('copy');
    scratch.remove();
  }
}

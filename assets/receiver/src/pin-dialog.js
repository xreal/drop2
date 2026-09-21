export function requestPin() {
  const dialog = document.querySelector('#pin-dialog');
  const input = dialog.querySelector('input');
  const previousFocus = document.activeElement;
  input.value = '';
  dialog.returnValue = '';

  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const pin = dialog.returnValue === 'unlock' ? input.value : null;
      input.value = '';
      previousFocus?.focus();
      resolve(pin);
    }, { once: true });
    dialog.showModal();
    input.focus();
  });
}

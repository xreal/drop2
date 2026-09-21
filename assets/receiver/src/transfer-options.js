export function initTransferOptions() {
  const form = document.querySelector('#send-form');
  const panels = [...form.querySelectorAll('.transfer-option')];
  const expiry = document.querySelector('#expiry-summary');
  const pin = document.querySelector('#pin-required');
  const quick = document.querySelector('#quick-link');
  const badge = document.querySelector('#encryption-badge');
  const card = document.querySelector('#upload-card');
  const expiryLabels = { after_download: '1 download', '1d': '1 day', '2d': '2 days', '1w': '1 week' };

  function render() {
    const selected = form.querySelector('input[name="expiry"]:checked');
    expiry.textContent = quick.checked ? '2 hours max' : expiryLabels[selected.value];
    document.querySelector('#pin-summary').textContent = pin.checked ? 'PIN on' : 'PIN off';
    badge.lastChild.textContent = quick.checked ? ' Quick link · not encrypted' : ' Encrypted';
    card.classList.toggle('is-quick', quick.checked);
  }

  function close() {
    for (const panel of panels) panel.open = false;
  }

  form.addEventListener('change', event => {
    render();
    if (event.target.name === 'expiry') {
      document.querySelector('#expiry-options').open = false;
      document.querySelector('#expiry-options > summary').focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.transfer-toolbar')) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = panels.find(panel => panel.open);
    if (!open) return;
    open.open = false;
    open.querySelector('summary').focus();
  });
  render();
  return { render, close };
}

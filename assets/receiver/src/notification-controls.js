const PREFERENCE_KEY = 'drop2.notifications.enabled';

export function initNotificationControls(notifications, history, storage) {
  const toggle = document.querySelector('#download-notification');
  const status = document.querySelector('#notification-status');
  const feedback = document.querySelector('#notification-feedback');
  const copy = document.querySelector('#notification-permission');
  let preference;
  try { preference = storage?.getItem(PREFERENCE_KEY); } catch { /* Session preference. */ }
  let enabled = preference === 'true' || (preference == null && notifications.permission() === 'granted');
  let busy = false;

  function render() {
    const permission = window.isSecureContext ? notifications.permission() : 'unsupported';
    const available = !['unsupported', 'denied'].includes(permission);
    status.textContent = permission === 'unsupported'
      ? 'System notifications are unavailable in this browser.'
      : permission === 'denied'
        ? 'Notifications blocked. Allow notifications for drop2.app in your browser’s site settings.'
        : enabled && permission === 'granted'
          ? 'Notifications on. Keep this page open.'
          : 'Notifications off. Enable them in Options when sending.';
    copy.textContent = 'System notifications for your downloads. Remembered in this browser; keep this page open.';
    toggle.checked = enabled;
    toggle.disabled = busy || !available;
  }

  async function setEnabled(next) {
    feedback.textContent = '';
    busy = true;
    render();
    try {
      const permission = next ? await notifications.requestPermission() : notifications.permission();
      enabled = next && permission === 'granted';
      try { storage?.setItem(PREFERENCE_KEY, String(enabled)); } catch { /* Session preference. */ }
      history.setNotifications(enabled);
      if (next && !enabled) feedback.textContent = 'Permission was not granted. Allow this site in your browser to receive system notifications.';
    } catch {
      enabled = false;
      feedback.textContent = 'Could not enable notifications. Check your browser’s site permissions.';
    } finally { busy = false; render(); }
    return enabled;
  }

  toggle.addEventListener('change', () => { void setEnabled(toggle.checked); });
  document.querySelector('#send-form').addEventListener('reset', () => { queueMicrotask(render); });
  window.addEventListener('storage', event => {
    if (event.key === PREFERENCE_KEY) { enabled = event.newValue === 'true'; render(); }
  });
  history.setNotifications(enabled);
  render();
  return {
    enabled: () => enabled,
    render,
    failed() { feedback.textContent = 'A download notification could not be shown. Check your browser and system notification settings. Retrying automatically.'; },
  };
}

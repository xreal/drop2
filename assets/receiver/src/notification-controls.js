const PREFERENCE_KEY = 'drop2.notifications.enabled';

export function initNotificationControls(notifications, history, storage) {
  const toggle = document.querySelector('#download-notification');
  const enable = document.querySelector('#enable-notifications');
  const test = document.querySelector('#test-notification');
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
          ? 'System notifications on for your downloads in this browser.'
          : 'System notifications off. Enable them to hear when your files arrive.';
    copy.textContent = 'System notifications for your downloads. Remembered in this browser; keep this page open.';
    toggle.checked = enabled;
    toggle.disabled = busy || !available;
    enable.hidden = !available;
    enable.disabled = busy;
    enable.textContent = enabled && permission === 'granted' ? 'Turn off notifications' : 'Enable notifications';
    test.hidden = !available;
    test.disabled = busy;
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
  enable.addEventListener('click', () => { void setEnabled(!enabled || notifications.permission() !== 'granted'); });
  test.addEventListener('click', async () => {
    if (!await setEnabled(true)) return;
    busy = true;
    render();
    try {
      await notifications.show('drop2 notifications are ready', {
        body: 'You will receive a system notification when your file is downloaded.',
        tag: 'drop2-notification-test', renotify: true,
      });
      feedback.textContent = 'Test sent to your system. No banner? Check notifications for Brave/your browser in system settings and turn off Focus or Do Not Disturb.';
    } catch {
      feedback.textContent = 'The browser could not show the test notification. Check site permissions and system notification settings, then try again.';
    } finally { busy = false; render(); }
  });
  document.querySelector('#send-form').addEventListener('reset', () => { queueMicrotask(render); });
  window.addEventListener('storage', event => {
    if (event.key === PREFERENCE_KEY) { enabled = event.newValue === 'true'; render(); }
  });
  history.setNotifications(enabled);
  render();
  return {
    enabled: () => enabled,
    render,
    failed() { feedback.textContent = 'A download notification could not be shown. Use “Test notification” to check your browser and system settings. Retrying automatically.'; },
  };
}

export function createSystemNotifications({ NotificationApi = globalThis.Notification, serviceWorker = globalThis.navigator?.serviceWorker } = {}) {
  let registration;
  async function activeRegistration() {
    registration ??= serviceWorker.register('/notification-worker.js').catch(error => {
      registration = null;
      throw error;
    });
    await registration;
    return serviceWorker.ready;
  }
  return {
    permission: () => NotificationApi?.permission ?? 'unsupported',
    async requestPermission() {
      if (!NotificationApi) return 'unsupported';
      if (NotificationApi.permission !== 'default') return NotificationApi.permission;
      return NotificationApi.requestPermission();
    },
    async show(title, options) {
      if (NotificationApi?.permission !== 'granted') throw new Error('Notification permission is required.');
      if (serviceWorker) {
        const active = await withTimeout(activeRegistration(), 10000);
        await withTimeout(active.showNotification(title, { ...options, requireInteraction: true }), 10000);
        return;
      }
      await withTimeout(new Promise((resolve, reject) => {
        const notification = new NotificationApi(title, options);
        notification.onshow = () => resolve();
        notification.onerror = () => reject(new Error('The browser could not show the notification.'));
        notification.onclick = () => { globalThis.window?.focus(); notification.close(); };
      }), 10000);
    },
  };
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The browser did not confirm the notification.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function showDownloadNotification(entry, notifications) {
  if (!entry.downloadedAt || !entry.notify || entry.notified || notifications.permission() !== 'granted') return false;
  await notifications.show('Your file was downloaded', {
    body: entry.name, tag: `drop2-download-${entry.id}`,
  });
  return true;
}

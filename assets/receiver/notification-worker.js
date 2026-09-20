self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(openDownloads());
});

async function openDownloads() {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const sender = tabs.find(tab => {
    const url = new URL(tab.url);
    return url.origin === self.location.origin && ['/', '/send'].includes(url.pathname);
  });
  if (sender) {
    await sender.focus();
    sender.postMessage({ type: 'show-downloads' });
  } else await self.clients.openWindow('/#downloads');
}

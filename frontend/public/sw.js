// Minimal service worker: only handles Web Push notifications for new
// leads. No offline caching -- keep it simple and avoid stale-content bugs.

self.addEventListener('push', (event) => {
  let data = { title: 'New lead', body: 'You have a new lead.', url: '/leads' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* keep defaults */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-512.jpg',
      badge: '/icon-512.jpg',
      data: { url: data.url || '/leads' },
      tag: `${data.url || '/leads'}-${Date.now()}`,
      renotify: true,
      // Auto-dismiss after a few seconds instead of sitting on screen until
      // manually closed -- requireInteraction was making these permanent.
      requireInteraction: false,
      vibrate: [300, 120, 300],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/leads';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

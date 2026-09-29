self.addEventListener('push', (event) => {
  const n = event.data ? event.data.json() : { title: 'my-day', body: '' };
  event.waitUntil(self.registration.showNotification(n.title, { body: n.body, tag: n.tag, data: { url: n.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(self.clients.openWindow(url));
});

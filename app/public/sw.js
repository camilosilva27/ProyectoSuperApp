// Service worker de notificaciones push web (recordatorio semanal, ver app/src/push/push.ts).
// Expo copia app/public/ tal cual a la raíz del build web, así que este archivo queda
// servible en /sw.js sin configuración adicional (mismo mecanismo que manifest.json).

self.addEventListener('push', event => {
  let datos = { title: 'Super App', body: '' };
  try {
    if (event.data) datos = { ...datos, ...event.data.json() };
  } catch {
    // payload no era JSON — se muestra igual con el título/cuerpo default de arriba.
  }

  event.waitUntil(
    self.registration.showNotification(datos.title, {
      body: datos.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});

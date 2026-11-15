/*
 * Service Worker מינימלי — ספידומטר
 * מטרה: לתקן את שגיאת ה-404 על הרישום הקיים ולאפשר התקנת PWA,
 * בלי שום caching אגרסיבי שעלול להגיש גרסה ישנה של האתר.
 * אין fetch handler בכוונה — כל בקשה עוברת ישירות לרשת.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      // ניקוי caches ישנים אם נשארו מגרסאות עבר
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) {}
      await self.clients.claim();
    })()
  );
});

/* ═══ התראות לטלפון של המנהל (15.11.2026) ═══
 * מגיעות מהפונקציה admin-push רק לטלפון שבו הופעלו התראות מתוך פאנל הניהול.
 * לגולשים רגילים זה לא עושה כלום: הם אף פעם לא נרשמים, ולכן לא מקבלים כלום.
 * עדיין אין כאן fetch handler — האתר ממשיך להיטען ישר מהרשת.
 */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { title: 'ספידומטר', body: event.data ? event.data.text() : '' };
  }
  var title = data.title || 'ספידומטר';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/sp-favicon-192.png',
    badge: '/sp-favicon-192.png',
    tag: data.tag || 'speedometer-admin',
    renotify: true,
    dir: 'rtl',
    lang: 'he',
    data: { url: data.url || '/#admin177' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/#admin177';
  event.waitUntil((async function () {
    var list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); } catch (e) {}
        try { c.postMessage({ type: 'sp-push-open', url: target }); } catch (e) {}
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

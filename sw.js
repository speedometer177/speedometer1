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

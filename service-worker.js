/* Hive Tracker PWA Service Worker
 * - Caches app shell for offline use
 * - Runtime caches CDN assets (e.g., jsdelivr)
 */
const CACHE_VERSION = "hive-tracker-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(APP_SHELL);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // App shell / same-origin: cache-first
  if (isSameOrigin(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // Only cache successful basic responses
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        // If navigation fails offline, fall back to cached index.html
        if (req.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })());
    return;
  }

  // Cross-origin (CDN): stale-while-revalidate
  // Helps keep JSZip available offline after first load.
  if (url.hostname.includes("cdn.jsdelivr.net")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req)
        .then((fresh) => {
          if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
          return fresh;
        })
        .catch(() => null);

      return cached || (await fetchPromise) || Response.error();
    })());
  }
});

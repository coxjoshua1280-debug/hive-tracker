/* BroodNote Service Worker (GitHub Pages-safe) */

// IMPORTANT: base path for GitHub Pages project site
const BASE = "/hive-tracker/";

const CACHE_NAME = "broodnote-v3-fix13";
const RUNTIME_CACHE = "broodnote-runtime-v1";
const TILE_CACHE = "broodnote-tiles-v1";

// Always cache absolute URLs under the correct scope
const ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
  BASE + "icons/icon-192x192.png",
  BASE + "icons/icon-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) =>
        [CACHE_NAME, RUNTIME_CACHE, TILE_CACHE].includes(k) ? Promise.resolve() : caches.delete(k)
      )
    );
    await self.clients.claim();
  })());
});

function isNavigationRequest(req) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}

function isTileUrl(url) {
  return /(^|\.)tile\./.test(url.hostname) || /openstreetmap\.org$/.test(url.hostname);
}

function isUnpkgOrCdn(url) {
  return url.hostname === "unpkg.com" || url.hostname.endsWith("jsdelivr.net");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Kill-switch: bypass SW completely
  if (url.searchParams.get("nosw") === "1") {
    event.respondWith(fetch(req));
    return;
  }

  // Only handle requests within our scope (prevents odd cross-scope behavior)
  if (url.origin === self.location.origin && !url.pathname.startsWith(BASE)) {
    return;
  }

  // Navigation: network-first, fallback to cached shell
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        // Cache the canonical shell URL (not a relative string)
        cache.put(new Request(BASE + "index.html"), fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match(new Request(BASE + "index.html"));
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Same-origin assets inside BASE: cache-first, update in background
  if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch (_) {
        return cached || new Response("", { status: 504 });
      }
    })());
    return;
  }

  // Map tiles: stale-while-revalidate into TILE_CACHE
  if (isTileUrl(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return cached || (await fetchPromise) || new Response("", { status: 504 });
    })());
    return;
  }

  // CDN libs: stale-while-revalidate into RUNTIME_CACHE
  if (isUnpkgOrCdn(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      return cached || (await fetchPromise) || new Response("", { status: 504 });
    })());
    return;
  }
});

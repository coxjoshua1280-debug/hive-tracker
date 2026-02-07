/* BroodNote Service Worker */
const CACHE_NAME = "broodnote-v3-fix12c";
const RUNTIME_CACHE = "broodnote-runtime-v1";
const TILE_CACHE = "broodnote-tiles-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (
      [CACHE_NAME, RUNTIME_CACHE, TILE_CACHE].includes(k) ? null : caches.delete(k)
    )));
    await self.clients.claim();
  })());
});

function isNavigationRequest(req){
  return req.mode === "navigate" ||
    (req.headers.get("accept")?.includes("text/html"));
}

function isTileUrl(url){
  return /(^|\.)tile\./.test(url.hostname) || /openstreetmap\.org$/.test(url.hostname);
}

function isUnpkgOrCdn(url){
  return url.hostname === "unpkg.com" || url.hostname.endsWith("jsdelivr.net");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Kill-switch: if ?nosw=1 is present, bypass the service worker entirely
  if (url.searchParams && url.searchParams.get("nosw") === "1") {
    event.respondWith(fetch(req));
    return;
  }

  // Navigation: network-first with offline fallback to cached shell
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match("./index.html");
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Same-origin assets: cache-first, then network (and update cache)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try{
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      }catch{
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
        // cache opaque/cors responses too
        cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);

      return cached || (await fetchPromise) || new Response("", { status: 504 });
    })());
    return;
  }

  // CDN libs (Leaflet): stale-while-revalidate into RUNTIME_CACHE
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

  // Default: try cache then network (best-effort)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try{
      return await fetch(req);
    }catch{
      return new Response("", { status: 504 });
    }
  })());
});

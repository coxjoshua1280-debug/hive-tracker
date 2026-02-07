/* BroodNote Service Worker (GitHub Pages-safe + resilient install) */

// DEPLOYMENT CONFIG: Update this BASE path to match your deployment location
// Examples:
//   GitHub Pages subdirectory: "/hive-tracker/"
//   Root domain: "/"
//   Custom subdirectory: "/your-path/"
const BASE = "/hive-tracker/";

const CACHE_NAME = "broodnote-v3-fix15";  // Bumped version for the fixes
const RUNTIME_CACHE = "broodnote-runtime-v1";
const TILE_CACHE = "broodnote-tiles-v1";

const ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
  // Fixed: Using actual icon filenames that exist in your /icons/ folder
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
];

// Cache assets individually so one missing file doesn't nuke the whole install
async function precacheSafely(cache, urls) {
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, { cache: "reload" });
        if (!res.ok) throw new Error(`precache ${u} -> ${res.status}`);
        await cache.put(u, res);
      } catch (err) {
        // Don't fail install because one optional asset is missing
        // (icons are the usual culprit)
        // eslint-disable-next-line no-console
        console.warn("[SW] Skipping precache:", u, err?.message || err);
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precacheSafely(cache, ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) =>
        [CACHE_NAME, RUNTIME_CACHE, TILE_CACHE].includes(k)
          ? Promise.resolve()
          : caches.delete(k)
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

  // Only handle our own scope for same-origin requests
  if (url.origin === self.location.origin && !url.pathname.startsWith(BASE)) {
    return;
  }

  // NAVIGATION: network-first, fallback to cached shell
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        // Added error handling for cache.put
        try {
          await cache.put(BASE + "index.html", fresh.clone());
        } catch (e) {
          console.warn("[SW] Cache put failed:", e);
        }
        return fresh;
      } catch {
        const cached = await caches.match(BASE + "index.html");
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Same-origin assets inside BASE: cache-first
  if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        // Added error handling for cache.put
        try {
          await cache.put(req, res.clone());
        } catch (e) {
          console.warn("[SW] Cache put failed:", e);
        }
        return res;
      } catch {
        return new Response("", { status: 504 });
      }
    })());
    return;
  }

  // Map tiles: stale-while-revalidate
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

  // CDN libs: stale-while-revalidate
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

  // Default: just go to network (don't leave request hanging)
  event.respondWith(fetch(req));
});

// FL Clock service worker. Deliberately minimal: it exists so the app is
// installable. The only things it ever caches are the app icons (/icons/*)
// and /manifest.json, which are public, static files. Every other request
// (pages, /_next/*, /api/*, Supabase, anything cross-origin) is not touched:
// the handler returns without calling respondWith, so the browser does a
// normal network fetch and nothing is stored.
//
// Caching is skipped entirely on localhost.

const CACHE = "fl-static-v3";
const CACHE_STATIC =
  self.location.hostname !== "localhost" &&
  self.location.hostname !== "127.0.0.1";

function isCacheable(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json")
  );
}

self.addEventListener("install", () => self.skipWaiting());

// Drops any older cache (v1 also held /_next/static chunks; v3 = renamed
// -v2 icons).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!CACHE_STATIC || request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isCacheable(url)) return; // network only

  // Network first, so manifest/icon changes show up; the cached copy is
  // only a fallback when offline.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        // Only cache a real file, never a redirect (e.g. to /login).
        if (response.ok && !response.redirected) cache.put(request, response.clone());
        return response;
      } catch (err) {
        const hit = await cache.match(request);
        if (hit) return hit;
        throw err;
      }
    })
  );
});

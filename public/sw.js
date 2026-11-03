// The service worker for the installed app. Registered by
// src/components/pwa/service-worker.tsx, in production only.
//
// It caches nothing but the offline page. Every page here is behind a sign-in
// and holds members' money, so a stale copy is worse than none, and nothing of
// it should be left on a phone. All it does is answer a page load that fails
// for want of a network with a page that says so, instead of the browser's
// own error, which in an installed app has no address bar to retry from.
//
// To remove it from every device: replace this file with one whose install
// handler calls `self.registration.unregister()`. Browsers check this file
// for changes on every page load (it is served no-cache, next.config.ts).

const CACHE = "offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // An older version's cache, if the name above has changed.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // Lets the page request start while this worker is still waking up,
      // so passing every page load through here costs no time.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Page loads only. Scripts, images, API calls and form posts go straight to
  // the network as if this worker were not here.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return (await caches.match(OFFLINE)) || Response.error();
      }
    })(),
  );
});

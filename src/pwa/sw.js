const CACHE_NAME = "nexus-shell-__NEXUS_CACHE_VERSION__";
const CACHE_PREFIX = "nexus-shell-";
const SHELL_URLS = __NEXUS_SHELL_URLS__;
const CACHEABLE_DESTINATIONS = new Set(["font", "image", "manifest", "script", "style"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            return;
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();

      await Promise.all(
        cacheKeys
          .filter((cacheKey) => cacheKey.startsWith(CACHE_PREFIX) && cacheKey !== CACHE_NAME)
          .map((cacheKey) => caches.delete(cacheKey)),
      );
    })(),
  );
});

function isCacheableAssetRequest(request, url) {
  if (request.method !== "GET") {
    return false;
  }

  if (url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") {
    return false;
  }

  return CACHEABLE_DESTINATIONS.has(request.destination) || url.pathname === "/manifest.webmanifest";
}

async function cacheSuccessfulResponse(cache, request, response) {
  if (!response || !response.ok || response.type !== "basic") {
    return response;
  }

  await cache.put(request, response.clone());
  return response;
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    return await cacheSuccessfulResponse(cache, request, networkResponse);
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => cacheSuccessfulResponse(cache, request, response))
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  return networkResponse ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (!isCacheableAssetRequest(request, url)) {
    return;
  }

  event.respondWith(handleAsset(request));
});

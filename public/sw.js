const SHELL_CACHE_PREFIX = "shoreline-watch-shell-";
const SHELL_CACHE_NAME = "shoreline-watch-shell-v41";
const OFFLINE_DATA_CACHE = "shoreline-watch-offline-data-v1";
const DURABLE_ASSETS = [
  "/data/croatia-coastline.json",
  "/data/croatia-map-features.json",
  "/audio/shoreline-alarm.wav",
];
const CORE = [
  "/",
  "/manifest.webmanifest",
  "/manifest.webmanifest?v=20",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  ...DURABLE_ASSETS,
];
const TEXT_CONTENT_TYPES = ["text/html", "text/css", "text/javascript", "application/javascript"];

function requestUrl(path) {
  return new URL(path, self.location.origin).href;
}

async function cacheResource(cache, path, refresh) {
  const cached = await cache.match(path);
  if (cached && !refresh) return cached;

  try {
    const response = await fetch(new Request(requestUrl(path), { cache: "reload" }));
    if (!response.ok) throw new Error(`Could not cache ${path}`);
    await cache.put(path, response.clone());
    return response;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

function discoverShellAssets(source, baseUrl) {
  const discovered = new Set();
  const patterns = [
    /(?:src|href)\s*=\s*["']([^"'<>]+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /["'`](\/(?:assets|_next\/static)\/[^"'`\\\s)]+)["'`]/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      try {
        const url = new URL(match[1], baseUrl);
        if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) continue;
        if (!url.pathname.startsWith("/assets/")
          && !url.pathname.startsWith("/_next/static/")
          && !/\.(?:css|js|mjs|woff2?|png|svg|webp|avif)$/i.test(url.pathname)) continue;
        discovered.add(`${url.pathname}${url.search}`);
      } catch {
        // Ignore malformed references in generated bundles.
      }
    }
  }
  return discovered;
}

async function cacheShellAsset(cache, path, refresh, enqueue) {
  const response = await cacheResource(cache, path, refresh);
  const contentType = response.headers.get("content-type") ?? "";
  if (!TEXT_CONTENT_TYPES.some((type) => contentType.includes(type))) return;
  const source = await response.clone().text();
  for (const asset of discoverShellAssets(source, requestUrl(path))) enqueue(asset);
}

async function warmShell(refresh) {
  const cache = await caches.open(SHELL_CACHE_NAME);
  const queue = CORE.filter((path) => !DURABLE_ASSETS.includes(path));
  const seen = new Set(queue);
  let nextIndex = 0;
  const enqueue = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    queue.push(path);
  };

  await Promise.all(Array.from({ length: 6 }, async () => {
    while (nextIndex < queue.length) {
      const path = queue[nextIndex];
      nextIndex += 1;
      await cacheShellAsset(cache, path, refresh, enqueue);
    }
  }));
}

async function warmDurableAssets(refresh) {
  const cache = await caches.open(OFFLINE_DATA_CACHE);
  await Promise.all(DURABLE_ASSETS.map((path) => cacheResource(cache, path, refresh)));
}

async function warmOfflineBase(refresh) {
  await Promise.all([warmDurableAssets(refresh), warmShell(refresh)]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmOfflineBase(true).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "WARM_OFFLINE_BASE") event.waitUntil(warmOfflineBase(false));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL_CACHE_NAME)
        .then((cache) => cache.match(event.request, { ignoreSearch: true })
          .then(async (cached) => cached || (await cache.match("/")) || fetch(event.request))),
    );
    return;
  }

  if (url.origin === self.location.origin && DURABLE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(OFFLINE_DATA_CACHE)
        .then((cache) => cache.match(url.pathname)
          .then((cached) => cached || fetch(event.request).then((response) => {
            if (response.ok) void cache.put(url.pathname, response.clone());
            return response;
          }))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          void caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      });
    }),
  );
});

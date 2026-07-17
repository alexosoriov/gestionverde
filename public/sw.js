const APP_CACHE = "santuario-route-v16";
const MAP_CACHE = "santuario-map-tiles-v1";
const MAX_MAP_TILES = 450;
const CORE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/logo-ruta-verde.png",
  "/offline-map-tile.svg",
];

const MAP_TILE_HOSTS = new Set([
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
  "server.arcgisonline.com",
]);

function isMapTile(url) {
  if (!MAP_TILE_HOSTS.has(url.hostname)) return false;
  if (url.hostname.endsWith("tile.openstreetmap.org")) return /\/\d+\/\d+\/\d+\.png$/u.test(url.pathname);
  return /\/tile\/\d+\/\d+\/\d+$/u.test(url.pathname);
}

async function cacheResponse(request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(APP_CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function trimMapCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_MAP_TILES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}

async function fetchAndCacheMapTile(request, cache) {
  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    await trimMapCache(cache);
  }
  return response;
}

async function mapTileFirst(request, event) {
  const cache = await caches.open(MAP_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    event.waitUntil(fetchAndCacheMapTile(request, cache).catch(() => undefined));
    return cached;
  }
  try {
    return await fetchAndCacheMapTile(request, cache);
  } catch {
    return (await caches.match("/offline-map-tile.svg")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return cacheResponse(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    return (await caches.match(request)) || (await caches.match("/"));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== APP_CACHE && key !== MAP_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Nunca guardar sesiones, coordenadas, actividad ni el recorrido descifrado.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Solo se guardan pasivamente las teselas que el usuario realmente visualizó.
  // No se realiza descarga masiva ni precarga del proveedor cartográfico.
  if (isMapTile(url)) {
    event.respondWith(mapTileFirst(request, event));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request).catch(() => networkFirst(request)));
});

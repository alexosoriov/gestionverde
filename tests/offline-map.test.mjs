import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the service worker retains viewed map tiles and has a local fallback", async () => {
  const [worker, fallback] = await Promise.all([
    text("public/sw.js"),
    text("public/offline-map-tile.svg"),
  ]);

  assert.match(worker, /const MAP_CACHE = "santuario-map-tiles-v1"/);
  assert.match(worker, /MAX_MAP_TILES = 450/);
  assert.match(worker, /tile\.openstreetmap\.org/);
  assert.match(worker, /server\.arcgisonline\.com/);
  assert.match(worker, /response\.type === "opaque"/);
  assert.match(worker, /cache\.put\(request, response\.clone\(\)\)/);
  assert.match(worker, /caches\.match\("\/offline-map-tile\.svg"\)/);
  assert.match(worker, /key !== APP_CACHE && key !== MAP_CACHE/);
  assert.match(worker, /No se realiza descarga masiva ni precarga/);

  assert.match(fallback, /MAPA OFFLINE/);
  assert.match(fallback, /Ruta y viviendas disponibles/);
});

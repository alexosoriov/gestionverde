import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el mapa respeta zoom y desplazamiento manual durante el GPS", async () => {
  const source = await read("app/live-map.tsx");

  assert.match(source, /stopFollowingForManualMapUse/u);
  assert.match(source, /addEventListener\("pointerdown"/u);
  assert.match(source, /addEventListener\("touchstart"/u);
  assert.match(source, /addEventListener\("wheel"/u);
  assert.match(source, /Vista libre/u);
  assert.match(source, /innerBounds\.contains\(point\)/u);
  assert.match(source, /map\.panTo\(point/u);
  assert.doesNotMatch(
    source,
    /if \(followRef\.current\) map\.setView\(point, Math\.max\(map\.getZoom\(\), 17\)/u,
  );
});

test("el GPS filtra ruido estacionario y evita giros falsos", async () => {
  const source = await read("app/live-map.tsx");

  assert.match(source, /MIN_RECORDED_STEP_METERS = 5/u);
  assert.match(source, /MIN_HEADING_STEP_METERS = 8/u);
  assert.match(source, /accuracy \* 0\.45/u);
  assert.match(source, /canUpdateHeading/u);
  assert.match(source, /smoothHeading/u);
  assert.match(source, /GPS estabilizado/u);
});

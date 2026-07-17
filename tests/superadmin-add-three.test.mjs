import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el actualizador conserva 41 viviendas y agrega 3 para llegar a 44", async () => {
  const source = await read("app/superadmin-route-manager.tsx");

  assert.match(source, /EXPECTED_CURRENT_TOTAL = 41/u);
  assert.match(source, /EXPECTED_ADDITIONS = 3/u);
  assert.match(source, /TARGET_TOTAL = 44/u);
  assert.match(source, /currentStops\.map\(\(stop\) => \(\{ \.\.\.stop \}\)\)/u);
  assert.match(source, /insertAtBestPosition/u);
  assert.match(source, /body: JSON\.stringify\(\{ version: 1, stops: preview\.merged \}\)/u);
  assert.match(source, /Conservar 41 y activar 44 viviendas/u);
  assert.doesNotMatch(source, /Activar 39 viviendas/u);
});

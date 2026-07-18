import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el Worker usa exclusivamente los controladores JSON limpios", async () => {
  const source = await read("worker/index.ts");
  assert.match(source, /clean-operational-data/u);
  assert.match(source, /handleCleanTracking/u);
  assert.match(source, /handleCleanJourney/u);
  assert.match(source, /handleCleanRoute/u);
  assert.doesNotMatch(source, /migrateLegacyOperationalData/u);
  assert.doesNotMatch(source, /legacy-data-migration/u);
  assert.doesNotMatch(source, /ROUTE_DATA_KEY/u);
});

test("el navegador no ejecuta migraciones AES al iniciar", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /loadCleanRoute/u);
  assert.match(page, /\/api\/route/u);
  assert.doesNotMatch(page, /migrateLegacyBrowserStorage/u);
  assert.doesNotMatch(page, /local-security-migration/u);
  assert.doesNotMatch(page, /private-route/u);
});

test("el entorno de ejemplo ya no solicita una clave de cifrado de ruta", async () => {
  const environment = await read(".env.example");
  assert.match(environment, /ROUTE_SESSION_SECRET/u);
  assert.doesNotMatch(environment, /ROUTE_DATA_KEY/u);
  assert.doesNotMatch(environment, /AES/u);
});

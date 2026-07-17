import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la migración D1 selecciona únicamente registros antiguos sin cifrar", async () => {
  const source = await read("worker/legacy-data-migration.ts");
  assert.match(source, /json_valid\(payload\) = 1/u);
  assert.match(source, /json_extract\(payload, '\$\.v'\)/u);
  assert.match(source, /secure_payload IS NULL/u);
  assert.match(source, /encryptJson\(parsed, keyBase64, "journey-state", id\)/u);
  assert.match(source, /encryptJson\(tracking, keyBase64, "live-tracking", id\)/u);
  assert.match(source, /lat=0, lng=0/u);
  assert.match(source, /activity_json='\[\]'/u);
});

test("el Worker ejecuta la migración tras autenticar", async () => {
  const source = await read("worker/index.ts");
  assert.match(source, /migrateLegacyOperationalData/u);
  assert.match(source, /ctx\.waitUntil\(migrateLegacyOperationalData/u);
  assert.match(source, /requireSession/u);
});

test("el navegador migra y elimina respaldos legibles sin pisar los nuevos", async () => {
  const migration = await read("app/local-security-migration.ts");
  const page = await read("app/page.tsx");
  assert.match(migration, /ruta-verde-journey-backup:/u);
  assert.match(migration, /secure-outbox:/u);
  assert.match(migration, /if \(localStorage\.getItem\(targetKey\)\) return/u);
  assert.match(migration, /localStorage\.removeItem\(sourceKey\)/u);
  assert.match(migration, /localStorage\.removeItem\(LEGACY_KEY\)/u);
  assert.match(page, /migrateLegacyBrowserStorage/u);
});

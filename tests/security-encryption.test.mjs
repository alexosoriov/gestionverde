import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el código público deja vacío el conjunto de paradas hasta autenticar", async () => {
  const routeData = await read("app/route-data.ts");
  assert.match(routeData, /export let STOPS: Stop\[\] = \[\]/u);
  assert.match(routeData, /Los registros reales se cargan después de autenticar/u);
  assert.doesNotMatch(routeData, /name:\s*["'][^"']+["']\s*,\s*address:/u);
});

test("el bloque privado vive separado y exige AES-256-GCM autenticado", async () => {
  const bridge = await read("worker/private-route-data.ts");
  const encrypted = await read("worker/vault/sector-map.ts");

  assert.match(bridge, /\.\/vault\/sector-map/u);
  assert.doesNotMatch(bridge, /PRIVATE_ROUTE_CIPHERTEXT_B64/u);
  assert.match(encrypted, /AES-GCM/u);
  assert.match(encrypted, /rawKey\.byteLength !== 32/u);
  assert.match(encrypted, /tagLength: 128/u);
  assert.match(encrypted, /additionalData/u);
  assert.match(encrypted, /PRIVATE_ROUTE_CIPHERTEXT_B64/u);
  assert.doesNotMatch(encrypted, /\{\s*id:\s*["']\d+/u);
});

test("jornadas y seguimiento usan subclaves e IV aleatorio por registro", async () => {
  const cryptoSource = await read("worker/data-crypto.ts");
  const journeySource = await read("worker/journey-state.ts");
  const trackingSource = await read("worker/live-tracking.ts");

  assert.match(cryptoSource, /HKDF/u);
  assert.match(cryptoSource, /AES-GCM/u);
  assert.match(cryptoSource, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/u);
  assert.match(cryptoSource, /additionalData/u);
  assert.match(cryptoSource, /tagLength: 128/u);
  assert.match(journeySource, /encryptJson/u);
  assert.match(journeySource, /decryptJson/u);
  assert.match(trackingSource, /secure_payload/u);
  assert.match(trackingSource, /lat=0, lng=0/u);
  assert.match(trackingSource, /activity_json='\[\]'/u);
});

test("IndexedDB y respaldos locales están cifrados con clave no extraíble", async () => {
  const database = await read("app/journey-db.ts");
  const storage = await read("app/journey-storage.ts");

  assert.match(database, /AES-GCM/u);
  assert.match(database, /length: 256/u);
  assert.match(database, /false,\s*\["encrypt", "decrypt"\]/u);
  assert.match(database, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/u);
  assert.match(database, /writeSecureStored/u);
  assert.match(storage, /sealLocalValue/u);
  assert.match(storage, /readSecureStored/u);
  assert.match(storage, /localStorage\.removeItem\(LEGACY_KEY\)/u);
  assert.doesNotMatch(storage, /localStorage\.setItem\([^,]+,\s*JSON\.stringify\(snapshot\)\)/u);
});

test("las APIs privadas requieren sesión y clave de datos", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /\/api\/private-route/u);
  assert.match(worker, /\/api\/tracking/u);
  assert.match(worker, /\/api\/journey-state/u);
  assert.match(worker, /\/api\/road-route/u);
  assert.match(worker, /requireSession/u);
  assert.match(worker, /ROUTE_DATA_KEY/u);
  assert.match(worker, /Strict-Transport-Security/u);
  assert.match(worker, /Content-Security-Policy/u);
  assert.match(worker, /X-Frame-Options/u);
});

test("el acceso tiene bloqueo progresivo y no revela el usuario", async () => {
  const auth = await read("worker/auth.ts");
  const page = await read("app/page.tsx");

  assert.match(auth, /MAX_LOGIN_FAILURES = 5/u);
  assert.match(auth, /auth_rate_limit/u);
  assert.match(auth, /Retry-After/u);
  assert.match(auth, /__Host-rv_session/u);
  assert.match(auth, /SameSite=Strict/u);
  assert.match(page, /useState\(""\)/u);
  assert.doesNotMatch(page, /useState\("rutaverde"\)/u);
});

test("el navegador no guarda respuestas privadas en el caché offline", async () => {
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(serviceWorker, /event\.respondWith\(fetch\(request\)\)/u);
});

test("la aplicación carga los datos solo después de iniciar sesión", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /\/api\/session/u);
  assert.match(page, /\/api\/private-route/u);
  assert.match(page, /installRouteData/u);
  assert.match(page, /type="password"/u);
});

test("la separación de la bóveda no cambia el mapa ni su fuente de datos", async () => {
  const worker = await read("worker/index.ts");
  const routeApp = await read("app/route-app.tsx");

  assert.match(worker, /decryptPrivateRoute\(env\.ROUTE_DATA_KEY\)/u);
  assert.match(worker, /return noStoreJson\(\{ stops \}\)/u);
  assert.match(routeApp, /STOPS/u);
});

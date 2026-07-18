import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("el repositorio público usa una ruta demo sin teléfonos ni nombres reales", async () => {
  const routeData = await read("app/route-data.ts");
  const demoStops = await read("app/route-stops.ts");
  assert.match(routeData, /export let STOPS: Stop\[\] = \[\]/u);
  assert.match(demoStops, /Array\.from\(\{ length: 44 \}/u);
  assert.match(demoStops, /Datos de demostración/u);
  assert.doesNotMatch(demoStops, /\+?56\s*9\s*\d{4}\s*\d{4}/u);
  assert.doesNotMatch(demoStops, /phone|telefono|teléfono/iu);
});

test("el Worker activo no depende de AES, vault ni ROUTE_DATA_KEY", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /clean-operational-data/u);
  assert.doesNotMatch(worker, /ROUTE_DATA_KEY/u);
  assert.doesNotMatch(worker, /decryptPrivateRoute/u);
  assert.doesNotMatch(worker, /private-route-data/u);
  assert.doesNotMatch(worker, /\/api\/private-route/u);
});

test("las jornadas, rutas y seguimiento se guardan como JSON operativo", async () => {
  const cleanData = await read("worker/clean-operational-data.ts");
  assert.match(cleanData, /gestionverde_routes/u);
  assert.match(cleanData, /gestionverde_tracking/u);
  assert.match(cleanData, /gestionverde_journeys/u);
  assert.match(cleanData, /gestionverde_diagnostics/u);
  assert.match(cleanData, /JSON\.stringify/u);
  assert.match(cleanData, /JSON\.parse/u);
  assert.doesNotMatch(cleanData, /AES-GCM|HKDF|secure_payload/iu);
});

test("el almacenamiento del teléfono conserva estados, fotos e historial sin vault", async () => {
  const storage = await read("app/gestionverde-storage.ts");
  assert.match(storage, /gestionverde:journey:v1/u);
  assert.match(storage, /gestionverde:history:v1/u);
  assert.match(storage, /StopPhoto/u);
  assert.match(storage, /localStorage\.setItem/u);
  assert.match(storage, /JSON\.stringify/u);
  assert.doesNotMatch(storage, /AES-GCM|ROUTE_DATA_KEY|vault/iu);
});

test("las APIs operativas exigen sesión y mantienen cabeceras de seguridad", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /\/api\/route/u);
  assert.match(worker, /\/api\/tracking/u);
  assert.match(worker, /\/api\/journey-state/u);
  assert.match(worker, /\/api\/road-route/u);
  assert.match(worker, /\/api\/diagnostics/u);
  assert.match(worker, /requireSession/u);
  assert.match(worker, /Strict-Transport-Security/u);
  assert.match(worker, /Content-Security-Policy/u);
  assert.match(worker, /X-Frame-Options/u);
  assert.match(worker, /camera=\(self\)/u);
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

test("el navegador no guarda respuestas de API en el caché offline", async () => {
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/u);
  assert.match(serviceWorker, /event\.respondWith\(fetch\(request\)\)/u);
});

test("la aplicación carga la ruta JSON limpia después de validar la sesión", async () => {
  const page = await read("app/page.tsx");
  assert.match(page, /\/api\/session/u);
  assert.match(page, /\/api\/route/u);
  assert.match(page, /loadCleanRoute/u);
  assert.match(page, /installRouteData\(await loadCleanRoute\(\)\)/u);
  assert.match(page, /ROUTE_STOPS/u);
  assert.match(page, /type="password"/u);
  assert.doesNotMatch(page, /\/api\/private-route/u);
  assert.doesNotMatch(page, /descifrando el recorrido/u);
  assert.doesNotMatch(page, /local-security-migration/u);
});

test("el mapa muestra ruta azul, camión, GPS y viviendas por estado", async () => {
  const map = await read("app/gestionverde-map.tsx");
  assert.match(map, /color: "#1f7aff"/u);
  assert.match(map, /truckIcon/u);
  assert.match(map, /watchPosition/u);
  assert.match(map, /ARRIVAL_METERS = 35/u);
  assert.match(map, /status = records\[stop\.id\]\?\.status/u);
  assert.match(map, /seguir camión/iu);
});

test("el modo operador incluye jornada, voz, fotos, estados y reportes", async () => {
  const app = await read("app/gestionverde-app.tsx");
  assert.match(app, /Iniciar recorrido/u);
  assert.match(app, /Pausar jornada/u);
  assert.match(app, /Finalizar jornada/u);
  assert.match(app, /SpeechSynthesisUtterance/u);
  assert.match(app, /Tomar o agregar foto/u);
  assert.match(app, /Retiro realizado/u);
  assert.match(app, /marcar ausente/u);
  assert.match(app, /Descargar CSV/u);
  assert.match(app, /guardar PDF/iu);
});

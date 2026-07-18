import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la autenticación mantiene tres roles y secretos separados", async () => {
  const auth = await read("worker/auth.ts");
  assert.match(auth, /"driver" \| "manager" \| "superadmin"/u);
  assert.match(auth, /JEFATURA_USERNAME/u);
  assert.match(auth, /JEFATURA_PASSWORD/u);
  assert.match(auth, /SUPERADMIN_USERNAME/u);
  assert.match(auth, /SUPERADMIN_PASSWORD/u);
  assert.doesNotMatch(auth, /jefatura\.rutaverde/u);
  assert.doesNotMatch(auth, /alex\.superadmin/u);
});

test("las sesiones usan firma, cookie protegida y bloqueo persistente", async () => {
  const auth = await read("worker/auth.ts");
  assert.match(auth, /HMAC/u);
  assert.match(auth, /SHA-256/u);
  assert.match(auth, /constantTimeEqual/u);
  assert.match(auth, /__Host-rv_session/u);
  assert.match(auth, /HttpOnly/u);
  assert.match(auth, /SameSite=Strict/u);
  assert.match(auth, /Priority=High/u);
  assert.match(auth, /MAX_LOGIN_FAILURES = 5/u);
  assert.match(auth, /auth_rate_limit/u);
  assert.match(auth, /Retry-After/u);
});

test("las API aplican permisos distintos según el rol", async () => {
  const auth = await read("worker/auth.ts");
  const worker = await read("worker/index.ts");
  assert.match(auth, /pathname === "\/api\/tracking"/u);
  assert.match(auth, /role === "manager"/u);
  assert.match(auth, /request\.method === "POST" && role === "driver"/u);
  assert.match(auth, /pathname === "\/api\/journey-state"/u);
  assert.match(worker, /session\?\.role !== "superadmin"/u);
  assert.match(worker, /status: 403/u);
});

test("la interfaz carga una aplicación distinta para cada rol", async () => {
  const page = await read("app/page.tsx");
  const driver = await read("app/driver-app.tsx");
  const manager = await read("app/manager-only-app.tsx");
  const superadmin = await read("app/superadmin-app.tsx");

  assert.match(page, /import\("\.\/manager-only-app"\)/u);
  assert.match(page, /import\("\.\/driver-app"\)/u);
  assert.match(page, /import\("\.\/superadmin-app"\)/u);
  assert.match(driver, /GestionVerdeApp role="driver"/u);
  assert.match(manager, /GestionVerdeApp role="manager"/u);
  assert.match(superadmin, /GestionVerdeApp role="superadmin"/u);
});

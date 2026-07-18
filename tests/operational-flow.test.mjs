import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return { results: [], success: true, meta: {} };
  }

  async first() {
    if (this.sql.includes("SELECT payload, updated_at FROM gestionverde_tracking")) {
      return this.database.tracking.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT payload, client_updated_at, server_updated_at") && this.sql.includes("gestionverde_journeys")) {
      return this.database.journeys.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT client_updated_at FROM gestionverde_journeys")) {
      const row = this.database.journeys.get(this.values[0]);
      return row ? { client_updated_at: row.client_updated_at } : null;
    }
    if (this.sql.includes("SELECT blocked_until FROM auth_rate_limit")) {
      const row = this.database.rateLimits.get(this.values[0]);
      return row ? { blocked_until: row.blocked_until } : null;
    }
    if (this.sql.includes("SELECT attempts, window_started FROM auth_rate_limit")) {
      const row = this.database.rateLimits.get(this.values[0]);
      return row ? { attempts: row.attempts, window_started: row.window_started } : null;
    }
    return null;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO gestionverde_tracking")) {
      this.database.tracking.set(this.values[0], {
        payload: this.values[1],
        updated_at: this.values[2],
      });
    } else if (this.sql.startsWith("INSERT INTO gestionverde_journeys")) {
      this.database.journeys.set(this.values[0], {
        payload: this.values[1],
        client_updated_at: this.values[2],
        server_updated_at: this.values[3],
      });
    } else if (this.sql.startsWith("INSERT INTO auth_rate_limit")) {
      this.database.rateLimits.set(this.values[0], {
        attempts: this.values[1],
        window_started: this.values[2],
        blocked_until: this.values[3],
        updated_at: this.values[4],
      });
    } else if (this.sql.startsWith("DELETE FROM auth_rate_limit")) {
      this.database.rateLimits.delete(this.values[0]);
    }
    return { success: true, meta: {} };
  }
}

class FakeD1 {
  constructor() {
    this.tracking = new Map();
    this.journeys = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("operational-clean-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function environment(database) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: "driver-user",
    ROUTE_PASSWORD: "driver-password",
    JEFATURA_USERNAME: "manager-user",
    JEFATURA_PASSWORD: "manager-password",
    SUPERADMIN_USERNAME: "admin-user",
    SUPERADMIN_PASSWORD: "admin-password",
    ROUTE_SESSION_SECRET: "test-session-secret-with-enough-entropy",
  };
}

const context = { waitUntil() {}, passThroughOnException() {} };

async function loginCookie(worker, env, username = env.ROUTE_USERNAME, password = env.ROUTE_PASSWORD, ip = "127.0.0.1") {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ username, password }),
  }), env, context);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

function authorizedRequest(url, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return new Request(url, { ...init, headers });
}

test("tracking se guarda como JSON limpio y Jefatura puede leerlo", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD, "192.0.2.1");
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD, "192.0.2.2");
  const activity = [{ id: "03-1000", stopId: "03", label: "Punto sintético", status: "done", at: 1_000, kilos: 8.5 }];

  const post = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat: -33.45,
      lng: -70.66,
      speed: 2.2,
      heading: 91,
      accuracy: 8,
      nextStop: "Punto sintético siguiente",
      done: 1,
      absent: 1,
      pending: 39,
      total: 41,
      kilos: 8.5,
      actualKm: 1.35,
      estimatedMinutes: 88,
      startedAt: 900,
      activity,
      status: "active",
    }),
  }), env, context);
  assert.equal(post.status, 200);

  const stored = database.tracking.get("current");
  assert.ok(stored);
  assert.match(stored.payload, /Punto sintético siguiente/u);
  assert.match(stored.payload, /-33\.45/u);
  assert.doesNotMatch(stored.payload, /secure_payload|AES-GCM|"v":2/u);

  const driverRead = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie), env, context);
  assert.equal(driverRead.status, 403);

  const get = await worker.fetch(authorizedRequest("http://localhost/api/tracking", managerCookie), env, context);
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.equal(data.tracking.done, 1);
  assert.equal(data.tracking.absent, 1);
  assert.equal(data.tracking.pending, 39);
  assert.equal(data.tracking.lat, -33.45);
  assert.equal(data.tracking.actual_km, 1.35);
  assert.deepEqual(JSON.parse(data.tracking.activity_json), activity);

  const managerWrite = await worker.fetch(authorizedRequest("http://localhost/api/tracking", managerCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: -33.4, lng: -70.6 }),
  }), env, context);
  assert.equal(managerWrite.status, 403);
});

test("tracking rechaza coordenadas imposibles", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const driverCookie = await loginCookie(worker, env);
  const response = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 120, lng: -70 }),
  }), env, context);
  assert.equal(response.status, 400);
});

test("la jornada se guarda en D1 como JSON y se recupera correctamente", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env);
  const snapshot = {
    version: 1,
    routeId: "santuario-2026-07-16",
    phase: "active",
    records: {
      "01": {
        status: "done",
        note: "Nota sintética",
        material: "Orgánico",
        kilos: "4,5",
        photos: [],
        visitedAt: 2_000,
      },
    },
    startedAt: 1_000,
    finishedAt: null,
    pausedAt: null,
    pausedMs: 0,
    position: { lat: -33.4, lng: -70.6, accuracy: 5, speedKmh: 0, heading: 0, actualKm: 0.8, updatedAt: 2_000 },
    voiceEnabled: true,
    updatedAt: 2_000,
  };

  const post = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: snapshot.routeId, snapshot, clientUpdatedAt: snapshot.updatedAt }),
  }), env, context);
  assert.equal(post.status, 200);

  const stored = database.journeys.get(snapshot.routeId);
  assert.ok(stored);
  assert.match(stored.payload, /Nota sintética/u);
  assert.match(stored.payload, /-33\.4/u);
  assert.doesNotMatch(stored.payload, /secure_payload|AES-GCM|"v":2/u);

  const get = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journeyId=${snapshot.routeId}`, driverCookie),
    env,
    context,
  );
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.equal(data.snapshot.position.actualKm, 0.8);
  assert.equal(data.snapshot.records["01"].status, "done");
  assert.equal(data.snapshot.records["01"].note, "Nota sintética");
});

test("login bloquea intentos inválidos repetidos", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await worker.fetch(new Request("http://localhost/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
      body: JSON.stringify({ username: env.ROUTE_USERNAME, password: "incorrecta" }),
    }), env, context);
  }
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
});

test("las API protegidas rechazan solicitudes sin sesión", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const response = await worker.fetch(new Request("http://localhost/api/tracking"), env, context);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("la interfaz de conductor conecta mapa, jornada, voz, fotos y métricas", async () => {
  const source = await readFile(new URL("../app/gestionverde-app.tsx", import.meta.url), "utf8");
  const map = await readFile(new URL("../app/gestionverde-map.tsx", import.meta.url), "utf8");
  assert.match(source, /Iniciar recorrido/u);
  assert.match(source, /Pausar jornada/u);
  assert.match(source, /Finalizar jornada/u);
  assert.match(source, /SpeechSynthesisUtterance/u);
  assert.match(source, /Tomar o agregar foto/u);
  assert.match(source, /Descargar CSV/u);
  assert.match(map, /watchPosition/u);
  assert.match(map, /truckIcon/u);
});

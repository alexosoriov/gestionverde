import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const TRACKING_COLUMNS = [
  "id", "lat", "lng", "speed", "heading", "accuracy", "next_stop",
  "completed", "done", "absent", "pending", "total", "kilos",
  "route_km", "estimated_minutes", "started_at", "actual_km",
  "moving_minutes", "stopped_minutes", "baseline_route_km",
  "route_savings_km", "planned_drive_minutes", "activity_json",
  "secure_payload", "status", "updated_at",
];

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
    if (this.sql.startsWith("PRAGMA table_info(live_tracking)")) {
      return { results: TRACKING_COLUMNS.map((name) => ({ name })) };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("SELECT * FROM live_tracking WHERE id")) {
      return this.database.tracking.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT payload, client_updated_at, server_updated_at FROM journey_state")) {
      return this.database.journeys.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT client_updated_at FROM journey_state")) {
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
    if (this.sql.startsWith("INSERT INTO live_tracking")) {
      const [id, status, updatedAt, securePayload] = this.values;
      this.database.tracking.set(id, {
        id,
        lat: 0,
        lng: 0,
        speed: null,
        heading: null,
        accuracy: null,
        next_stop: null,
        completed: 0,
        done: 0,
        absent: 0,
        pending: 0,
        total: 0,
        kilos: 0,
        route_km: null,
        estimated_minutes: null,
        started_at: null,
        actual_km: 0,
        moving_minutes: 0,
        stopped_minutes: 0,
        baseline_route_km: 0,
        route_savings_km: 0,
        planned_drive_minutes: 0,
        activity_json: "[]",
        secure_payload: securePayload,
        status,
        updated_at: updatedAt,
      });
    } else if (this.sql.startsWith("INSERT INTO journey_state")) {
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
    return { success: true };
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
  workerUrl.searchParams.set("operational-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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
    ROUTE_DATA_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
}

const context = { waitUntil() {}, passThroughOnException() {} };

async function loginCookie(worker, env, username = env.ROUTE_USERNAME, password = env.ROUTE_PASSWORD) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
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

test("tracking is encrypted at rest and decrypts for an authenticated manager", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env);
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD);
  const activity = [{ id: "03-1000", stopId: "03", label: "Parada privada", status: "done", at: 1_000, kilos: 8.5 }];

  const post = await worker.fetch(authorizedRequest("http://localhost/api/tracking", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      journeyId: "santuario-2026-07-16",
      lat: -33.45,
      lng: -70.66,
      speed: 2.2,
      heading: 91,
      accuracy: 8,
      nextStop: "Dirección privada",
      completed: 2,
      done: 1,
      absent: 1,
      total: 41,
      kilos: 8.5,
      routeKm: 4.2,
      baselineRouteKm: 4.8,
      routeSavingsKm: 0.6,
      plannedDriveMinutes: 16,
      actualKm: 1.35,
      movingMinutes: 7.4,
      stoppedMinutes: 5.1,
      estimatedMinutes: 88,
      startedAt: 900,
      activity,
      status: "active",
    }),
  }), env, context);
  assert.equal(post.status, 200);

  const stored = database.tracking.get("santuario-2026-07-16");
  assert.equal(stored.lat, 0);
  assert.equal(stored.lng, 0);
  assert.equal(stored.next_stop, null);
  assert.equal(stored.activity_json, "[]");
  assert.match(stored.secure_payload, /"v":2/);
  assert.doesNotMatch(JSON.stringify(stored), /Parada privada|Dirección privada|-33\.45|-70\.66/);

  const driverRead = await worker.fetch(
    authorizedRequest("http://localhost/api/tracking?journey=santuario-2026-07-16", driverCookie),
    env,
    context,
  );
  assert.equal(driverRead.status, 403);

  const get = await worker.fetch(
    authorizedRequest("http://localhost/api/tracking?journey=santuario-2026-07-16", managerCookie),
    env,
    context,
  );
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

test("tracking rejects impossible coordinates", async () => {
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

test("journey snapshots are encrypted in D1 and recover correctly", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env);
  const snapshot = {
    version: 4,
    journeyId: "santuario-2026-07-16",
    statuses: { "01": "done" },
    details: { "01": { kilos: "4,5", material: "Orgánico", note: "Nota privada" } },
    customStops: [{ id: "N1", name: "Persona privada", address: "Dirección privada", lat: -33.4, lng: -70.6, km: 1 }],
    reverse: false,
    optimizedIds: [],
    startedAt: 1_000,
    completedAt: null,
    activity: [],
    vehicle: "Camión",
    lastPosition: { lat: -33.4, lng: -70.6, accuracy: 5, at: 1_500 },
    gpsMetrics: { actualKm: 0.8, movingMinutes: 4, stoppedMinutes: 2 },
    updatedAt: 2_000,
  };

  const post = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: snapshot.journeyId, snapshot }),
  }), env, context);
  assert.equal(post.status, 200);

  const stored = database.journeys.get(snapshot.journeyId);
  assert.match(stored.payload, /"v":2/);
  assert.doesNotMatch(stored.payload, /Nota privada|Persona privada|Dirección privada|-33\.4|-70\.6/);

  const get = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journey=${snapshot.journeyId}`, driverCookie),
    env,
    context,
  );
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.deepEqual(data.snapshot.gpsMetrics, snapshot.gpsMetrics);
  assert.equal(data.snapshot.statuses["01"], "done");
  assert.equal(data.snapshot.details["01"].note, "Nota privada");
});

test("login blocks repeated invalid attempts", async () => {
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

test("protected APIs reject requests without a valid session", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const response = await worker.fetch(new Request("http://localhost/api/tracking"), env, context);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("driver source connects the main action, map picker and manager metrics", async () => {
  const source = await readFile(new URL("../app/route-app.tsx", import.meta.url), "utf8");
  assert.match(source, /Comenzar recorrido y GPS/);
  assert.match(source, /setGpsStartSignal/);
  assert.match(source, /pickLocationMode/);
  assert.match(source, /Seleccionar punto en el mapa/);
  assert.match(source, /routeSavingsKm/);
  assert.match(source, /movingMinutes/);
  assert.match(source, /stoppedMinutes/);
});

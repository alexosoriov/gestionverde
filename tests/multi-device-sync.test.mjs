import assert from "node:assert/strict";
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
    if (this.sql.startsWith("INSERT INTO gestionverde_journeys")) {
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
    this.journeys = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("multi-device-clean-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const context = { waitUntil() {}, passThroughOnException() {} };

function environment(database) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: "driver-user",
    ROUTE_PASSWORD: "driver-password",
    ROUTE_SESSION_SECRET: "test-session-secret-with-enough-entropy",
  };
}

async function loginCookie(worker, env) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
    body: JSON.stringify({ username: env.ROUTE_USERNAME, password: env.ROUTE_PASSWORD }),
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

function snapshot(deviceId, records, updatedAt) {
  return {
    version: 1,
    routeId: "santuario-2026-07-16",
    phase: "active",
    records,
    startedAt: 1_000,
    finishedAt: null,
    pausedAt: null,
    pausedMs: 0,
    position: null,
    voiceEnabled: true,
    deviceId,
    updatedAt,
  };
}

async function save(worker, env, cookie, value, clientUpdatedAt = value.updatedAt) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      journeyId: value.routeId,
      snapshot: value,
      clientUpdatedAt,
    }),
  }), env, context);
  return { response, body: await response.json() };
}

async function load(worker, env, cookie, journeyId) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journeyId=${journeyId}`, cookie),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("dos dispositivos conservan cambios al descargar antes de volver a guardar", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  const phoneA = snapshot("phone-a", {
    "01": { status: "done", note: "", material: "Mixto", kilos: "5", photos: [], visitedAt: 1_000 },
  }, 1_000);
  const first = await save(worker, env, cookie, phoneA);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.ok, true);

  const downloaded = await load(worker, env, cookie, phoneA.routeId);
  assert.equal(downloaded.snapshot.records["01"].status, "done");

  const phoneB = {
    ...downloaded.snapshot,
    deviceId: "phone-b",
    records: {
      ...downloaded.snapshot.records,
      "02": { status: "absent", note: "No estaba", material: "Mixto", kilos: "", photos: [], visitedAt: 2_000 },
    },
    updatedAt: 2_000,
  };
  const second = await save(worker, env, cookie, phoneB);
  assert.equal(second.response.status, 200);

  const final = await load(worker, env, cookie, phoneA.routeId);
  assert.equal(final.snapshot.records["01"].status, "done");
  assert.equal(final.snapshot.records["02"].status, "absent");

  const stored = database.journeys.get(phoneA.routeId);
  assert.match(stored.payload, /phone-b/u);
  assert.match(stored.payload, /"done"/u);
  assert.match(stored.payload, /"absent"/u);
  assert.doesNotMatch(stored.payload, /secure_payload|AES-GCM/u);
});

test("un dispositivo antiguo recibe conflicto y no pisa la jornada nueva", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  const current = snapshot("phone-a", {
    "01": { status: "done", note: "", material: "Mixto", kilos: "5", photos: [], visitedAt: 3_000 },
    "03": { status: "done", note: "", material: "Cartón", kilos: "2", photos: [], visitedAt: 3_000 },
  }, 3_000);
  assert.equal((await save(worker, env, cookie, current)).response.status, 200);

  const stale = snapshot("phone-b", {
    "01": { status: "absent", note: "", material: "Mixto", kilos: "", photos: [], visitedAt: 1_000 },
  }, 1_000);
  const rejected = await save(worker, env, cookie, stale, 1_000);
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.conflict, true);

  const final = await load(worker, env, cookie, current.routeId);
  assert.equal(final.snapshot.records["01"].status, "done");
  assert.equal(final.snapshot.records["03"].status, "done");
});

test("una actualización más nueva puede devolver una vivienda a pendiente", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  const first = snapshot("phone-a", {
    "01": { status: "done", note: "", material: "Mixto", kilos: "5", photos: [], visitedAt: 1_000 },
  }, 1_000);
  assert.equal((await save(worker, env, cookie, first)).response.status, 200);

  const second = snapshot("phone-a", {
    "01": { status: "pending", note: "", material: "Mixto", kilos: "", photos: [], visitedAt: null },
  }, 4_000);
  assert.equal((await save(worker, env, cookie, second)).response.status, 200);

  const final = await load(worker, env, cookie, first.routeId);
  assert.equal(final.snapshot.records["01"].status, "pending");
});

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
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("SELECT payload, client_updated_at, server_updated_at FROM journey_state")) {
      return this.database.journeys.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("FROM journey_state_revisions")) return null;
    return null;
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO journey_state")) {
      this.database.journeys.set(this.values[0], {
        payload: this.values[1],
        client_updated_at: this.values[2],
        server_updated_at: this.values[3],
      });
    }
    return { success: true };
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
  workerUrl.searchParams.set("multi-device-secure-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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
    ROUTE_DATA_KEY: Buffer.alloc(32, 9).toString("base64"),
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

function stamp(at, deviceId, sequence = 1) {
  return { at, deviceId, sequence };
}

function snapshot(deviceId, statuses, statusClocks, updatedAt, sequence = 1) {
  const globalClocks = Object.fromEntries([
    "reverse", "optimizedIds", "startedAt", "completedAt", "activity", "vehicle",
    "lastPosition", "gpsMetrics", "routeId", "sector", "driverId",
  ].map((field) => [field, stamp(updatedAt, deviceId, sequence)]));
  return {
    version: 4,
    journeyId: "santuario-2026-07-16",
    statuses,
    details: {},
    customStops: [],
    reverse: false,
    optimizedIds: [],
    startedAt: 1_000,
    completedAt: null,
    activity: [],
    vehicle: "Camión",
    lastPosition: null,
    gpsMetrics: { actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 },
    updatedAt,
    sync: {
      deviceId,
      serverRevision: 0,
      localSequence: sequence,
      statusClocks,
      detailClocks: {},
      customStopClocks: {},
      globalClocks,
    },
    auditTrail: [{
      id: `${deviceId}:${sequence}:status`,
      at: updatedAt,
      deviceId,
      scope: "status",
      action: "actualizado",
    }],
  };
}

async function save(worker, env, cookie, value) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: value.journeyId, snapshot: value }),
  }), env, context);
  assert.equal(response.status, 200);
  return response.json();
}

test("two encrypted devices keep changes made to different homes", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  const first = await save(worker, env, cookie, snapshot("phone-a", { "01": "done" }, { "01": stamp(1_000, "phone-a") }, 1_000));
  assert.equal(first.snapshot.statuses["01"], "done");
  assert.equal(first.revision, 1);

  const second = await save(worker, env, cookie, snapshot("phone-b", { "02": "absent" }, { "02": stamp(2_000, "phone-b") }, 2_000));
  assert.equal(second.snapshot.statuses["01"], "done");
  assert.equal(second.snapshot.statuses["02"], "absent");
  assert.equal(second.revision, 2);
  assert.equal(second.merged, true);
  assert.ok(second.snapshot.auditTrail.some((entry) => entry.action === "conflicto-fusionado"));

  const stored = database.journeys.get(second.snapshot.journeyId);
  assert.doesNotMatch(stored.payload, /phone-a|phone-b|done|absent/);
});

test("newer change wins for one home without deleting other homes", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  await save(worker, env, cookie, snapshot(
    "phone-a",
    { "01": "done", "03": "done" },
    { "01": stamp(1_000, "phone-a"), "03": stamp(1_000, "phone-a") },
    1_000,
  ));
  const result = await save(worker, env, cookie, snapshot(
    "phone-b",
    { "01": "absent" },
    { "01": stamp(3_000, "phone-b") },
    3_000,
  ));

  assert.equal(result.snapshot.statuses["01"], "absent");
  assert.equal(result.snapshot.statuses["03"], "done");
});

test("a synchronized tombstone can return a home to pending", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const cookie = await loginCookie(worker, env);

  await save(worker, env, cookie, snapshot("phone-a", { "01": "done" }, { "01": stamp(1_000, "phone-a") }, 1_000));
  const result = await save(worker, env, cookie, snapshot("phone-a", {}, { "01": stamp(4_000, "phone-a", 2) }, 4_000, 2));

  assert.equal(result.snapshot.statuses["01"], undefined);
});

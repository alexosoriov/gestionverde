import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

const TOTAL = 41;
const PROFILES = [
  ["android-5g", false, []],
  ["android-4g-cortes", false, [8, 9, 10]],
  ["android-3g", false, [15, 16]],
  ["iphone-5g", false, []],
  ["iphone-reinicio", false, [20]],
  ["tablet", false, [5, 6]],
  ["ruta-inversa", true, []],
  ["zona-sin-senal", false, [24, 25, 26, 27]],
  ["ahorro-bateria", false, [31]],
  ["jefatura-escritorio", false, [12, 13]],
];

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: [], success: true, meta: {} }; }
  async first() {
    if (this.sql.includes("SELECT payload, updated_at FROM gestionverde_tracking")) return this.db.tracking.get(this.values[0]) ?? null;
    if (this.sql.includes("SELECT payload, client_updated_at, server_updated_at") && this.sql.includes("gestionverde_journeys")) return this.db.journeys.get(this.values[0]) ?? null;
    if (this.sql.includes("SELECT client_updated_at FROM gestionverde_journeys")) {
      const row = this.db.journeys.get(this.values[0]);
      return row ? { client_updated_at: row.client_updated_at } : null;
    }
    if (this.sql.includes("SELECT blocked_until FROM auth_rate_limit")) return null;
    if (this.sql.includes("SELECT attempts, window_started FROM auth_rate_limit")) return null;
    return null;
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO gestionverde_tracking")) {
      this.db.tracking.set(this.values[0], { payload: this.values[1], updated_at: this.values[2] });
    } else if (this.sql.startsWith("INSERT INTO gestionverde_journeys")) {
      this.db.journeys.set(this.values[0], { payload: this.values[1], client_updated_at: this.values[2], server_updated_at: this.values[3] });
    }
    return { success: true, meta: {} };
  }
}

class FakeD1 {
  constructor() { this.tracking = new Map(); this.journeys = new Map(); }
  prepare(sql) { return new Statement(this, sql); }
}

const context = { waitUntil() {}, passThroughOnException() {} };

async function workerFor(id) {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("ten-clean", `${id}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

function env(db, index) {
  return {
    DB: db,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: `driver-${index}`,
    ROUTE_PASSWORD: `driver-password-${index}`,
    JEFATURA_USERNAME: `manager-${index}`,
    JEFATURA_PASSWORD: `manager-password-${index}`,
    ROUTE_SESSION_SECRET: `session-secret-${index}-with-enough-entropy-2026`,
  };
}

async function login(worker, environment, username, password, ip) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ username, password }),
  }), environment, context);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

function request(path, cookie, method = "GET", body) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function simulate(profile, index) {
  const [id, reverse, offlineNumbers] = profile;
  const worker = await workerFor(id);
  const db = new FakeD1();
  const environment = env(db, index);
  const driver = await login(worker, environment, environment.ROUTE_USERNAME, environment.ROUTE_PASSWORD, `192.0.2.${index + 1}`);
  const manager = await login(worker, environment, environment.JEFATURA_USERNAME, environment.JEFATURA_PASSWORD, `198.51.100.${index + 1}`);
  const order = Array.from({ length: TOTAL }, (_, stopIndex) => stopIndex + 1);
  if (reverse) order.reverse();
  const offline = new Set(offlineNumbers);
  const records = {};
  let done = 0;
  let absent = 0;
  let queued = 0;
  let lastTracking;
  let lastSnapshot;

  for (let position = 0; position < order.length; position += 1) {
    const number = order[position];
    const stopId = String(number).padStart(2, "0");
    const status = number % 9 === 0 ? "absent" : "done";
    status === "done" ? done += 1 : absent += 1;
    records[stopId] = { status, note: "simulado", material: "Mixto", kilos: status === "done" ? "4" : "", photos: [], visitedAt: 1_000 + position };
    const pending = TOTAL - done - absent;
    lastTracking = {
      lat: -41.46 - position * 0.0001,
      lng: -72.9 - position * 0.0001,
      accuracy: 7,
      done,
      absent,
      pending,
      total: TOTAL,
      actualKm: Number(((position + 1) * 0.11).toFixed(2)),
      nextStop: pending ? `Punto ${position + 2}` : null,
      activity: [{ id: `${id}-${position}`, stopId, label: `Punto ${number}`, status, at: 1_000 + position, kilos: status === "done" ? 4 : 0 }],
      status: pending ? "active" : "finished",
    };
    lastSnapshot = {
      version: 1,
      routeId: `journey-${id}`,
      phase: pending ? "active" : "finished",
      records: structuredClone(records),
      startedAt: 1_000,
      finishedAt: pending ? null : 5_000,
      pausedAt: null,
      pausedMs: 0,
      position: { ...lastTracking, speedKmh: 0, heading: 0, updatedAt: 2_000 + position },
      voiceEnabled: true,
      updatedAt: 2_000 + position,
    };

    if (offline.has(position + 1)) { queued += 2; continue; }
    assert.equal((await worker.fetch(request("/api/tracking", driver, "POST", lastTracking), environment, context)).status, 200);
    assert.equal((await worker.fetch(request("/api/journey-state", driver, "POST", { journeyId: lastSnapshot.routeId, snapshot: lastSnapshot, clientUpdatedAt: lastSnapshot.updatedAt }), environment, context)).status, 200);
  }

  if (offline.size) {
    assert.equal((await worker.fetch(request("/api/tracking", driver, "POST", lastTracking), environment, context)).status, 200);
    assert.equal((await worker.fetch(request("/api/journey-state", driver, "POST", { journeyId: lastSnapshot.routeId, snapshot: lastSnapshot, clientUpdatedAt: lastSnapshot.updatedAt }), environment, context)).status, 200);
  }

  const managerResponse = await worker.fetch(request("/api/tracking", manager), environment, context);
  assert.equal(managerResponse.status, 200);
  const remote = await managerResponse.json();
  assert.equal(remote.tracking.done, done);
  assert.equal(remote.tracking.absent, absent);
  assert.equal(remote.tracking.pending, 0);
  assert.equal(remote.tracking.status, "finished");

  const journeyResponse = await worker.fetch(request(`/api/journey-state?journeyId=${lastSnapshot.routeId}`, driver), environment, context);
  assert.equal(journeyResponse.status, 200);
  const journey = await journeyResponse.json();
  assert.equal(Object.keys(journey.snapshot.records).length, TOTAL);
  assert.equal(journey.snapshot.phase, "finished");
  assert.doesNotMatch(db.tracking.get("current").payload, /AES-GCM|secure_payload/u);
  assert.doesNotMatch(db.journeys.get(lastSnapshot.routeId).payload, /AES-GCM|secure_payload/u);

  return { id, reverse, queued, done, absent, pending: 0, result: "APROBADO" };
}

test("diez simulaciones cubren dispositivos, redes y dirección de ruta", async () => {
  const results = [];
  for (let index = 0; index < PROFILES.length; index += 1) results.push(await simulate(PROFILES[index], index));
  assert.equal(results.length, 10);
  assert.ok(results.every((result) => result.result === "APROBADO"));
  assert.ok(results.some((result) => result.reverse));
  assert.ok(results.some((result) => result.queued > 0));
  assert.ok(results.every((result) => result.done + result.absent === TOTAL));
  await writeFile(new URL("../ten-environment-simulation-report.json", import.meta.url), `${JSON.stringify({ application: "GestiónVerde", storage: "JSON limpio", results }, null, 2)}\n`, "utf8");
});

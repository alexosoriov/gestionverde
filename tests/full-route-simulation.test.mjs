import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

const TOTAL_STOPS = 41;
const JOURNEY_ID = "santuario-prueba-completa";
const ABSENT_STOPS = new Set([7, 14, 21, 28, 35]);
const OFFLINE_FROM = 13;
const OFFLINE_TO = 15;
const RESTART_AFTER = 24;
const MANAGER_CHECKPOINTS = new Set([10, 20, 30, 41]);

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
    if (this.sql.includes("FROM gestionverde_diagnostics")) return { results: [] };
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
    } else if (this.sql.startsWith("DELETE FROM gestionverde_tracking")) {
      this.database.tracking.delete(this.values[0]);
    } else if (this.sql.startsWith("INSERT INTO gestionverde_journeys")) {
      this.database.journeys.set(this.values[0], {
        payload: this.values[1],
        client_updated_at: this.values[2],
        server_updated_at: this.values[3],
      });
    } else if (this.sql.startsWith("DELETE FROM gestionverde_journeys")) {
      this.database.journeys.delete(this.values[0]);
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

function environment(database) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: "driver-simulation",
    ROUTE_PASSWORD: "driver-password-simulation",
    JEFATURA_USERNAME: "manager-simulation",
    JEFATURA_PASSWORD: "manager-password-simulation",
    SUPERADMIN_USERNAME: "admin-simulation",
    SUPERADMIN_PASSWORD: "admin-password-simulation",
    ROUTE_SESSION_SECRET: "professional-route-simulation-session-secret-2026",
  };
}

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("full-route-simulation", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function loginCookie(worker, env, username, password, ip) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ username, password }),
  }), env, context);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

function authorizedRequest(url, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return new Request(url, { ...init, headers });
}

function syntheticStops() {
  const baseLat = -41.4618;
  const baseLng = -72.9028;
  return Array.from({ length: TOTAL_STOPS }, (_, index) => {
    const row = Math.floor(index / 7);
    const rawColumn = index % 7;
    const column = row % 2 === 0 ? rawColumn : 6 - rawColumn;
    return {
      id: String(index + 1).padStart(2, "0"),
      label: `Punto sintético ${String(index + 1).padStart(2, "0")}`,
      lat: baseLat + row * 0.00058 + Math.sin(index * 0.7) * 0.00004,
      lng: baseLng + column * 0.00076 + Math.cos(index * 0.5) * 0.00004,
    };
  });
}

function haversineKm(left, right) {
  const radius = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(right.lat - left.lat);
  const dLng = toRadians(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(left.lat)) * Math.cos(toRadians(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rounded(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function statusCounts(statuses) {
  const values = Object.values(statuses);
  const done = values.filter((value) => value === "done").length;
  const absent = values.filter((value) => value === "absent").length;
  return { done, absent, completed: done + absent, pending: TOTAL_STOPS - done - absent };
}

function makeSnapshot({ stops, statuses, details, activity, position, distanceKm, startedAt, clientUpdatedAt }) {
  const counts = statusCounts(statuses);
  return {
    version: 1,
    routeId: JOURNEY_ID,
    phase: counts.pending === 0 ? "finished" : "active",
    statuses: { ...statuses },
    details: structuredClone(details),
    optimizedIds: stops.map((stop) => stop.id),
    startedAt,
    finishedAt: counts.pending === 0 ? clientUpdatedAt : null,
    activity: structuredClone(activity),
    position: {
      lat: position.lat,
      lng: position.lng,
      accuracy: 5,
      speedKmh: 0,
      heading: 0,
      actualKm: rounded(distanceKm),
      updatedAt: clientUpdatedAt,
    },
    updatedAt: clientUpdatedAt,
  };
}

async function postTracking(worker, env, cookie, body) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/tracking", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env, context);
  assert.equal(response.status, 200);
}

async function postJourney(worker, env, cookie, snapshot) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: JOURNEY_ID, snapshot, clientUpdatedAt: snapshot.updatedAt }),
  }), env, context);
  assert.equal(response.status, 200);
  return response.json();
}

async function getJourney(worker, env, cookie) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journeyId=${JOURNEY_ID}`, cookie),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function getManagerTracking(worker, env, cookie) {
  const response = await worker.fetch(
    authorizedRequest("http://localhost/api/tracking", cookie),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("la simulación profesional completa 41 viviendas con JSON limpio", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD, "192.0.2.41");
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD, "192.0.2.42");
  const stops = syntheticStops();
  const startedAt = Date.now();

  let statuses = {};
  let details = {};
  let activity = [];
  let currentPosition = { lat: stops[0].lat - 0.0007, lng: stops[0].lng - 0.0005 };
  let distanceKm = 0;
  let totalKilos = 0;
  let queuedOfflineWrites = 0;
  let networkWrites = 0;
  const checkpoints = [];
  const pointResults = [];

  for (let index = 0; index < stops.length; index += 1) {
    const stopNumber = index + 1;
    const stop = stops[index];
    const offline = stopNumber >= OFFLINE_FROM && stopNumber <= OFFLINE_TO;
    distanceKm += haversineKm(currentPosition, stop);
    currentPosition = { lat: stop.lat, lng: stop.lng };

    const visitStatus = ABSENT_STOPS.has(stopNumber) ? "absent" : "done";
    const kilos = visitStatus === "done" ? rounded(2.4 + (stopNumber % 6) * 0.55, 1) : 0;
    totalKilos += kilos;
    statuses = { ...statuses, [stop.id]: visitStatus };
    details = {
      ...details,
      [stop.id]: {
        kilos: String(kilos),
        material: visitStatus === "done" ? "Orgánico" : "Sin retiro",
        note: visitStatus === "done" ? `Retiro sintético ${stop.id}` : `Ausente sintético ${stop.id}`,
      },
    };
    const eventAt = startedAt + stopNumber * 10_000;
    activity = [{
      id: `${stop.id}-${eventAt}`,
      stopId: stop.id,
      label: stop.label,
      status: visitStatus,
      at: eventAt,
      kilos,
    }, ...activity];

    const counts = statusCounts(statuses);
    const snapshot = makeSnapshot({
      stops,
      statuses,
      details,
      activity,
      position: currentPosition,
      distanceKm,
      startedAt,
      clientUpdatedAt: eventAt,
    });

    if (offline) {
      queuedOfflineWrites += 2;
    } else {
      await postTracking(worker, env, driverCookie, {
        journeyId: JOURNEY_ID,
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        speed: 0,
        heading: (index * 37) % 360,
        accuracy: 5,
        nextStop: stops[index + 1]?.label ?? null,
        done: counts.done,
        absent: counts.absent,
        pending: counts.pending,
        total: TOTAL_STOPS,
        kilos: rounded(totalKilos, 1),
        actualKm: rounded(distanceKm),
        estimatedMinutes: counts.pending * 3,
        startedAt,
        activity: activity.slice(0, 12),
        status: counts.pending === 0 ? "finished" : "active",
      });
      await postJourney(worker, env, driverCookie, snapshot);
      networkWrites += 2;
    }

    if (stopNumber === OFFLINE_TO) {
      await postTracking(worker, env, driverCookie, {
        journeyId: JOURNEY_ID,
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        speed: 0,
        heading: 0,
        accuracy: 5,
        nextStop: stops[index + 1]?.label ?? null,
        done: counts.done,
        absent: counts.absent,
        pending: counts.pending,
        total: TOTAL_STOPS,
        kilos: rounded(totalKilos, 1),
        actualKm: rounded(distanceKm),
        estimatedMinutes: counts.pending * 3,
        startedAt,
        activity: activity.slice(0, 12),
        status: "active",
      });
      await postJourney(worker, env, driverCookie, snapshot);
      networkWrites += 2;
      checkpoints.push({ step: "reconexion", afterStop: stopNumber, queuedOfflineWrites });
    }

    if (stopNumber === RESTART_AFTER) {
      const restored = await getJourney(worker, env, driverCookie);
      assert.ok(restored.snapshot);
      assert.equal(Object.keys(restored.snapshot.statuses).length, RESTART_AFTER);
      statuses = restored.snapshot.statuses;
      details = restored.snapshot.details;
      activity = restored.snapshot.activity;
      currentPosition = { lat: restored.snapshot.position.lat, lng: restored.snapshot.position.lng };
      distanceKm = restored.snapshot.position.actualKm;
      checkpoints.push({ step: "reinicio-aplicacion", afterStop: stopNumber, recoveredStops: Object.keys(statuses).length });
    }

    if (MANAGER_CHECKPOINTS.has(stopNumber)) {
      const remote = await getManagerTracking(worker, env, managerCookie);
      assert.ok(remote.tracking);
      assert.equal(remote.tracking.done + remote.tracking.absent, counts.completed);
      assert.equal(remote.tracking.pending, counts.pending);
      checkpoints.push({
        step: "jefatura",
        afterStop: stopNumber,
        done: remote.tracking.done,
        absent: remote.tracking.absent,
        pending: remote.tracking.pending,
      });
    }

    pointResults.push({
      point: stopNumber,
      status: visitStatus,
      kilos,
      mode: offline ? "sin-conexion" : "en-linea",
      cumulativeKm: rounded(distanceKm),
      completed: counts.completed,
      pending: counts.pending,
    });
  }

  const finalJourney = await getJourney(worker, env, driverCookie);
  const finalManager = await getManagerTracking(worker, env, managerCookie);
  const finalCounts = statusCounts(finalJourney.snapshot.statuses);

  assert.equal(pointResults.length, TOTAL_STOPS);
  assert.equal(finalCounts.done, 36);
  assert.equal(finalCounts.absent, 5);
  assert.equal(finalCounts.pending, 0);
  assert.ok(finalJourney.snapshot.finishedAt);
  assert.equal(finalManager.tracking.status, "finished");
  assert.equal(finalManager.tracking.done, 36);
  assert.equal(finalManager.tracking.absent, 5);
  assert.equal(finalManager.tracking.pending, 0);
  assert.equal(finalManager.tracking.next_stop, null);
  assert.equal(JSON.parse(finalManager.tracking.activity_json).length, 12);
  assert.ok(distanceKm > 2);
  assert.ok(networkWrites > 60);
  assert.equal(queuedOfflineWrites, 6);

  const rawTracking = database.tracking.get("current");
  const rawJourney = database.journeys.get(JOURNEY_ID);
  assert.ok(rawTracking);
  assert.ok(rawJourney);
  assert.match(rawTracking.payload, /"done":36/u);
  assert.match(rawTracking.payload, /Punto sintético/u);
  assert.match(rawJourney.payload, /Retiro sintético/u);
  assert.doesNotMatch(rawTracking.payload, /secure_payload|AES-GCM|"v":2/u);
  assert.doesNotMatch(rawJourney.payload, /secure_payload|AES-GCM|"v":2/u);

  const driverCannotReadManagerTracking = await worker.fetch(
    authorizedRequest("http://localhost/api/tracking", driverCookie),
    env,
    context,
  );
  assert.equal(driverCannotReadManagerTracking.status, 403);

  const managerCannotWriteJourney = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", managerCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId: JOURNEY_ID, snapshot: finalJourney.snapshot }),
  }), env, context);
  assert.equal(managerCannotWriteJourney.status, 403);

  const report = {
    test: "GestiónVerde · simulación profesional completa",
    environment: "41 puntos sintéticos sin datos personales",
    result: "APROBADO",
    totals: {
      stops: TOTAL_STOPS,
      done: finalCounts.done,
      absent: finalCounts.absent,
      pending: finalCounts.pending,
      networkWrites,
      queuedOfflineWrites,
      actualKm: rounded(distanceKm),
      kilos: rounded(totalKilos, 1),
    },
    scenarios: {
      startAtPoint1: true,
      finishAtPoint41: true,
      offlineFromStop: OFFLINE_FROM,
      offlineToStop: OFFLINE_TO,
      restartAfterStop: RESTART_AFTER,
      managerCheckpoints: [...MANAGER_CHECKPOINTS],
      cleanJsonAtRest: true,
      roleSeparation: true,
    },
    checkpoints,
    points: pointResults,
  };

  await writeFile(
    new URL("../full-route-simulation-report.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
});

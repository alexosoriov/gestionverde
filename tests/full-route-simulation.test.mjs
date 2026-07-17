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
    if (this.sql.includes("SELECT revision, server_updated_at")) return { results: [] };
    if (this.sql.includes("FROM journey_state") && this.sql.includes("ORDER BY server_updated_at")) return { results: [] };
    if (this.sql.includes("FROM live_tracking") && this.sql.includes("secure_payload IS NULL")) return { results: [] };
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("SELECT * FROM live_tracking WHERE id")) {
      return this.database.tracking.get(this.values[0]) ?? null;
    }
    if (this.sql.includes("SELECT payload, client_updated_at, server_updated_at FROM journey_state")) {
      return this.database.journeys.get(this.values[0]) ?? null;
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
    ROUTE_DATA_KEY: Buffer.alloc(32, 19).toString("base64"),
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
      label: `Punto de prueba ${String(index + 1).padStart(2, "0")}`,
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

function interpolate(left, right, count) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 1) / count;
    return {
      lat: left.lat + (right.lat - left.lat) * ratio,
      lng: left.lng + (right.lng - left.lng) * ratio,
    };
  });
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

function makeSnapshot({
  stops,
  statuses,
  details,
  activity,
  position,
  distanceKm,
  movingMinutes,
  stoppedMinutes,
  startedAt,
  clientUpdatedAt,
}) {
  const counts = statusCounts(statuses);
  return {
    version: 4,
    journeyId: JOURNEY_ID,
    statuses: { ...statuses },
    details: structuredClone(details),
    customStops: [],
    reverse: false,
    optimizedIds: stops.map((stop) => stop.id),
    startedAt,
    completedAt: counts.pending === 0 ? clientUpdatedAt : null,
    activity: structuredClone(activity),
    vehicle: "Camión",
    lastPosition: { lat: position.lat, lng: position.lng, accuracy: 5, at: clientUpdatedAt },
    gpsMetrics: {
      actualKm: rounded(distanceKm),
      movingMinutes: rounded(movingMinutes, 1),
      stoppedMinutes: rounded(stoppedMinutes, 1),
    },
    routeId: "simulacion-profesional-41-puntos",
    sector: "entorno-sintetico-sin-datos-personales",
    driverId: "qa-automatizado",
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
    body: JSON.stringify({ journeyId: JOURNEY_ID, snapshot }),
  }), env, context);
  assert.equal(response.status, 200);
  return response.json();
}

async function getJourney(worker, env, cookie) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journey=${JOURNEY_ID}`, cookie),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function getManagerTracking(worker, env, cookie) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/tracking?journey=${JOURNEY_ID}`, cookie),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("professional simulation completes the 41-stop route from point 1 to the end", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD, "192.0.2.41");
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD, "192.0.2.42");
  const stops = syntheticStops();
  const startedAt = Date.now();
  const clientClockBase = startedAt + 120_000;

  let statuses = {};
  let details = {};
  let activity = [];
  let currentPosition = { lat: stops[0].lat - 0.0007, lng: stops[0].lng - 0.0005 };
  let distanceKm = 0;
  let movingMinutes = 0;
  let stoppedMinutes = 0;
  let totalKilos = 0;
  let gpsUpdates = 0;
  let queuedOfflineWrites = 0;
  const checkpoints = [];
  const pointResults = [];

  for (let index = 0; index < stops.length; index += 1) {
    const stopNumber = index + 1;
    const stop = stops[index];
    const offline = stopNumber >= OFFLINE_FROM && stopNumber <= OFFLINE_TO;
    const samples = interpolate(currentPosition, stop, 4);

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      distanceKm += haversineKm(currentPosition, sample);
      movingMinutes += 0.35;
      currentPosition = sample;
      const isArrival = sampleIndex === samples.length - 1;

      if (!isArrival) {
        if (offline) {
          queuedOfflineWrites += 1;
          continue;
        }
        const counts = statusCounts(statuses);
        await postTracking(worker, env, driverCookie, {
          journeyId: JOURNEY_ID,
          lat: sample.lat,
          lng: sample.lng,
          speed: 5.2,
          heading: (index * 37 + sampleIndex * 11) % 360,
          accuracy: 5,
          nextStop: stop.label,
          completed: counts.completed,
          done: counts.done,
          absent: counts.absent,
          total: TOTAL_STOPS,
          kilos: rounded(totalKilos, 1),
          routeKm: rounded(distanceKm + 1.2),
          baselineRouteKm: rounded(distanceKm + 1.8),
          routeSavingsKm: 0.6,
          plannedDriveMinutes: 55,
          actualKm: rounded(distanceKm),
          movingMinutes: rounded(movingMinutes, 1),
          stoppedMinutes: rounded(stoppedMinutes, 1),
          estimatedMinutes: Math.max(0, (TOTAL_STOPS - counts.completed) * 3),
          startedAt,
          activity,
          status: "active",
        });
        gpsUpdates += 1;
      }
    }

    const visitStatus = ABSENT_STOPS.has(stopNumber) ? "absent" : "done";
    const kilos = visitStatus === "done" ? rounded(2.4 + (stopNumber % 6) * 0.55, 1) : 0;
    totalKilos += kilos;
    stoppedMinutes += visitStatus === "done" ? 0.8 : 0.45;
    statuses = { ...statuses, [stop.id]: visitStatus };
    details = {
      ...details,
      [stop.id]: {
        kilos: kilos ? String(kilos).replace(".", ",") : "0",
        material: visitStatus === "done" ? "Orgánico" : "Sin retiro",
        note: visitStatus === "done" ? `Retiro simulado ${stop.id}` : `Ausente simulado ${stop.id}`,
      },
    };
    const eventAt = clientClockBase + stopNumber * 10_000;
    activity = [{
      id: `${stop.id}-${eventAt}`,
      stopId: stop.id,
      stopName: stop.label,
      stopAddress: stop.label,
      status: visitStatus,
      at: eventAt,
    }, ...activity];

    const snapshot = makeSnapshot({
      stops,
      statuses,
      details,
      activity,
      position: currentPosition,
      distanceKm,
      movingMinutes,
      stoppedMinutes,
      startedAt,
      clientUpdatedAt: eventAt,
    });
    const counts = statusCounts(statuses);

    if (offline) {
      queuedOfflineWrites += 2;
    } else {
      await postTracking(worker, env, driverCookie, {
        journeyId: JOURNEY_ID,
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        speed: 0,
        heading: (index * 37) % 360,
        accuracy: 4,
        nextStop: stops[index + 1]?.label ?? null,
        completed: counts.completed,
        done: counts.done,
        absent: counts.absent,
        total: TOTAL_STOPS,
        kilos: rounded(totalKilos, 1),
        routeKm: rounded(distanceKm + 1.2),
        baselineRouteKm: rounded(distanceKm + 1.8),
        routeSavingsKm: 0.6,
        plannedDriveMinutes: 55,
        actualKm: rounded(distanceKm),
        movingMinutes: rounded(movingMinutes, 1),
        stoppedMinutes: rounded(stoppedMinutes, 1),
        estimatedMinutes: Math.max(0, counts.pending * 3),
        startedAt,
        activity: activity.slice(0, 12).map((entry) => ({ ...entry, label: entry.stopAddress, kilos: Number((details[entry.stopId]?.kilos ?? "0").replace(",", ".")) })),
        status: counts.pending === 0 ? "finished" : "active",
      });
      gpsUpdates += 1;
      await postJourney(worker, env, driverCookie, snapshot);
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
        completed: counts.completed,
        done: counts.done,
        absent: counts.absent,
        total: TOTAL_STOPS,
        kilos: rounded(totalKilos, 1),
        routeKm: rounded(distanceKm + 1.2),
        baselineRouteKm: rounded(distanceKm + 1.8),
        routeSavingsKm: 0.6,
        plannedDriveMinutes: 55,
        actualKm: rounded(distanceKm),
        movingMinutes: rounded(movingMinutes, 1),
        stoppedMinutes: rounded(stoppedMinutes, 1),
        estimatedMinutes: counts.pending * 3,
        startedAt,
        activity: activity.slice(0, 12).map((entry) => ({ ...entry, label: entry.stopAddress, kilos: Number((details[entry.stopId]?.kilos ?? "0").replace(",", ".")) })),
        status: "active",
      });
      gpsUpdates += 1;
      await postJourney(worker, env, driverCookie, snapshot);
      checkpoints.push({ step: "reconexion", afterStop: stopNumber, queuedOfflineWrites, recoveredCompleted: counts.completed });
    }

    if (stopNumber === RESTART_AFTER) {
      const restored = await getJourney(worker, env, driverCookie);
      assert.ok(restored.snapshot);
      assert.equal(Object.keys(restored.snapshot.statuses).length, RESTART_AFTER);
      statuses = restored.snapshot.statuses;
      details = restored.snapshot.details;
      activity = restored.snapshot.activity;
      currentPosition = { lat: restored.snapshot.lastPosition.lat, lng: restored.snapshot.lastPosition.lng };
      distanceKm = restored.snapshot.gpsMetrics.actualKm;
      movingMinutes = restored.snapshot.gpsMetrics.movingMinutes;
      stoppedMinutes = restored.snapshot.gpsMetrics.stoppedMinutes;
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
      id: stop.id,
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
  assert.ok(finalJourney.snapshot.completedAt);
  assert.equal(finalManager.tracking.status, "finished");
  assert.equal(finalManager.tracking.done, 36);
  assert.equal(finalManager.tracking.absent, 5);
  assert.equal(finalManager.tracking.pending, 0);
  assert.equal(finalManager.tracking.next_stop, null);
  assert.equal(JSON.parse(finalManager.tracking.activity_json).length, 12);
  assert.ok(distanceKm > 2);
  assert.ok(gpsUpdates >= 150);
  assert.ok(queuedOfflineWrites >= 15);

  const rawTracking = database.tracking.get(JOURNEY_ID);
  const rawJourney = database.journeys.get(JOURNEY_ID);
  assert.equal(rawTracking.lat, 0);
  assert.equal(rawTracking.lng, 0);
  assert.equal(rawTracking.next_stop, null);
  assert.equal(rawTracking.activity_json, "[]");
  assert.match(rawTracking.secure_payload, /"v":2/);
  assert.match(rawJourney.payload, /"v":2/);
  assert.doesNotMatch(rawTracking.secure_payload, /Punto de prueba|Retiro simulado|Ausente simulado/);
  assert.doesNotMatch(rawJourney.payload, /Punto de prueba|Retiro simulado|Ausente simulado/);

  const driverCannotReadManagerTracking = await worker.fetch(
    authorizedRequest(`http://localhost/api/tracking?journey=${JOURNEY_ID}`, driverCookie),
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
    test: "Ruta Verde · simulación profesional completa",
    environment: "41 puntos sintéticos; no utiliza nombres, direcciones ni coordenadas personales",
    result: "APROBADO",
    totals: {
      stops: TOTAL_STOPS,
      done: finalCounts.done,
      absent: finalCounts.absent,
      pending: finalCounts.pending,
      gpsUpdates,
      queuedOfflineWrites,
      actualKm: rounded(distanceKm),
      movingMinutes: rounded(movingMinutes, 1),
      stoppedMinutes: rounded(stoppedMinutes, 1),
      kilos: rounded(totalKilos, 1),
    },
    scenarios: {
      startAtPoint1: true,
      finishAtPoint41: true,
      offlineFromStop: OFFLINE_FROM,
      offlineToStop: OFFLINE_TO,
      restartAfterStop: RESTART_AFTER,
      managerCheckpoints: [...MANAGER_CHECKPOINTS],
      encryptedAtRest: true,
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

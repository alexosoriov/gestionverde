import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

const TOTAL_STOPS = 41;
const TRACKING_COLUMNS = [
  "id", "lat", "lng", "speed", "heading", "accuracy", "next_stop",
  "completed", "done", "absent", "pending", "total", "kilos",
  "route_km", "estimated_minutes", "started_at", "actual_km",
  "moving_minutes", "stopped_minutes", "baseline_route_km",
  "route_savings_km", "planned_drive_minutes", "activity_json",
  "secure_payload", "status", "updated_at",
];

const PROFILES = [
  {
    id: "android-5g-normal",
    device: "Samsung Galaxy A54",
    os: "Android 15",
    browser: "Chrome 150 PWA",
    network: "5G estable",
    userAgent: "Mozilla/5.0 (Linux; Android 15; SM-A546B) AppleWebKit/537.36 Chrome/150 Mobile",
    direction: "forward",
    samples: 4,
    managerCheckpoints: [10, 20, 30, 41],
  },
  {
    id: "iphone-4g-latencia",
    device: "iPhone 14",
    os: "iOS 19",
    browser: "Safari PWA",
    network: "4G con latencia y pérdida ocasional",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    direction: "forward",
    samples: 3,
    offlineRanges: [[18, 19]],
    packetLossEvery: 7,
    restartStops: [27],
    noiseMeters: 3,
    managerCheckpoints: [12, 24, 36, 41],
  },
  {
    id: "windows-wifi-inversa",
    device: "Notebook Windows",
    os: "Windows 11",
    browser: "Chrome 150",
    network: "Wi-Fi oficina",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
    direction: "reverse",
    samples: 5,
    restartStops: [20],
    backgroundRanges: [[31, 32]],
    managerCheckpoints: [8, 20, 32, 41],
  },
  {
    id: "android-economico-3g",
    device: "Motorola Moto G",
    os: "Android 13",
    browser: "Chrome 146",
    network: "3G inestable",
    userAgent: "Mozilla/5.0 (Linux; Android 13; moto g) AppleWebKit/537.36 Chrome/146 Mobile",
    direction: "forward",
    samples: 2,
    offlineRanges: [[8, 10], [29, 31]],
    packetLossEvery: 3,
    restartStops: [16],
    noiseMeters: 5,
    managerCheckpoints: [11, 21, 32, 41],
  },
  {
    id: "ipad-cambio-red",
    device: "iPad Air",
    os: "iPadOS 19",
    browser: "Safari",
    network: "Wi-Fi → 4G → sin conexión → 4G",
    userAgent: "Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    direction: "forward",
    samples: 4,
    offlineRanges: [[14, 17]],
    restartStops: [18],
    managerCheckpoints: [9, 18, 27, 36, 41],
  },
  {
    id: "tablet-rugged-gps-ruidoso",
    device: "Tablet rugerizada",
    os: "Android 14",
    browser: "Microsoft Edge",
    network: "LTE",
    userAgent: "Mozilla/5.0 (Linux; Android 14; RuggedTab) AppleWebKit/537.36 EdgA/150 Mobile",
    direction: "forward",
    samples: 6,
    offlineRanges: [[25, 25]],
    outlierStops: [6, 22, 34],
    noiseMeters: 12,
    managerCheckpoints: [10, 20, 30, 41],
  },
  {
    id: "iphone-segundo-plano",
    device: "iPhone SE",
    os: "iOS 18",
    browser: "Safari PWA",
    network: "4G",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    direction: "forward",
    samples: 4,
    backgroundRanges: [[11, 14], [30, 31]],
    restartStops: [15, 32],
    managerCheckpoints: [10, 16, 29, 33, 41],
  },
  {
    id: "dos-conductores-relevo",
    device: "Samsung A35 + Xiaomi Redmi",
    os: "Android 15 + Android 14",
    browser: "Chrome PWA",
    network: "Wi-Fi + 4G",
    userAgent: "Mozilla/5.0 (Linux; Android 15; MultiDevice) AppleWebKit/537.36 Chrome/150 Mobile",
    secondaryUserAgent: "Mozilla/5.0 (Linux; Android 14; Redmi) AppleWebKit/537.36 Chrome/149 Mobile",
    direction: "forward",
    samples: 4,
    offlineRanges: [[19, 20]],
    handoffAt: 21,
    managerCheckpoints: [10, 20, 21, 30, 41],
  },
  {
    id: "tablet-wifi-publico",
    device: "Tablet Windows",
    os: "Windows 11",
    browser: "Edge 150",
    network: "Wi-Fi público intermitente",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36 Edg/150 Safari/537.36",
    direction: "reverse",
    samples: 3,
    offlineRanges: [[5, 7], [16, 18], [36, 37]],
    packetLossEvery: 2,
    restartStops: [8, 19, 38],
    managerCheckpoints: [8, 19, 28, 38, 41],
  },
  {
    id: "superadmin-mixto-inversa",
    device: "MacBook + iPhone",
    os: "macOS 16 + iOS 19",
    browser: "Safari",
    network: "Fibra → 5G",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 16_0) AppleWebKit/605.1.15 Safari/605.1.15",
    direction: "reverse",
    samples: 5,
    offlineRanges: [[23, 24]],
    restartStops: [25],
    noiseMeters: 2,
    useSuperadmin: true,
    managerCheckpoints: [10, 20, 25, 35, 41],
  },
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

function environment(database, scenarioIndex) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: `driver-${scenarioIndex}`,
    ROUTE_PASSWORD: `driver-password-${scenarioIndex}`,
    JEFATURA_USERNAME: `manager-${scenarioIndex}`,
    JEFATURA_PASSWORD: `manager-password-${scenarioIndex}`,
    SUPERADMIN_USERNAME: `admin-${scenarioIndex}`,
    SUPERADMIN_PASSWORD: `admin-password-${scenarioIndex}`,
    ROUTE_SESSION_SECRET: `ten-simulations-session-secret-${scenarioIndex}-with-enough-entropy`,
    ROUTE_DATA_KEY: Buffer.alloc(32, scenarioIndex + 31).toString("base64"),
  };
}

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function loadWorker(tag) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ten-environment-simulations", `${tag}-${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function loginCookie(worker, env, username, password, ip, userAgent) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ username, password }),
  }), env, context);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

function authorizedRequest(url, cookie, userAgent, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  headers.set("User-Agent", userAgent);
  return new Request(url, { ...init, headers });
}

function syntheticStops(scenarioIndex, direction) {
  const baseLat = -41.4618 + scenarioIndex * 0.00003;
  const baseLng = -72.9028 - scenarioIndex * 0.00003;
  const stops = Array.from({ length: TOTAL_STOPS }, (_, index) => {
    const row = Math.floor(index / 7);
    const rawColumn = index % 7;
    const column = row % 2 === 0 ? rawColumn : 6 - rawColumn;
    return {
      id: String(index + 1).padStart(2, "0"),
      label: `Escenario ${scenarioIndex + 1} punto ${String(index + 1).padStart(2, "0")}`,
      lat: baseLat + row * 0.00058 + Math.sin(index * 0.7) * 0.00004,
      lng: baseLng + column * 0.00076 + Math.cos(index * 0.5) * 0.00004,
    };
  });
  return direction === "reverse" ? stops.reverse() : stops;
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

function applyNoise(point, meters, seed) {
  if (!meters) return point;
  const latitudeOffset = (Math.sin(seed * 1.91) * meters) / 111_320;
  const longitudeOffset = (Math.cos(seed * 1.37) * meters) /
    (111_320 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));
  return { lat: point.lat + latitudeOffset, lng: point.lng + longitudeOffset };
}

function rounded(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function withinRanges(stopNumber, ranges = []) {
  return ranges.some(([from, to]) => stopNumber >= from && stopNumber <= to);
}

function rangeEndsAt(stopNumber, ranges = []) {
  return ranges.some(([, to]) => stopNumber === to);
}

function statusCounts(statuses) {
  const values = Object.values(statuses);
  const done = values.filter((value) => value === "done").length;
  const absent = values.filter((value) => value === "absent").length;
  return { done, absent, completed: done + absent, pending: TOTAL_STOPS - done - absent };
}

function trackingActivity(activity, details) {
  return activity.slice(0, 12).map((entry) => ({
    id: entry.id,
    stopId: entry.stopId,
    label: entry.stopAddress,
    status: entry.status,
    at: entry.at,
    kilos: Number((details[entry.stopId]?.kilos ?? "0").replace(",", ".")),
  }));
}

function makeSnapshot({
  journeyId,
  profile,
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
  deviceId,
}) {
  const counts = statusCounts(statuses);
  return {
    version: 4,
    journeyId,
    statuses: { ...statuses },
    details: structuredClone(details),
    customStops: [],
    reverse: profile.direction === "reverse",
    optimizedIds: stops.map((stop) => stop.id),
    startedAt,
    completedAt: counts.pending === 0 ? clientUpdatedAt : null,
    activity: structuredClone(activity),
    vehicle: "Camión",
    lastPosition: { lat: position.lat, lng: position.lng, accuracy: Math.max(4, profile.noiseMeters ?? 0), at: clientUpdatedAt },
    gpsMetrics: {
      actualKm: rounded(distanceKm),
      movingMinutes: rounded(movingMinutes, 1),
      stoppedMinutes: rounded(stoppedMinutes, 1),
    },
    routeId: `simulacion-${profile.id}`,
    sector: "entorno-sintetico-sin-datos-personales",
    driverId: deviceId,
    updatedAt: clientUpdatedAt,
  };
}

async function postTracking(worker, env, cookie, userAgent, body) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/tracking", cookie, userAgent, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env, context);
  assert.equal(response.status, 200);
}

async function postJourney(worker, env, cookie, userAgent, journeyId, snapshot) {
  const response = await worker.fetch(authorizedRequest("http://localhost/api/journey-state", cookie, userAgent, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journeyId, snapshot }),
  }), env, context);
  assert.equal(response.status, 200);
  return response.json();
}

async function getJourney(worker, env, cookie, userAgent, journeyId) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/journey-state?journey=${journeyId}`, cookie, userAgent),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function getTracking(worker, env, cookie, userAgent, journeyId) {
  const response = await worker.fetch(
    authorizedRequest(`http://localhost/api/tracking?journey=${journeyId}`, cookie, userAgent),
    env,
    context,
  );
  assert.equal(response.status, 200);
  return response.json();
}

function trackingPayload({
  journeyId,
  stop,
  nextStop,
  position,
  counts,
  startedAt,
  activity,
  details,
  distanceKm,
  movingMinutes,
  stoppedMinutes,
  totalKilos,
  status,
  speed,
  heading,
  accuracy,
}) {
  return {
    journeyId,
    lat: position.lat,
    lng: position.lng,
    speed,
    heading,
    accuracy,
    nextStop: nextStop?.label ?? null,
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
    activity: trackingActivity(activity, details),
    status,
    currentStop: stop?.label ?? null,
  };
}

async function simulateProfile(profile, scenarioIndex) {
  let worker = await loadWorker(profile.id);
  const database = new FakeD1();
  const env = environment(database, scenarioIndex + 1);
  const driverCookie = await loginCookie(
    worker,
    env,
    profile.useSuperadmin ? env.SUPERADMIN_USERNAME : env.ROUTE_USERNAME,
    profile.useSuperadmin ? env.SUPERADMIN_PASSWORD : env.ROUTE_PASSWORD,
    `198.51.100.${scenarioIndex + 10}`,
    profile.userAgent,
  );
  const managerCookie = await loginCookie(
    worker,
    env,
    env.JEFATURA_USERNAME,
    env.JEFATURA_PASSWORD,
    `198.51.100.${scenarioIndex + 80}`,
    profile.userAgent,
  );
  const secondaryCookie = profile.handoffAt
    ? await loginCookie(
      worker,
      env,
      env.ROUTE_USERNAME,
      env.ROUTE_PASSWORD,
      `203.0.113.${scenarioIndex + 20}`,
      profile.secondaryUserAgent,
    )
    : null;

  const journeyId = `qa-${profile.id}`;
  const stops = syntheticStops(scenarioIndex, profile.direction);
  const startedAt = Date.now() + scenarioIndex * 1_000;
  const clientClockBase = startedAt + 120_000;
  const absentIds = new Set(
    stops.filter((_, index) => (index + 1 + scenarioIndex) % 8 === 0).map((stop) => stop.id),
  );

  let activeCookie = driverCookie;
  let activeUserAgent = profile.userAgent;
  let activeDeviceId = `${profile.id}-device-a`;
  let statuses = {};
  let details = {};
  let activity = [];
  let currentPosition = { lat: stops[0].lat - 0.0007, lng: stops[0].lng - 0.0005 };
  let distanceKm = 0;
  let movingMinutes = 0;
  let stoppedMinutes = 0;
  let totalKilos = 0;
  let gpsAccepted = 0;
  let gpsDropped = 0;
  let outliersRejected = 0;
  let queuedWrites = 0;
  let reconnects = 0;
  let restarts = 0;
  let handoffs = 0;
  const checkpoints = [];
  const pointResults = [];
  let operationNumber = 0;

  for (let index = 0; index < stops.length; index += 1) {
    const stopNumber = index + 1;
    const stop = stops[index];
    const offline = withinRanges(stopNumber, profile.offlineRanges);
    const background = withinRanges(stopNumber, profile.backgroundRanges);
    const samples = interpolate(currentPosition, stop, profile.samples);

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      operationNumber += 1;
      const exactSample = samples[sampleIndex];
      if (profile.outlierStops?.includes(stopNumber) && sampleIndex === Math.floor(samples.length / 2)) {
        const impossible = { lat: exactSample.lat + 1.3, lng: exactSample.lng - 1.3 };
        assert.ok(haversineKm(currentPosition, impossible) > 100);
        outliersRejected += 1;
        continue;
      }

      const sample = applyNoise(exactSample, profile.noiseMeters, stopNumber * 10 + sampleIndex);
      distanceKm += haversineKm(currentPosition, sample);
      movingMinutes += profile.network.includes("3G") ? 0.55 : profile.network.includes("Wi-Fi público") ? 0.48 : 0.35;
      currentPosition = sample;
      const isArrival = sampleIndex === samples.length - 1;

      if (isArrival) continue;
      const packetDropped = profile.packetLossEvery && operationNumber % profile.packetLossEvery === 0;
      if (offline || background || packetDropped) {
        queuedWrites += 1;
        gpsDropped += 1;
        continue;
      }

      const counts = statusCounts(statuses);
      await postTracking(worker, env, activeCookie, activeUserAgent, trackingPayload({
        journeyId,
        stop,
        nextStop: stop,
        position: sample,
        counts,
        startedAt,
        activity,
        details,
        distanceKm,
        movingMinutes,
        stoppedMinutes,
        totalKilos,
        status: "active",
        speed: profile.network.includes("3G") ? 3.1 : 5.2,
        heading: (index * 37 + sampleIndex * 11) % 360,
        accuracy: Math.max(5, profile.noiseMeters ?? 0),
      }));
      gpsAccepted += 1;
    }

    const visitStatus = absentIds.has(stop.id) ? "absent" : "done";
    const kilos = visitStatus === "done"
      ? rounded(1.9 + ((stopNumber + scenarioIndex) % 7) * 0.48, 1)
      : 0;
    totalKilos += kilos;
    stoppedMinutes += visitStatus === "done" ? 0.8 : 0.45;
    statuses = { ...statuses, [stop.id]: visitStatus };
    details = {
      ...details,
      [stop.id]: {
        kilos: kilos ? String(kilos).replace(".", ",") : "0",
        material: visitStatus === "done" ? "Orgánico" : "Sin retiro",
        note: `${visitStatus === "done" ? "Retiro" : "Ausente"} QA ${profile.id} ${stop.id}`,
      },
    };
    const eventAt = clientClockBase + stopNumber * 10_000;
    activity = [{
      id: `${profile.id}-${stop.id}-${eventAt}`,
      stopId: stop.id,
      stopName: stop.label,
      stopAddress: stop.label,
      status: visitStatus,
      at: eventAt,
    }, ...activity];

    const snapshot = makeSnapshot({
      journeyId,
      profile,
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
      deviceId: activeDeviceId,
    });
    const counts = statusCounts(statuses);

    if (offline || background) {
      queuedWrites += 2;
    } else {
      await postTracking(worker, env, activeCookie, activeUserAgent, trackingPayload({
        journeyId,
        stop,
        nextStop: stops[index + 1],
        position: currentPosition,
        counts,
        startedAt,
        activity,
        details,
        distanceKm,
        movingMinutes,
        stoppedMinutes,
        totalKilos,
        status: counts.pending === 0 ? "finished" : "active",
        speed: 0,
        heading: (index * 37) % 360,
        accuracy: Math.max(4, profile.noiseMeters ?? 0),
      }));
      gpsAccepted += 1;
      await postJourney(worker, env, activeCookie, activeUserAgent, journeyId, snapshot);
    }

    if (rangeEndsAt(stopNumber, profile.offlineRanges) || rangeEndsAt(stopNumber, profile.backgroundRanges)) {
      await postTracking(worker, env, activeCookie, activeUserAgent, trackingPayload({
        journeyId,
        stop,
        nextStop: stops[index + 1],
        position: currentPosition,
        counts,
        startedAt,
        activity,
        details,
        distanceKm,
        movingMinutes,
        stoppedMinutes,
        totalKilos,
        status: counts.pending === 0 ? "finished" : "active",
        speed: 0,
        heading: 0,
        accuracy: Math.max(5, profile.noiseMeters ?? 0),
      }));
      gpsAccepted += 1;
      await postJourney(worker, env, activeCookie, activeUserAgent, journeyId, snapshot);
      reconnects += 1;
      checkpoints.push({ type: "reconexion", afterStop: stopNumber, completed: counts.completed, queuedWrites });
    }

    if (profile.restartStops?.includes(stopNumber)) {
      worker = await loadWorker(`${profile.id}-restart-${stopNumber}`);
      const restored = await getJourney(worker, env, activeCookie, activeUserAgent, journeyId);
      assert.ok(restored.snapshot);
      assert.equal(Object.keys(restored.snapshot.statuses).length, stopNumber);
      statuses = restored.snapshot.statuses;
      details = restored.snapshot.details;
      activity = restored.snapshot.activity;
      currentPosition = {
        lat: restored.snapshot.lastPosition.lat,
        lng: restored.snapshot.lastPosition.lng,
      };
      distanceKm = restored.snapshot.gpsMetrics.actualKm;
      movingMinutes = restored.snapshot.gpsMetrics.movingMinutes;
      stoppedMinutes = restored.snapshot.gpsMetrics.stoppedMinutes;
      restarts += 1;
      checkpoints.push({ type: "reinicio", afterStop: stopNumber, recoveredStops: Object.keys(statuses).length });
    }

    if (profile.handoffAt === stopNumber) {
      const restored = await getJourney(worker, env, secondaryCookie, profile.secondaryUserAgent, journeyId);
      assert.equal(Object.keys(restored.snapshot.statuses).length, stopNumber);
      activeCookie = secondaryCookie;
      activeUserAgent = profile.secondaryUserAgent;
      activeDeviceId = `${profile.id}-device-b`;
      statuses = restored.snapshot.statuses;
      details = restored.snapshot.details;
      activity = restored.snapshot.activity;
      handoffs += 1;
      checkpoints.push({ type: "relevo-dispositivo", afterStop: stopNumber, recoveredStops: Object.keys(statuses).length });
    }

    if (profile.managerCheckpoints.includes(stopNumber)) {
      const remote = await getTracking(worker, env, managerCookie, profile.userAgent, journeyId);
      assert.ok(remote.tracking);
      assert.equal(remote.tracking.done + remote.tracking.absent, counts.completed);
      assert.equal(remote.tracking.pending, counts.pending);
      checkpoints.push({
        type: "jefatura",
        afterStop: stopNumber,
        done: remote.tracking.done,
        absent: remote.tracking.absent,
        pending: remote.tracking.pending,
      });
    }

    pointResults.push({
      sequence: stopNumber,
      stopId: stop.id,
      status: visitStatus,
      kilos,
      networkMode: offline ? "offline" : background ? "segundo-plano" : "online",
      cumulativeKm: rounded(distanceKm),
      completed: counts.completed,
      pending: counts.pending,
    });
  }

  const finalJourney = await getJourney(worker, env, activeCookie, activeUserAgent, journeyId);
  const finalManager = await getTracking(worker, env, managerCookie, profile.userAgent, journeyId);
  const finalCounts = statusCounts(finalJourney.snapshot.statuses);

  assert.equal(pointResults.length, TOTAL_STOPS);
  assert.equal(finalCounts.completed, TOTAL_STOPS);
  assert.equal(finalCounts.pending, 0);
  assert.ok(finalJourney.snapshot.completedAt);
  assert.equal(finalManager.tracking.status, "finished");
  assert.equal(finalManager.tracking.pending, 0);
  assert.equal(finalManager.tracking.next_stop, null);
  assert.ok(distanceKm > 2);
  assert.ok(gpsAccepted > 40);

  const rawTracking = database.tracking.get(journeyId);
  const rawJourney = database.journeys.get(journeyId);
  assert.equal(rawTracking.lat, 0);
  assert.equal(rawTracking.lng, 0);
  assert.equal(rawTracking.next_stop, null);
  assert.equal(rawTracking.activity_json, "[]");
  assert.match(rawTracking.secure_payload, /"v":2/);
  assert.match(rawJourney.payload, /"v":2/);
  assert.doesNotMatch(rawTracking.secure_payload, /Escenario|Retiro QA|Ausente QA/);
  assert.doesNotMatch(rawJourney.payload, /Escenario|Retiro QA|Ausente QA/);

  if (!profile.useSuperadmin) {
    const driverCannotRead = await worker.fetch(
      authorizedRequest(`http://localhost/api/tracking?journey=${journeyId}`, activeCookie, activeUserAgent),
      env,
      context,
    );
    assert.equal(driverCannotRead.status, 403);
  } else {
    const adminCanRead = await worker.fetch(
      authorizedRequest(`http://localhost/api/tracking?journey=${journeyId}`, activeCookie, activeUserAgent),
      env,
      context,
    );
    assert.equal(adminCanRead.status, 200);
  }

  const managerCannotWrite = await worker.fetch(authorizedRequest(
    "http://localhost/api/journey-state",
    managerCookie,
    profile.userAgent,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId, snapshot: finalJourney.snapshot }),
    },
  ), env, context);
  assert.equal(managerCannotWrite.status, 403);

  return {
    id: profile.id,
    result: "APROBADO",
    device: profile.device,
    os: profile.os,
    browser: profile.browser,
    network: profile.network,
    direction: profile.direction === "reverse" ? "41 → 1" : "1 → 41",
    totals: {
      stops: TOTAL_STOPS,
      done: finalCounts.done,
      absent: finalCounts.absent,
      pending: finalCounts.pending,
      gpsAccepted,
      gpsDropped,
      outliersRejected,
      queuedWrites,
      reconnects,
      restarts,
      handoffs,
      actualKm: rounded(distanceKm),
      movingMinutes: rounded(movingMinutes, 1),
      stoppedMinutes: rounded(stoppedMinutes, 1),
      kilos: rounded(totalKilos, 1),
    },
    checks: {
      fullRoute: true,
      managerFinalState: true,
      encryptedAtRest: true,
      roleSeparation: true,
      applicationRecovery: true,
      networkRecovery: true,
    },
    checkpoints,
    points: pointResults,
  };
}

test("ten complete simulations cover devices, networks, directions and failures", async () => {
  const reports = [];
  for (let index = 0; index < PROFILES.length; index += 1) {
    const report = await simulateProfile(PROFILES[index], index);
    reports.push(report);
  }

  assert.equal(reports.length, 10);
  assert.ok(reports.every((report) => report.result === "APROBADO"));
  assert.ok(reports.every((report) => report.totals.stops === 41));
  assert.ok(reports.every((report) => report.totals.pending === 0));
  assert.equal(reports.filter((report) => report.direction === "41 → 1").length, 3);
  assert.ok(reports.reduce((total, report) => total + report.totals.gpsAccepted, 0) > 1_000);
  assert.ok(reports.reduce((total, report) => total + report.totals.queuedWrites, 0) > 50);

  const summary = {
    test: "Ruta Verde · 10 simulaciones integrales multidispositivo",
    generatedAt: new Date().toISOString(),
    result: "APROBADO",
    scenarioCount: reports.length,
    totalStopsProcessed: reports.reduce((total, report) => total + report.totals.stops, 0),
    totalGpsAccepted: reports.reduce((total, report) => total + report.totals.gpsAccepted, 0),
    totalGpsDropped: reports.reduce((total, report) => total + report.totals.gpsDropped, 0),
    totalQueuedWrites: reports.reduce((total, report) => total + report.totals.queuedWrites, 0),
    totalReconnects: reports.reduce((total, report) => total + report.totals.reconnects, 0),
    totalRestarts: reports.reduce((total, report) => total + report.totals.restarts, 0),
    totalHandoffs: reports.reduce((total, report) => total + report.totals.handoffs, 0),
    directions: {
      forward: reports.filter((report) => report.direction === "1 → 41").length,
      reverse: reports.filter((report) => report.direction === "41 → 1").length,
    },
    scenarios: reports,
  };

  await writeFile(
    new URL("../ten-simulations-report.json", import.meta.url),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
});

import { decryptJson, encryptJson, isEncryptedEnvelope } from "./data-crypto";

type ActivityPayload = {
  id?: string;
  stopId?: string;
  label?: string;
  status?: "done" | "absent";
  at?: number;
  kilos?: number;
};

type TrackingPayload = {
  journeyId?: string;
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  nextStop?: string | null;
  completed?: number;
  done?: number;
  absent?: number;
  pending?: number;
  total?: number;
  kilos?: number;
  routeKm?: number;
  baselineRouteKm?: number;
  routeSavingsKm?: number;
  plannedDriveMinutes?: number;
  actualKm?: number;
  movingMinutes?: number;
  stoppedMinutes?: number;
  estimatedMinutes?: number;
  startedAt?: number | null;
  activity?: ActivityPayload[];
  status?: "active" | "paused" | "finished";
};

type ColumnDefinition = { name: string; sql: string };

const TRACKING_COLUMNS: ColumnDefinition[] = [
  { name: "done", sql: "INTEGER NOT NULL DEFAULT 0" },
  { name: "absent", sql: "INTEGER NOT NULL DEFAULT 0" },
  { name: "pending", sql: "INTEGER NOT NULL DEFAULT 41" },
  { name: "kilos", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "route_km", sql: "REAL" },
  { name: "estimated_minutes", sql: "INTEGER" },
  { name: "started_at", sql: "INTEGER" },
  { name: "actual_km", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "moving_minutes", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "stopped_minutes", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "baseline_route_km", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "route_savings_km", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "planned_drive_minutes", sql: "REAL NOT NULL DEFAULT 0" },
  { name: "activity_json", sql: "TEXT NOT NULL DEFAULT '[]'" },
  { name: "secure_payload", sql: "TEXT" },
];

const TRACKING_STALE_AFTER_MS = 60_000;
const JOURNEY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const PURPOSE = "live-tracking";

function currentJourneyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

function normalizeJourneyId(value: unknown) {
  return typeof value === "string" && JOURNEY_ID_PATTERN.test(value) ? value : currentJourneyId();
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return Math.max(0, Math.round(finiteNumber(value, fallback)));
}

function sanitizeActivities(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((entry): Array<Required<ActivityPayload>> => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as ActivityPayload;
    if (item.status !== "done" && item.status !== "absent") return [];
    const at = finiteNumber(item.at, 0);
    if (!at) return [];
    return [{
      id: typeof item.id === "string" ? item.id.slice(0, 80) : `event-${at}`,
      stopId: typeof item.stopId === "string" ? item.stopId.slice(0, 40) : "",
      label: typeof item.label === "string" ? item.label.slice(0, 180) : "Parada registrada",
      status: item.status,
      at,
      kilos: nonNegativeNumber(item.kilos),
    }];
  });
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function ensureTrackingTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS live_tracking (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed REAL,
      heading REAL,
      accuracy REAL,
      next_stop TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      absent INTEGER NOT NULL DEFAULT 0,
      pending INTEGER NOT NULL DEFAULT 41,
      total INTEGER NOT NULL DEFAULT 41,
      kilos REAL NOT NULL DEFAULT 0,
      route_km REAL,
      estimated_minutes INTEGER,
      started_at INTEGER,
      actual_km REAL NOT NULL DEFAULT 0,
      moving_minutes REAL NOT NULL DEFAULT 0,
      stopped_minutes REAL NOT NULL DEFAULT 0,
      baseline_route_km REAL NOT NULL DEFAULT 0,
      route_savings_km REAL NOT NULL DEFAULT 0,
      planned_drive_minutes REAL NOT NULL DEFAULT 0,
      activity_json TEXT NOT NULL DEFAULT '[]',
      secure_payload TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER NOT NULL
    )
  `).run();

  const tableInfo = await db.prepare("PRAGMA table_info(live_tracking)").all();
  const existingColumns = new Set(
    ((tableInfo.results ?? []) as Array<{ name?: string }>).map((column) => column.name).filter((name): name is string => Boolean(name)),
  );
  for (const column of TRACKING_COLUMNS) {
    if (!existingColumns.has(column.name)) {
      await db.prepare(`ALTER TABLE live_tracking ADD COLUMN ${column.name} ${column.sql}`).run();
    }
  }
}

function normalizedTracking(body: TrackingPayload, journeyId: string, updatedAt: number) {
  const total = nonNegativeInteger(body.total, 41);
  const requestedCompleted = nonNegativeInteger(body.completed, 0);
  const done = Math.min(total, nonNegativeInteger(body.done, requestedCompleted));
  const absent = Math.min(Math.max(0, total - done), nonNegativeInteger(body.absent, 0));
  const completed = Math.min(total, done + absent);
  const pending = Math.max(0, total - completed);
  const status = body.status === "finished" || body.status === "paused" ? body.status : "active";
  const activities = sanitizeActivities(body.activity);
  return {
    journey_id: journeyId,
    lat: body.lat,
    lng: body.lng,
    speed: nullableNumber(body.speed),
    heading: nullableNumber(body.heading),
    accuracy: nullableNumber(body.accuracy),
    next_stop: typeof body.nextStop === "string" ? body.nextStop.slice(0, 180) : null,
    completed,
    done,
    absent,
    pending,
    total,
    kilos: nonNegativeNumber(body.kilos),
    route_km: nonNegativeNumber(body.routeKm),
    baseline_route_km: nonNegativeNumber(body.baselineRouteKm),
    route_savings_km: nonNegativeNumber(body.routeSavingsKm),
    planned_drive_minutes: nonNegativeNumber(body.plannedDriveMinutes),
    actual_km: nonNegativeNumber(body.actualKm),
    moving_minutes: nonNegativeNumber(body.movingMinutes),
    stopped_minutes: nonNegativeNumber(body.stoppedMinutes),
    estimated_minutes: nonNegativeInteger(body.estimatedMinutes, 0),
    started_at: body.startedAt === null ? null : finiteNumber(body.startedAt, 0) || null,
    activity_json: JSON.stringify(activities),
    status,
    updated_at: updatedAt,
  };
}

function legacyTracking(row: Record<string, unknown>, journeyId: string) {
  return {
    journey_id: journeyId,
    lat: finiteNumber(row.lat, 0),
    lng: finiteNumber(row.lng, 0),
    speed: nullableNumber(row.speed),
    heading: nullableNumber(row.heading),
    accuracy: nullableNumber(row.accuracy),
    next_stop: typeof row.next_stop === "string" ? row.next_stop : null,
    completed: nonNegativeInteger(row.completed, 0),
    done: nonNegativeInteger(row.done, 0),
    absent: nonNegativeInteger(row.absent, 0),
    pending: nonNegativeInteger(row.pending, 0),
    total: nonNegativeInteger(row.total, 41),
    kilos: nonNegativeNumber(row.kilos),
    route_km: nonNegativeNumber(row.route_km),
    baseline_route_km: nonNegativeNumber(row.baseline_route_km),
    route_savings_km: nonNegativeNumber(row.route_savings_km),
    planned_drive_minutes: nonNegativeNumber(row.planned_drive_minutes),
    actual_km: nonNegativeNumber(row.actual_km),
    moving_minutes: nonNegativeNumber(row.moving_minutes),
    stopped_minutes: nonNegativeNumber(row.stopped_minutes),
    estimated_minutes: nonNegativeInteger(row.estimated_minutes, 0),
    started_at: nullableNumber(row.started_at),
    activity_json: typeof row.activity_json === "string" ? row.activity_json : "[]",
    status: typeof row.status === "string" ? row.status : "active",
    updated_at: finiteNumber(row.updated_at, Date.now()),
  };
}

async function storeEncryptedTracking(
  db: D1Database,
  journeyId: string,
  tracking: Record<string, unknown>,
  keyBase64: string,
) {
  const encrypted = await encryptJson(tracking, keyBase64, PURPOSE, journeyId);
  await db.prepare(`
    INSERT INTO live_tracking (id, lat, lng, status, updated_at, secure_payload)
    VALUES (?, 0, 0, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      lat=0, lng=0, speed=NULL, heading=NULL, accuracy=NULL, next_stop=NULL,
      completed=0, done=0, absent=0, pending=0, total=0, kilos=0,
      route_km=NULL, estimated_minutes=NULL, started_at=NULL, actual_km=0,
      moving_minutes=0, stopped_minutes=0, baseline_route_km=0,
      route_savings_km=0, planned_drive_minutes=0, activity_json='[]',
      secure_payload=excluded.secure_payload, status=excluded.status,
      updated_at=excluded.updated_at
  `).bind(
    journeyId,
    typeof tracking.status === "string" ? tracking.status : "active",
    finiteNumber(tracking.updated_at, Date.now()),
    JSON.stringify(encrypted),
  ).run();
}

export async function handleTracking(request: Request, db: D1Database, keyBase64: string) {
  await ensureTrackingTable(db);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const journeyId = normalizeJourneyId(url.searchParams.get("journey"));
    const row = await db.prepare("SELECT * FROM live_tracking WHERE id = ?").bind(journeyId).first<Record<string, unknown>>();
    if (!row) return noStoreJson({ tracking: null });
    const updatedAt = finiteNumber(row.updated_at, 0);
    if (Date.now() - updatedAt > TRACKING_STALE_AFTER_MS && row.status !== "finished") {
      return noStoreJson({ tracking: null, stale: true, lastUpdatedAt: updatedAt });
    }
    try {
      if (typeof row.secure_payload === "string") {
        const parsed = JSON.parse(row.secure_payload) as unknown;
        if (!isEncryptedEnvelope(parsed)) throw new Error("Seguimiento cifrado inválido");
        const tracking = await decryptJson<Record<string, unknown>>(parsed, keyBase64, PURPOSE, journeyId);
        return noStoreJson({ tracking });
      }
      const tracking = legacyTracking(row, journeyId);
      await storeEncryptedTracking(db, journeyId, tracking, keyBase64);
      return noStoreJson({ tracking });
    } catch (error) {
      console.error("No fue posible descifrar el seguimiento", error);
      return noStoreJson({ error: "No fue posible descifrar el seguimiento remoto." }, { status: 500 });
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: TrackingPayload;
  try {
    body = await request.json() as TrackingPayload;
  } catch {
    return noStoreJson({ error: "Datos inválidos" }, { status: 400 });
  }
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
    return noStoreJson({ error: "Ubicación inválida" }, { status: 400 });
  }

  const journeyId = normalizeJourneyId(body.journeyId);
  const updatedAt = Date.now();
  const tracking = normalizedTracking(body, journeyId, updatedAt);
  await storeEncryptedTracking(db, journeyId, tracking, keyBase64);
  return noStoreJson({ ok: true, journeyId, updatedAt });
}

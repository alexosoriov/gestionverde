import { encryptJson } from "./data-crypto";

const BATCH_SIZE = 50;

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function migrateJourneys(db: D1Database, keyBase64: string) {
  const rows = await db.prepare(`
    SELECT id, payload, client_updated_at, server_updated_at
    FROM journey_state
    WHERE json_valid(payload) = 1
      AND COALESCE(json_extract(payload, '$.v'), 0) <> 2
    ORDER BY server_updated_at ASC
    LIMIT ?
  `).bind(BATCH_SIZE).all<Record<string, unknown>>();

  for (const row of rows.results ?? []) {
    const id = typeof row.id === "string" ? row.id : "";
    const payload = typeof row.payload === "string" ? row.payload : "";
    if (!id || !payload) continue;
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      const encrypted = await encryptJson(parsed, keyBase64, "journey-state", id);
      await db.prepare(`
        UPDATE journey_state
        SET payload = ?, server_updated_at = ?
        WHERE id = ?
          AND json_valid(payload) = 1
          AND COALESCE(json_extract(payload, '$.v'), 0) <> 2
      `).bind(JSON.stringify(encrypted), Date.now(), id).run();
    } catch {
      // Un registro corrupto no debe impedir migrar los demás.
    }
  }
}

function legacyTracking(row: Record<string, unknown>, id: string) {
  return {
    journey_id: id,
    lat: finiteNumber(row.lat),
    lng: finiteNumber(row.lng),
    speed: nullableNumber(row.speed),
    heading: nullableNumber(row.heading),
    accuracy: nullableNumber(row.accuracy),
    next_stop: typeof row.next_stop === "string" ? row.next_stop : null,
    completed: finiteNumber(row.completed),
    done: finiteNumber(row.done),
    absent: finiteNumber(row.absent),
    pending: finiteNumber(row.pending),
    total: finiteNumber(row.total, 41),
    kilos: finiteNumber(row.kilos),
    route_km: finiteNumber(row.route_km),
    baseline_route_km: finiteNumber(row.baseline_route_km),
    route_savings_km: finiteNumber(row.route_savings_km),
    planned_drive_minutes: finiteNumber(row.planned_drive_minutes),
    actual_km: finiteNumber(row.actual_km),
    moving_minutes: finiteNumber(row.moving_minutes),
    stopped_minutes: finiteNumber(row.stopped_minutes),
    estimated_minutes: finiteNumber(row.estimated_minutes),
    started_at: nullableNumber(row.started_at),
    activity_json: typeof row.activity_json === "string" ? row.activity_json : "[]",
    status: typeof row.status === "string" ? row.status : "active",
    updated_at: finiteNumber(row.updated_at, Date.now()),
  };
}

async function migrateTracking(db: D1Database, keyBase64: string) {
  const rows = await db.prepare(`
    SELECT * FROM live_tracking
    WHERE secure_payload IS NULL
    ORDER BY updated_at ASC
    LIMIT ?
  `).bind(BATCH_SIZE).all<Record<string, unknown>>();

  for (const row of rows.results ?? []) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const tracking = legacyTracking(row, id);
    const encrypted = await encryptJson(tracking, keyBase64, "live-tracking", id);
    await db.prepare(`
      UPDATE live_tracking SET
        lat=0, lng=0, speed=NULL, heading=NULL, accuracy=NULL, next_stop=NULL,
        completed=0, done=0, absent=0, pending=0, total=0, kilos=0,
        route_km=NULL, estimated_minutes=NULL, started_at=NULL, actual_km=0,
        moving_minutes=0, stopped_minutes=0, baseline_route_km=0,
        route_savings_km=0, planned_drive_minutes=0, activity_json='[]',
        secure_payload=?
      WHERE id=? AND secure_payload IS NULL
    `).bind(JSON.stringify(encrypted), id).run();
  }
}

export async function migrateLegacyOperationalData(db: D1Database, keyBase64: string) {
  await Promise.allSettled([
    migrateJourneys(db, keyBase64),
    migrateTracking(db, keyBase64),
  ]);
}

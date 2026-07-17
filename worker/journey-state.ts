import type { JourneySnapshot } from "../app/journey-types";
import { decryptJson, encryptJson, isEncryptedEnvelope } from "./data-crypto";
import { mergeJourneySnapshots } from "./journey-merge";

type JourneyPayload = {
  journeyId?: string;
  snapshot?: unknown;
};

const JOURNEY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_JOURNEY_BYTES = 320_000;
const MAX_REVISIONS = 30;
const PURPOSE = "journey-state";
const REVISION_PURPOSE = "journey-revision";

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

function clientTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : Date.now();
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function asJourneySnapshot(value: unknown, journeyId: string): JourneySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<JourneySnapshot>;
  if (!source.statuses || !source.details || !Array.isArray(source.customStops) || !Array.isArray(source.activity)) return null;
  return {
    ...source,
    version: 4,
    journeyId,
    statuses: source.statuses,
    details: source.details,
    customStops: source.customStops,
    reverse: Boolean(source.reverse),
    optimizedIds: Array.isArray(source.optimizedIds) ? source.optimizedIds : [],
    startedAt: typeof source.startedAt === "number" ? source.startedAt : null,
    completedAt: typeof source.completedAt === "number" ? source.completedAt : null,
    activity: source.activity,
    vehicle: typeof source.vehicle === "string" ? source.vehicle : "Camioneta",
    lastPosition: source.lastPosition && typeof source.lastPosition === "object" ? source.lastPosition : null,
    gpsMetrics: source.gpsMetrics && typeof source.gpsMetrics === "object"
      ? source.gpsMetrics
      : { actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 },
    updatedAt: clientTimestamp(source.updatedAt),
  } as JourneySnapshot;
}

async function ensureTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS journey_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      client_updated_at INTEGER NOT NULL,
      server_updated_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS journey_state_revisions (
      journey_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      server_updated_at INTEGER NOT NULL,
      PRIMARY KEY (journey_id, revision)
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_journey_revisions_recent
    ON journey_state_revisions (journey_id, revision DESC)
  `).run();
}

async function decryptStoredPayload(payload: string, journeyId: string, keyBase64: string) {
  const parsed = JSON.parse(payload) as unknown;
  if (isEncryptedEnvelope(parsed)) {
    return decryptJson<Record<string, unknown>>(parsed, keyBase64, PURPOSE, journeyId);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Jornada almacenada inválida");
  return parsed as Record<string, unknown>;
}

async function decryptRevisionPayload(payload: string, journeyId: string, revision: number, keyBase64: string) {
  const parsed = JSON.parse(payload) as unknown;
  if (!isEncryptedEnvelope(parsed)) throw new Error("Revisión sin cifrado");
  return decryptJson<Record<string, unknown>>(parsed, keyBase64, REVISION_PURPOSE, `${journeyId}:${revision}`);
}

async function storeEncryptedSnapshot(
  db: D1Database,
  journeyId: string,
  snapshot: JourneySnapshot,
  keyBase64: string,
  clientUpdatedAt: number,
  serverUpdatedAt: number,
) {
  const encrypted = await encryptJson(snapshot, keyBase64, PURPOSE, journeyId);
  await db.prepare(`
    INSERT INTO journey_state (id, payload, client_updated_at, server_updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload=excluded.payload,
      client_updated_at=excluded.client_updated_at,
      server_updated_at=excluded.server_updated_at
  `).bind(journeyId, JSON.stringify(encrypted), clientUpdatedAt, serverUpdatedAt).run();
}

async function storeEncryptedRevision(
  db: D1Database,
  journeyId: string,
  revision: number,
  snapshot: JourneySnapshot,
  keyBase64: string,
  serverUpdatedAt: number,
) {
  const encrypted = await encryptJson(snapshot, keyBase64, REVISION_PURPOSE, `${journeyId}:${revision}`);
  await db.prepare(`
    INSERT OR REPLACE INTO journey_state_revisions (journey_id, revision, payload, server_updated_at)
    VALUES (?, ?, ?, ?)
  `).bind(journeyId, revision, JSON.stringify(encrypted), serverUpdatedAt).run();
  await db.prepare(`
    DELETE FROM journey_state_revisions
    WHERE journey_id = ? AND revision NOT IN (
      SELECT revision FROM journey_state_revisions
      WHERE journey_id = ? ORDER BY revision DESC LIMIT ?
    )
  `).bind(journeyId, journeyId, MAX_REVISIONS).run();
}

async function readCurrentSnapshot(db: D1Database, journeyId: string, keyBase64: string) {
  const row = await db.prepare("SELECT payload, client_updated_at, server_updated_at FROM journey_state WHERE id = ?")
    .bind(journeyId)
    .first<{ payload?: string; client_updated_at?: number; server_updated_at?: number }>();
  if (!row?.payload) return { snapshot: null, row };
  const decrypted = await decryptStoredPayload(row.payload, journeyId, keyBase64);
  return { snapshot: asJourneySnapshot(decrypted, journeyId), row };
}

async function listRevisions(db: D1Database, journeyId: string) {
  const result = await db.prepare(`
    SELECT revision, server_updated_at
    FROM journey_state_revisions
    WHERE journey_id = ?
    ORDER BY revision DESC
    LIMIT ?
  `).bind(journeyId, MAX_REVISIONS).all<{ revision?: number; server_updated_at?: number }>();
  return (result.results ?? []).flatMap((row) =>
    typeof row.revision === "number"
      ? [{ revision: row.revision, serverUpdatedAt: row.server_updated_at ?? 0 }]
      : [],
  );
}

export async function handleJourneyState(request: Request, db: D1Database, keyBase64: string) {
  await ensureTables(db);
  const url = new URL(request.url);
  const journeyId = normalizeJourneyId(url.searchParams.get("journey"));

  if (request.method === "GET" && url.searchParams.get("history") === "1") {
    return noStoreJson({ journeyId, revisions: await listRevisions(db, journeyId) });
  }

  if (request.method === "GET" && url.searchParams.has("revision")) {
    const revision = Number(url.searchParams.get("revision"));
    if (!Number.isInteger(revision) || revision < 1) return noStoreJson({ error: "Revisión inválida" }, { status: 400 });
    const row = await db.prepare(`
      SELECT payload, server_updated_at FROM journey_state_revisions
      WHERE journey_id = ? AND revision = ?
    `).bind(journeyId, revision).first<{ payload?: string; server_updated_at?: number }>();
    if (!row?.payload) return noStoreJson({ error: "Revisión no encontrada" }, { status: 404 });
    try {
      const snapshot = asJourneySnapshot(await decryptRevisionPayload(row.payload, journeyId, revision, keyBase64), journeyId);
      return noStoreJson({ journeyId, revision, serverUpdatedAt: row.server_updated_at ?? 0, snapshot });
    } catch (error) {
      console.error("No fue posible descifrar la revisión", error);
      return noStoreJson({ error: "No fue posible recuperar la revisión." }, { status: 500 });
    }
  }

  if (request.method === "GET") {
    try {
      const { snapshot, row } = await readCurrentSnapshot(db, journeyId, keyBase64);
      if (!snapshot) return noStoreJson({ snapshot: null });
      const parsedStored = row?.payload ? JSON.parse(row.payload) as unknown : null;
      if (row?.payload && !isEncryptedEnvelope(parsedStored)) {
        await storeEncryptedSnapshot(
          db,
          journeyId,
          snapshot,
          keyBase64,
          row.client_updated_at ?? snapshot.updatedAt,
          Date.now(),
        );
      }
      return noStoreJson({ snapshot, revision: snapshot.sync?.serverRevision ?? 0 });
    } catch (error) {
      console.error("No fue posible descifrar la jornada", error);
      return noStoreJson({ error: "No fue posible descifrar la jornada guardada." }, { status: 500 });
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: JourneyPayload;
  try {
    body = await request.json() as JourneyPayload;
  } catch {
    return noStoreJson({ error: "Jornada inválida" }, { status: 400 });
  }

  if (!body.snapshot || typeof body.snapshot !== "object") {
    return noStoreJson({ error: "Falta el estado de la jornada" }, { status: 400 });
  }

  const bodyJourneyId = normalizeJourneyId(body.journeyId ?? (body.snapshot as Record<string, unknown>).journeyId);
  const incoming = asJourneySnapshot(body.snapshot, bodyJourneyId);
  if (!incoming) return noStoreJson({ error: "Estado de jornada incompleto" }, { status: 400 });

  try {
    const { snapshot: existing } = await readCurrentSnapshot(db, bodyJourneyId, keyBase64);
    const result = mergeJourneySnapshots(existing, incoming);
    const plaintext = JSON.stringify(result.snapshot);
    if (new TextEncoder().encode(plaintext).byteLength > MAX_JOURNEY_BYTES) {
      return noStoreJson({ error: "La jornada es demasiado grande" }, { status: 413 });
    }

    const serverUpdatedAt = Date.now();
    const revision = result.snapshot.sync?.serverRevision ?? 1;
    await storeEncryptedSnapshot(db, bodyJourneyId, result.snapshot, keyBase64, incoming.updatedAt, serverUpdatedAt);
    await storeEncryptedRevision(db, bodyJourneyId, revision, result.snapshot, keyBase64, serverUpdatedAt);

    return noStoreJson({
      ok: true,
      journeyId: bodyJourneyId,
      updatedAt: serverUpdatedAt,
      revision,
      merged: result.merged,
      snapshot: result.snapshot,
    });
  } catch (error) {
    console.error("No fue posible guardar la jornada cifrada", error);
    return noStoreJson({ error: "No fue posible guardar la jornada." }, { status: 500 });
  }
}

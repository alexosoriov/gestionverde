import { decryptJson, encryptJson, isEncryptedEnvelope } from "./data-crypto";

type PrivateStop = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  note?: string;
  day?: string;
  lat: number;
  lng: number;
  km: number;
};

const PURPOSE = "private-route-catalog";
const RECORD_ID = "active";
const MAX_STOPS = 500;
const MAX_PAYLOAD_BYTES = 1_000_000;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function finite(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStop(value: unknown, index: number): PrivateStop | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const name = text(source.name, 160);
  const address = text(source.address, 200);
  const phone = text(source.phone, 40);
  const note = text(source.note, 500);
  const day = text(source.day, 30) || "Viernes";
  const lat = finite(source.lat);
  const lng = finite(source.lng);
  const km = finite(source.km);
  if (!name || !address || lat === null || lng === null || km === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || km < 0) return null;
  return {
    id: text(source.id, 80) || String(index + 1).padStart(2, "0"),
    name,
    address,
    ...(phone ? { phone } : {}),
    ...(note ? { note } : {}),
    day,
    lat,
    lng,
    km,
  };
}

export function normalizePrivateRoute(value: unknown): PrivateStop[] | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const input = Array.isArray(value) ? value : source && Array.isArray(source.stops) ? source.stops : null;
  if (!input || input.length < 1 || input.length > MAX_STOPS) return null;
  const stops = input.map(normalizeStop);
  if (stops.some((stop) => !stop)) return null;
  const normalized = stops as PrivateStop[];
  const ids = new Set(normalized.map((stop) => stop.id));
  if (ids.size !== normalized.length) return null;
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_PAYLOAD_BYTES) return null;
  return normalized;
}

async function ensureTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS route_catalog (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

export async function readStoredPrivateRoute(db: D1Database, keyBase64: string) {
  await ensureTable(db);
  const row = await db.prepare("SELECT payload, updated_at FROM route_catalog WHERE id = ?")
    .bind(RECORD_ID)
    .first<{ payload?: string; updated_at?: number }>();
  if (!row?.payload) return null;
  const parsed = JSON.parse(row.payload) as unknown;
  if (!isEncryptedEnvelope(parsed)) throw new Error("El catálogo privado no está cifrado.");
  const decrypted = await decryptJson<unknown>(parsed, keyBase64, PURPOSE, RECORD_ID);
  const stops = normalizePrivateRoute(decrypted);
  if (!stops) throw new Error("El catálogo privado guardado es inválido.");
  return { stops, updatedAt: row.updated_at ?? 0 };
}

export async function storePrivateRoute(db: D1Database, keyBase64: string, value: unknown) {
  await ensureTable(db);
  const stops = normalizePrivateRoute(value);
  if (!stops) throw new Error("El listado de viviendas no tiene un formato válido.");
  const updatedAt = Date.now();
  const encrypted = await encryptJson({ version: 1, stops }, keyBase64, PURPOSE, RECORD_ID);
  await db.prepare(`
    INSERT INTO route_catalog (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload=excluded.payload,
      updated_at=excluded.updated_at
  `).bind(RECORD_ID, JSON.stringify(encrypted), updatedAt).run();
  return { stops, updatedAt };
}

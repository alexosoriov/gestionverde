import { decryptJson, encryptJson, isEncryptedEnvelope } from "./data-crypto";

type DiagnosticPayload = {
  type?: unknown;
  message?: unknown;
  stack?: unknown;
  path?: unknown;
  userAgent?: unknown;
  online?: unknown;
  deviceId?: unknown;
  appVersion?: unknown;
  occurredAt?: unknown;
};

const PURPOSE = "client-diagnostic";
const MAX_DIAGNOSTIC_BYTES = 12_000;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function text(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function sanitize(value: DiagnosticPayload) {
  return {
    type: text(value.type, 80, "error"),
    message: text(value.message, 500, "Error sin mensaje"),
    stack: text(value.stack, 4_000),
    path: text(value.path, 300),
    userAgent: text(value.userAgent, 400),
    online: typeof value.online === "boolean" ? value.online : null,
    deviceId: text(value.deviceId, 120, "unknown-device"),
    appVersion: text(value.appVersion, 80, "unknown"),
    occurredAt: typeof value.occurredAt === "number" && Number.isFinite(value.occurredAt)
      ? Math.round(value.occurredAt)
      : Date.now(),
  };
}

async function ensureTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS client_diagnostics (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      secure_payload TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_client_diagnostics_recent
    ON client_diagnostics (created_at DESC)
  `).run();
}

export async function handleDiagnostics(request: Request, db: D1Database, keyBase64: string) {
  await ensureTable(db);

  if (request.method === "POST") {
    let raw: DiagnosticPayload;
    try {
      raw = await request.json() as DiagnosticPayload;
    } catch {
      return noStoreJson({ error: "Diagnóstico inválido" }, { status: 400 });
    }
    const payload = sanitize(raw);
    const plaintext = JSON.stringify(payload);
    if (new TextEncoder().encode(plaintext).byteLength > MAX_DIAGNOSTIC_BYTES) {
      return noStoreJson({ error: "Diagnóstico demasiado grande" }, { status: 413 });
    }
    const id = crypto.randomUUID();
    const encrypted = await encryptJson(payload, keyBase64, PURPOSE, id);
    await db.prepare(`
      INSERT INTO client_diagnostics (id, severity, created_at, secure_payload)
      VALUES (?, ?, ?, ?)
    `).bind(id, payload.type === "warning" ? "warning" : "error", Date.now(), JSON.stringify(encrypted)).run();
    return noStoreJson({ ok: true, id }, { status: 201 });
  }

  if (request.method === "GET") {
    const rows = await db.prepare(`
      SELECT id, severity, created_at, secure_payload
      FROM client_diagnostics
      ORDER BY created_at DESC
      LIMIT 50
    `).all<{ id?: string; severity?: string; created_at?: number; secure_payload?: string }>();
    const diagnostics = [];
    for (const row of rows.results ?? []) {
      if (!row.id || !row.secure_payload) continue;
      try {
        const parsed = JSON.parse(row.secure_payload) as unknown;
        if (!isEncryptedEnvelope(parsed)) continue;
        const payload = await decryptJson<Record<string, unknown>>(parsed, keyBase64, PURPOSE, row.id);
        diagnostics.push({ id: row.id, severity: row.severity ?? "error", createdAt: row.created_at ?? 0, ...payload });
      } catch {
        diagnostics.push({ id: row.id, severity: row.severity ?? "error", createdAt: row.created_at ?? 0, message: "Registro no recuperable" });
      }
    }
    return noStoreJson({ diagnostics });
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM client_diagnostics WHERE created_at < ?")
      .bind(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .run();
    return noStoreJson({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

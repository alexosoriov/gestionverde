type JsonRecord = Record<string, unknown>;

type CleanStop = {
  id: string;
  name: string;
  address?: string;
  day: string;
  lat: number;
  lng: number;
  km: number;
};

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || null : null;
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  try {
    const body = await request.json() as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? body as JsonRecord : null;
  } catch {
    return null;
  }
}

async function ensureRouteTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gestionverde_routes (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

async function ensureTrackingTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gestionverde_tracking (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

async function ensureJourneyTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gestionverde_journeys (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      client_updated_at INTEGER NOT NULL,
      server_updated_at INTEGER NOT NULL
    )
  `).run();
}

async function ensureDiagnosticsTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS gestionverde_diagnostics (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
}

function normalizeStop(value: unknown, index: number): CleanStop | null {
  if (!value || typeof value !== "object") return null;
  const stop = value as JsonRecord;
  const lat = finiteNumber(stop.lat, Number.NaN);
  const lng = finiteNumber(stop.lng, Number.NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const id = optionalText(stop.id, 80) ?? `stop-${index + 1}`;
  const name = optionalText(stop.name, 160) ?? `Vivienda ${index + 1}`;
  const address = optionalText(stop.address, 240) ?? undefined;
  const day = optionalText(stop.day, 40) ?? "Viernes";
  return {
    id,
    name,
    address,
    day,
    lat,
    lng,
    km: Math.max(0, finiteNumber(stop.km, index)),
  };
}

export async function handleCleanRoute(request: Request, db: D1Database) {
  await ensureRouteTable(db);

  if (request.method === "GET" || request.method === "HEAD") {
    const row = await db.prepare("SELECT payload, updated_at FROM gestionverde_routes WHERE id = ?")
      .bind("current")
      .first<{ payload?: string; updated_at?: number }>();
    if (!row?.payload) return noStoreJson({ stops: [], source: "empty", updatedAt: null });
    try {
      return noStoreJson({
        stops: JSON.parse(row.payload),
        source: "database",
        updatedAt: row.updated_at ?? null,
      });
    } catch {
      return noStoreJson({ error: "El recorrido guardado no contiene JSON válido." }, { status: 500 });
    }
  }

  if (request.method === "POST" || request.method === "PUT") {
    let unknownBody: unknown;
    try {
      unknownBody = await request.json();
    } catch {
      return noStoreJson({ error: "El archivo enviado no contiene JSON válido." }, { status: 400 });
    }
    const input = Array.isArray(unknownBody)
      ? unknownBody
      : unknownBody && typeof unknownBody === "object" && Array.isArray((unknownBody as JsonRecord).stops)
        ? (unknownBody as JsonRecord).stops as unknown[]
        : null;
    if (!input || input.length === 0 || input.length > 500) {
      return noStoreJson({ error: "El recorrido debe contener entre 1 y 500 viviendas." }, { status: 400 });
    }
    const stops = input.map(normalizeStop);
    if (stops.some((stop) => stop === null)) {
      return noStoreJson({ error: "Una o más viviendas tienen coordenadas o datos inválidos." }, { status: 400 });
    }
    const cleanStops = stops as CleanStop[];
    const ids = new Set(cleanStops.map((stop) => stop.id));
    if (ids.size !== cleanStops.length) {
      return noStoreJson({ error: "Cada vivienda debe tener un identificador único." }, { status: 400 });
    }
    const updatedAt = Date.now();
    await db.prepare(`
      INSERT INTO gestionverde_routes (id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `).bind("current", JSON.stringify(cleanStops), updatedAt).run();
    return noStoreJson({ ok: true, total: cleanStops.length, updatedAt });
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM gestionverde_routes WHERE id = ?").bind("current").run();
    return noStoreJson({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

function normalizeActivity(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as JsonRecord;
    const status = item.status === "done" || item.status === "absent" ? item.status : null;
    const at = optionalNumber(item.at);
    if (!status || at === null) return [];
    return [{
      id: optionalText(item.id, 100) ?? `event-${at}`,
      stopId: optionalText(item.stopId, 100) ?? "",
      label: optionalText(item.label, 240) ?? "Vivienda registrada",
      status,
      at,
      kilos: Math.max(0, finiteNumber(item.kilos)),
    }];
  });
}

function normalizeTracking(body: JsonRecord) {
  const lat = finiteNumber(body.lat, Number.NaN);
  const lng = finiteNumber(body.lng, Number.NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error("Ubicación GPS inválida.");
  }
  const activity = Array.isArray(body.activity)
    ? normalizeActivity(body.activity)
    : typeof body.activity_json === "string"
      ? (() => {
          try { return normalizeActivity(JSON.parse(body.activity_json)); } catch { return []; }
        })()
      : [];
  const done = Math.max(0, Math.round(finiteNumber(body.done ?? body.completed)));
  const absent = Math.max(0, Math.round(finiteNumber(body.absent)));
  const total = Math.max(done + absent, Math.round(finiteNumber(body.total)));
  const pending = Math.max(0, Math.round(finiteNumber(body.pending, total - done - absent)));
  return {
    lat,
    lng,
    speed: optionalNumber(body.speed),
    heading: optionalNumber(body.heading),
    accuracy: optionalNumber(body.accuracy),
    next_stop: optionalText(body.nextStop ?? body.next_stop, 240),
    completed: done + absent,
    done,
    absent,
    pending,
    total,
    kilos: Math.max(0, finiteNumber(body.kilos)),
    route_km: Math.max(0, finiteNumber(body.routeKm ?? body.route_km)),
    baseline_route_km: Math.max(0, finiteNumber(body.baselineRouteKm ?? body.baseline_route_km)),
    route_savings_km: Math.max(0, finiteNumber(body.routeSavingsKm ?? body.route_savings_km)),
    planned_drive_minutes: Math.max(0, finiteNumber(body.plannedDriveMinutes ?? body.planned_drive_minutes)),
    actual_km: Math.max(0, finiteNumber(body.actualKm ?? body.actual_km)),
    moving_minutes: Math.max(0, finiteNumber(body.movingMinutes ?? body.moving_minutes)),
    stopped_minutes: Math.max(0, finiteNumber(body.stoppedMinutes ?? body.stopped_minutes)),
    estimated_minutes: Math.max(0, finiteNumber(body.estimatedMinutes ?? body.estimated_minutes)),
    started_at: optionalNumber(body.startedAt ?? body.started_at),
    activity_json: JSON.stringify(activity),
    status: optionalText(body.status, 30) ?? "active",
    updated_at: Date.now(),
  };
}

export async function handleCleanTracking(request: Request, db: D1Database) {
  await ensureTrackingTable(db);

  if (request.method === "GET" || request.method === "HEAD") {
    const row = await db.prepare("SELECT payload, updated_at FROM gestionverde_tracking WHERE id = ?")
      .bind("current")
      .first<{ payload?: string; updated_at?: number }>();
    if (!row?.payload) return noStoreJson({ tracking: null });
    try {
      const tracking = JSON.parse(row.payload) as JsonRecord;
      tracking.updated_at = row.updated_at ?? tracking.updated_at ?? Date.now();
      return noStoreJson({ tracking });
    } catch {
      return noStoreJson({ error: "El seguimiento guardado está dañado." }, { status: 500 });
    }
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body) return noStoreJson({ error: "Seguimiento inválido." }, { status: 400 });
    let tracking: ReturnType<typeof normalizeTracking>;
    try {
      tracking = normalizeTracking(body);
    } catch (error) {
      return noStoreJson({ error: error instanceof Error ? error.message : "Seguimiento inválido." }, { status: 400 });
    }
    await db.prepare(`
      INSERT INTO gestionverde_tracking (id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `).bind("current", JSON.stringify(tracking), tracking.updated_at).run();
    return noStoreJson({ ok: true, updatedAt: tracking.updated_at });
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM gestionverde_tracking WHERE id = ?").bind("current").run();
    return noStoreJson({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

function journeyIdFrom(request: Request, body?: JsonRecord | null) {
  const fromQuery = new URL(request.url).searchParams.get("journeyId");
  return optionalText(body?.journeyId ?? fromQuery, 100) ?? "current";
}

export async function handleCleanJourney(request: Request, db: D1Database) {
  await ensureJourneyTable(db);

  if (request.method === "GET" || request.method === "HEAD") {
    const journeyId = journeyIdFrom(request);
    const row = await db.prepare(`
      SELECT payload, client_updated_at, server_updated_at
      FROM gestionverde_journeys WHERE id = ?
    `).bind(journeyId).first<{ payload?: string; client_updated_at?: number; server_updated_at?: number }>();
    if (!row?.payload) return noStoreJson({ snapshot: null, serverUpdatedAt: null });
    try {
      return noStoreJson({
        snapshot: JSON.parse(row.payload),
        clientUpdatedAt: row.client_updated_at ?? null,
        serverUpdatedAt: row.server_updated_at ?? null,
      });
    } catch {
      return noStoreJson({ error: "La jornada guardada está dañada." }, { status: 500 });
    }
  }

  if (request.method === "POST" || request.method === "PUT") {
    const body = await readJson(request);
    if (!body) return noStoreJson({ error: "Jornada inválida." }, { status: 400 });
    const journeyId = journeyIdFrom(request, body);
    const snapshot = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : body;
    const payload = JSON.stringify(snapshot);
    if (payload.length > 1_500_000) return noStoreJson({ error: "La jornada supera el tamaño permitido." }, { status: 413 });
    const clientUpdatedAt = Math.max(0, finiteNumber(body.clientUpdatedAt ?? body.updatedAt, Date.now()));
    const serverUpdatedAt = Date.now();
    const current = await db.prepare("SELECT client_updated_at FROM gestionverde_journeys WHERE id = ?")
      .bind(journeyId)
      .first<{ client_updated_at?: number }>();
    if ((current?.client_updated_at ?? 0) > clientUpdatedAt) {
      return noStoreJson({ ok: false, conflict: true, serverUpdatedAt }, { status: 409 });
    }
    await db.prepare(`
      INSERT INTO gestionverde_journeys (id, payload, client_updated_at, server_updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload=excluded.payload,
        client_updated_at=excluded.client_updated_at,
        server_updated_at=excluded.server_updated_at
    `).bind(journeyId, payload, clientUpdatedAt, serverUpdatedAt).run();
    return noStoreJson({ ok: true, serverUpdatedAt });
  }

  if (request.method === "DELETE") {
    const journeyId = journeyIdFrom(request);
    await db.prepare("DELETE FROM gestionverde_journeys WHERE id = ?").bind(journeyId).run();
    return noStoreJson({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

export async function handleCleanDiagnostics(request: Request, db: D1Database) {
  await ensureDiagnosticsTable(db);

  if (request.method === "POST") {
    const body = await readJson(request);
    if (!body) return noStoreJson({ error: "Diagnóstico inválido." }, { status: 400 });
    const payload = JSON.stringify(body);
    if (payload.length > 250_000) return noStoreJson({ error: "Diagnóstico demasiado grande." }, { status: 413 });
    const createdAt = Date.now();
    await db.prepare("INSERT INTO gestionverde_diagnostics (id, payload, created_at) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), payload, createdAt)
      .run();
    await db.prepare(`
      DELETE FROM gestionverde_diagnostics
      WHERE id NOT IN (
        SELECT id FROM gestionverde_diagnostics ORDER BY created_at DESC LIMIT 30
      )
    `).run();
    return noStoreJson({ ok: true, createdAt });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const result = await db.prepare(`
      SELECT id, payload, created_at
      FROM gestionverde_diagnostics
      ORDER BY created_at DESC
      LIMIT 30
    `).all<{ id?: string; payload?: string; created_at?: number }>();
    const diagnostics = (result.results ?? []).flatMap((row) => {
      if (!row.id || !row.payload) return [];
      try {
        return [{ id: row.id, createdAt: row.created_at ?? 0, data: JSON.parse(row.payload) }];
      } catch {
        return [];
      }
    });
    return noStoreJson({ diagnostics });
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM gestionverde_diagnostics").run();
    return noStoreJson({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
}

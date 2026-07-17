import type {
  AuditEntry,
  ChangeStamp,
  JourneySnapshot,
  SyncMetadata,
} from "./journey-types";

const DEVICE_KEY = "ruta-verde-device-id";
const SEQUENCE_KEY = "ruta-verde-device-sequence";
const MAX_AUDIT_ENTRIES = 400;
const GLOBAL_FIELDS = [
  "reverse",
  "optimizedIds",
  "startedAt",
  "completedAt",
  "activity",
  "vehicle",
  "lastPosition",
  "gpsMetrics",
  "routeId",
  "sector",
  "driverId",
] as const;

type GlobalField = (typeof GLOBAL_FIELDS)[number];

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const generated = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function nextSequence(previous = 0) {
  try {
    const stored = Number(localStorage.getItem(SEQUENCE_KEY) || 0);
    const sequence = Math.max(previous, Number.isFinite(stored) ? stored : 0) + 1;
    localStorage.setItem(SEQUENCE_KEY, String(sequence));
    return sequence;
  } catch {
    return previous + 1;
  }
}

function validStamp(value: unknown): ChangeStamp | null {
  if (!value || typeof value !== "object") return null;
  const stamp = value as Partial<ChangeStamp>;
  if (typeof stamp.at !== "number" || !Number.isFinite(stamp.at)) return null;
  return {
    at: stamp.at,
    deviceId: typeof stamp.deviceId === "string" ? stamp.deviceId : "legacy-device",
    sequence: typeof stamp.sequence === "number" && Number.isFinite(stamp.sequence)
      ? Math.max(0, Math.round(stamp.sequence))
      : 0,
  };
}

function normalizeClockMap(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return [[key, { at: raw, deviceId: "legacy-device", sequence: 0 } satisfies ChangeStamp]];
      }
      const stamp = validStamp(raw);
      return stamp ? [[key, stamp]] : [];
    }),
  );
}

export function normalizeSyncMetadata(value: unknown): SyncMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<SyncMetadata> & {
    statusUpdatedAt?: unknown;
    detailUpdatedAt?: unknown;
    customStopUpdatedAt?: unknown;
    globalUpdatedAt?: unknown;
  };
  return {
    deviceId: typeof source.deviceId === "string" ? source.deviceId : "legacy-device",
    serverRevision: typeof source.serverRevision === "number" && Number.isFinite(source.serverRevision)
      ? Math.max(0, Math.round(source.serverRevision))
      : 0,
    localSequence: typeof source.localSequence === "number" && Number.isFinite(source.localSequence)
      ? Math.max(0, Math.round(source.localSequence))
      : 0,
    statusClocks: normalizeClockMap(source.statusClocks ?? source.statusUpdatedAt),
    detailClocks: normalizeClockMap(source.detailClocks ?? source.detailUpdatedAt),
    customStopClocks: normalizeClockMap(source.customStopClocks ?? source.customStopUpdatedAt),
    globalClocks: normalizeClockMap(source.globalClocks ?? source.globalUpdatedAt),
  };
}

export function normalizeAuditTrail(value: unknown): AuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): AuditEntry[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Partial<AuditEntry>;
    if (typeof item.id !== "string" || typeof item.at !== "number" || typeof item.action !== "string") return [];
    if (item.scope !== "status" && item.scope !== "detail" && item.scope !== "custom-stop" && item.scope !== "journey" && item.scope !== "system") return [];
    return [{
      id: item.id.slice(0, 180),
      at: item.at,
      deviceId: typeof item.deviceId === "string" ? item.deviceId.slice(0, 100) : "legacy-device",
      scope: item.scope,
      targetId: typeof item.targetId === "string" ? item.targetId.slice(0, 100) : undefined,
      action: item.action.slice(0, 100),
      from: typeof item.from === "string" ? item.from.slice(0, 120) : undefined,
      to: typeof item.to === "string" ? item.to.slice(0, 120) : undefined,
    }];
  }).slice(-MAX_AUDIT_ENTRIES);
}

function stamp(at: number, deviceId: string, sequence: number): ChangeStamp {
  return { at, deviceId, sequence };
}

function mapClocks(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  previousClocks: Record<string, ChangeStamp>,
  currentStamp: ChangeStamp,
) {
  const result: Record<string, ChangeStamp> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  for (const key of keys) {
    result[key] = equalValue(current[key], previous[key])
      ? previousClocks[key] ?? currentStamp
      : currentStamp;
  }
  return result;
}

function customStopMap(snapshot: JourneySnapshot) {
  return Object.fromEntries(snapshot.customStops.map((stop) => [stop.id, stop]));
}

function auditId(deviceId: string, sequence: number, scope: string, target: string) {
  return `${deviceId}:${sequence}:${scope}:${target}`;
}

function shortValue(value: unknown) {
  if (value === undefined) return "eliminado";
  if (value === null) return "sin valor";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).slice(0, 120);
  return "actualizado";
}

function appendAudit(
  entries: AuditEntry[],
  deviceId: string,
  sequence: number,
  at: number,
  scope: AuditEntry["scope"],
  targetId: string,
  action: string,
  from?: unknown,
  to?: unknown,
) {
  entries.push({
    id: auditId(deviceId, sequence, scope, targetId),
    at,
    deviceId,
    scope,
    targetId,
    action,
    from: from === undefined ? undefined : shortValue(from),
    to: to === undefined ? undefined : shortValue(to),
  });
}

function stateSignature(snapshot: JourneySnapshot) {
  return JSON.stringify({
    statuses: snapshot.statuses,
    details: snapshot.details,
    customStops: snapshot.customStops,
    reverse: snapshot.reverse,
    optimizedIds: snapshot.optimizedIds,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    activity: snapshot.activity,
    vehicle: snapshot.vehicle,
    lastPosition: snapshot.lastPosition,
    gpsMetrics: snapshot.gpsMetrics,
    routeId: snapshot.routeId,
    sector: snapshot.sector,
    driverId: snapshot.driverId,
  });
}

export function journeyStateSignature(snapshot: JourneySnapshot) {
  return stateSignature(snapshot);
}

export function withSyncMetadata(snapshot: JourneySnapshot, previous: JourneySnapshot | null): JourneySnapshot {
  if (previous && stateSignature(snapshot) === stateSignature(previous) && previous.sync) {
    return {
      ...snapshot,
      sync: previous.sync,
      auditTrail: normalizeAuditTrail(previous.auditTrail),
    };
  }

  const now = snapshot.updatedAt;
  const deviceId = stableDeviceId();
  const previousSync = normalizeSyncMetadata(previous?.sync);
  const sequence = nextSequence(previousSync?.localSequence ?? 0);
  const currentStamp = stamp(now, deviceId, sequence);
  const previousStatuses = previous?.statuses ?? {};
  const previousDetails = previous?.details ?? {};
  const currentStops = customStopMap(snapshot);
  const previousStops = previous ? customStopMap(previous) : {};
  const audit = normalizeAuditTrail(previous?.auditTrail);

  const recordChanges = (
    scope: "status" | "detail" | "custom-stop",
    current: Record<string, unknown>,
    old: Record<string, unknown>,
  ) => {
    for (const key of new Set([...Object.keys(current), ...Object.keys(old)])) {
      if (equalValue(current[key], old[key])) continue;
      const action = current[key] === undefined
        ? "eliminado"
        : old[key] === undefined
          ? "creado"
          : "actualizado";
      appendAudit(audit, deviceId, sequence, now, scope, key, action, old[key], current[key]);
    }
  };

  recordChanges("status", snapshot.statuses, previousStatuses);
  recordChanges("detail", snapshot.details, previousDetails);
  recordChanges("custom-stop", currentStops, previousStops);

  const globalClocks: Record<string, ChangeStamp> = {};
  for (const field of GLOBAL_FIELDS) {
    const oldValue = previous?.[field as GlobalField];
    const newValue = snapshot[field as GlobalField];
    const changed = !previous || !equalValue(newValue, oldValue);
    globalClocks[field] = changed
      ? currentStamp
      : previousSync?.globalClocks[field] ?? currentStamp;
    if (previous && changed && field !== "lastPosition" && field !== "gpsMetrics" && field !== "activity") {
      appendAudit(audit, deviceId, sequence, now, "journey", field, "actualizado", oldValue, newValue);
    }
  }

  return {
    ...snapshot,
    sync: {
      deviceId,
      serverRevision: previousSync?.serverRevision ?? normalizeSyncMetadata(snapshot.sync)?.serverRevision ?? 0,
      localSequence: sequence,
      statusClocks: mapClocks(snapshot.statuses, previousStatuses, previousSync?.statusClocks ?? {}, currentStamp),
      detailClocks: mapClocks(snapshot.details, previousDetails, previousSync?.detailClocks ?? {}, currentStamp),
      customStopClocks: mapClocks(currentStops, previousStops, previousSync?.customStopClocks ?? {}, currentStamp),
      globalClocks,
    },
    auditTrail: audit.slice(-MAX_AUDIT_ENTRIES),
  };
}

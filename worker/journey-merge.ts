import type {
  AuditEntry,
  ChangeStamp,
  JourneySnapshot,
  SyncMetadata,
} from "../app/journey-types";

const MAX_AUDIT_ENTRIES = 500;
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

type MergeResult = {
  snapshot: JourneySnapshot;
  merged: boolean;
};

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validStamp(value: unknown, fallbackAt: number, fallbackDevice: string): ChangeStamp {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { at: value, deviceId: fallbackDevice, sequence: 0 };
  }
  if (!value || typeof value !== "object") {
    return { at: fallbackAt, deviceId: fallbackDevice, sequence: 0 };
  }
  const source = value as Partial<ChangeStamp>;
  return {
    at: typeof source.at === "number" && Number.isFinite(source.at) ? source.at : fallbackAt,
    deviceId: typeof source.deviceId === "string" ? source.deviceId : fallbackDevice,
    sequence: typeof source.sequence === "number" && Number.isFinite(source.sequence)
      ? Math.max(0, Math.round(source.sequence))
      : 0,
  };
}

function normalizeClockMap(value: unknown, fallbackAt: number, fallbackDevice: string) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, stamp]) => [
      key,
      validStamp(stamp, fallbackAt, fallbackDevice),
    ]),
  );
}

function normalizeSync(snapshot: JourneySnapshot): SyncMetadata {
  const source = snapshot.sync as (Partial<SyncMetadata> & {
    statusUpdatedAt?: unknown;
    detailUpdatedAt?: unknown;
    customStopUpdatedAt?: unknown;
    globalUpdatedAt?: unknown;
  }) | undefined;
  const fallbackDevice = source?.deviceId || "legacy-device";
  const fallbackAt = snapshot.updatedAt;
  const statusClocks = normalizeClockMap(source?.statusClocks ?? source?.statusUpdatedAt, fallbackAt, fallbackDevice);
  const detailClocks = normalizeClockMap(source?.detailClocks ?? source?.detailUpdatedAt, fallbackAt, fallbackDevice);
  const customStopClocks = normalizeClockMap(source?.customStopClocks ?? source?.customStopUpdatedAt, fallbackAt, fallbackDevice);
  const globalClocks = normalizeClockMap(source?.globalClocks ?? source?.globalUpdatedAt, fallbackAt, fallbackDevice);

  for (const key of Object.keys(snapshot.statuses)) statusClocks[key] ??= validStamp(null, fallbackAt, fallbackDevice);
  for (const key of Object.keys(snapshot.details)) detailClocks[key] ??= validStamp(null, fallbackAt, fallbackDevice);
  for (const stop of snapshot.customStops) customStopClocks[stop.id] ??= validStamp(null, fallbackAt, fallbackDevice);
  for (const field of GLOBAL_FIELDS) globalClocks[field] ??= validStamp(null, fallbackAt, fallbackDevice);

  return {
    deviceId: fallbackDevice,
    serverRevision: typeof source?.serverRevision === "number" && Number.isFinite(source.serverRevision)
      ? Math.max(0, Math.round(source.serverRevision))
      : 0,
    localSequence: typeof source?.localSequence === "number" && Number.isFinite(source.localSequence)
      ? Math.max(0, Math.round(source.localSequence))
      : 0,
    statusClocks,
    detailClocks,
    customStopClocks,
    globalClocks,
  };
}

function compareStamp(left: ChangeStamp | undefined, right: ChangeStamp | undefined) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.at !== right.at) return left.at > right.at ? 1 : -1;
  if (left.sequence !== right.sequence) return left.sequence > right.sequence ? 1 : -1;
  return left.deviceId.localeCompare(right.deviceId);
}

function mergeRecord<T>(
  existing: Record<string, T>,
  incoming: Record<string, T>,
  existingClocks: Record<string, ChangeStamp>,
  incomingClocks: Record<string, ChangeStamp>,
) {
  const values: Record<string, T> = {};
  const clocks: Record<string, ChangeStamp> = {};
  let merged = false;
  const keys = new Set([
    ...Object.keys(existing),
    ...Object.keys(incoming),
    ...Object.keys(existingClocks),
    ...Object.keys(incomingClocks),
  ]);

  for (const key of keys) {
    const existingWins = compareStamp(existingClocks[key], incomingClocks[key]) > 0;
    const value = existingWins ? existing[key] : incoming[key];
    const clock = existingWins ? existingClocks[key] : incomingClocks[key];
    if (value !== undefined) values[key] = value;
    if (clock) clocks[key] = clock;
    if (existingWins && !equalValue(existing[key], incoming[key])) merged = true;
  }

  return { values, clocks, merged };
}

function stopMap(snapshot: JourneySnapshot) {
  return Object.fromEntries(snapshot.customStops.map((stop) => [stop.id, stop]));
}

function normalizeAudit(value: unknown) {
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
  });
}

function mergeAudit(existing: JourneySnapshot, incoming: JourneySnapshot, serverRevision: number, conflict: boolean) {
  const byId = new Map<string, AuditEntry>();
  for (const entry of [...normalizeAudit(existing.auditTrail), ...normalizeAudit(incoming.auditTrail)]) {
    byId.set(entry.id, entry);
  }
  if (conflict) {
    const at = Date.now();
    byId.set(`server:${serverRevision}:merge`, {
      id: `server:${serverRevision}:merge`,
      at,
      deviceId: "server",
      scope: "system",
      action: "conflicto-fusionado",
      to: `revisión ${serverRevision}`,
    });
  }
  return [...byId.values()]
    .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    .slice(-MAX_AUDIT_ENTRIES);
}

function mergeGlobalFields(
  existing: JourneySnapshot,
  incoming: JourneySnapshot,
  existingSync: SyncMetadata,
  incomingSync: SyncMetadata,
) {
  const values: Partial<JourneySnapshot> = {};
  const clocks: Record<string, ChangeStamp> = {};
  let merged = false;

  for (const field of GLOBAL_FIELDS) {
    const existingWins = compareStamp(existingSync.globalClocks[field], incomingSync.globalClocks[field]) > 0;
    const value = existingWins ? existing[field as GlobalField] : incoming[field as GlobalField];
    (values as Record<string, unknown>)[field] = value;
    clocks[field] = existingWins ? existingSync.globalClocks[field] : incomingSync.globalClocks[field];
    if (existingWins && !equalValue(existing[field as GlobalField], incoming[field as GlobalField])) merged = true;
  }

  return { values, clocks, merged };
}

export function mergeJourneySnapshots(existing: JourneySnapshot | null, incoming: JourneySnapshot): MergeResult {
  const incomingSync = normalizeSync(incoming);
  if (!existing) {
    const serverRevision = Math.max(1, incomingSync.serverRevision + 1);
    return {
      merged: false,
      snapshot: {
        ...incoming,
        updatedAt: Date.now(),
        sync: { ...incomingSync, serverRevision },
        auditTrail: normalizeAudit(incoming.auditTrail).slice(-MAX_AUDIT_ENTRIES),
      },
    };
  }

  const existingSync = normalizeSync(existing);
  const statuses = mergeRecord(existing.statuses, incoming.statuses, existingSync.statusClocks, incomingSync.statusClocks);
  const details = mergeRecord(existing.details, incoming.details, existingSync.detailClocks, incomingSync.detailClocks);
  const customStops = mergeRecord(stopMap(existing), stopMap(incoming), existingSync.customStopClocks, incomingSync.customStopClocks);
  const globals = mergeGlobalFields(existing, incoming, existingSync, incomingSync);
  const conflict = statuses.merged || details.merged || customStops.merged || globals.merged;
  const serverRevision = Math.max(existingSync.serverRevision, incomingSync.serverRevision) + 1;

  const snapshot: JourneySnapshot = {
    ...incoming,
    ...(globals.values as Pick<JourneySnapshot, GlobalField>),
    statuses: statuses.values,
    details: details.values,
    customStops: Object.values(customStops.values),
    updatedAt: Date.now(),
    sync: {
      deviceId: incomingSync.deviceId,
      serverRevision,
      localSequence: Math.max(existingSync.localSequence, incomingSync.localSequence),
      statusClocks: statuses.clocks,
      detailClocks: details.clocks,
      customStopClocks: customStops.clocks,
      globalClocks: globals.clocks,
    },
    auditTrail: [],
  };
  snapshot.auditTrail = mergeAudit(existing, incoming, serverRevision, conflict);
  return { snapshot, merged: conflict };
}

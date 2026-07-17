import { sealLocalValue } from "./journey-db";

const LEGACY_BACKUP_PREFIX = "ruta-verde-journey-backup:";
const SECURE_BACKUP_PREFIX = "ruta-verde-secure-backup:";
const LEGACY_OUTBOX_PREFIX = "outbox:";
const SECURE_OUTBOX_PREFIX = "secure-outbox:";
const LEGACY_KEY = "santuario-viernes-v2";

function currentJourneyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

async function encryptIntoStorage(targetKey: string, context: string, value: unknown) {
  if (localStorage.getItem(targetKey)) return;
  const encrypted = await sealLocalValue(value, context);
  localStorage.setItem(targetKey, JSON.stringify(encrypted));
}

async function migratePrefixedEntries(sourcePrefix: string, targetPrefix: string, contextPrefix: string) {
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(sourcePrefix)));

  for (const sourceKey of keys) {
    const id = sourceKey.slice(sourcePrefix.length);
    const raw = localStorage.getItem(sourceKey);
    if (!id || !raw) continue;
    try {
      const value = JSON.parse(raw) as unknown;
      await encryptIntoStorage(`${targetPrefix}${id}`, `${contextPrefix}:${id}`, value);
    } catch {
      // Un respaldo corrupto no debe permanecer legible indefinidamente.
    } finally {
      localStorage.removeItem(sourceKey);
    }
  }
}

async function migrateOldApplicationState() {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    const journeyId = currentJourneyId();
    const snapshot = {
      version: 4,
      journeyId,
      statuses: legacy.statuses ?? {},
      details: legacy.details ?? {},
      customStops: Array.isArray(legacy.customStops) ? legacy.customStops : [],
      reverse: Boolean(legacy.reverse),
      optimizedIds: Array.isArray(legacy.optimizedIds) ? legacy.optimizedIds : [],
      startedAt: typeof legacy.startedAt === "number" ? legacy.startedAt : null,
      completedAt: null,
      activity: Array.isArray(legacy.activity) ? legacy.activity : [],
      vehicle: typeof legacy.vehicle === "string" ? legacy.vehicle : "Camioneta",
      lastPosition: null,
      gpsMetrics: legacy.gpsMetrics ?? { actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 },
      updatedAt: Date.now(),
    };
    await encryptIntoStorage(`${SECURE_BACKUP_PREFIX}${journeyId}`, `local-backup:${journeyId}`, snapshot);
  } catch {
    // El estado inválido no debe permanecer legible.
  } finally {
    localStorage.removeItem(LEGACY_KEY);
  }
}

export async function migrateLegacyBrowserStorage() {
  if (typeof window === "undefined") return;
  await migratePrefixedEntries(LEGACY_BACKUP_PREFIX, SECURE_BACKUP_PREFIX, "local-backup");
  await migratePrefixedEntries(LEGACY_OUTBOX_PREFIX, SECURE_OUTBOX_PREFIX, "outbox-fallback");
  await migrateOldApplicationState();
}

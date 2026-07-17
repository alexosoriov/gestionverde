import { readSecureStored, writeSecureStored } from "./journey-db";
import { STOPS, type Stop } from "./route-data";

export type StopCoordinateSnapshot = {
  lat: number;
  lng: number;
  address?: string;
  note?: string;
};

export type StopCorrectionHistoryEntry = {
  id: string;
  at: number;
  reason: string;
  from: StopCoordinateSnapshot;
  to: StopCoordinateSnapshot;
};

export type StopCorrection = {
  stopId: string;
  original: StopCoordinateSnapshot;
  current: StopCoordinateSnapshot;
  reason: string;
  updatedAt: number;
  history: StopCorrectionHistoryEntry[];
};

export type StopReviewFlag = {
  stopId: string;
  reason: string;
  createdAt: number;
};

export type RouteCorrectionStore = {
  version: 1;
  routeId: "santuario";
  updatedAt: number;
  corrections: Record<string, StopCorrection>;
  reviewFlags: Record<string, StopReviewFlag>;
};

const STORAGE_KEY = "route-corrections:santuario:v1";

function emptyStore(): RouteCorrectionStore {
  return {
    version: 1,
    routeId: "santuario",
    updatedAt: Date.now(),
    corrections: {},
    reviewFlags: {},
  };
}

function validCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function validSnapshot(value: unknown): value is StopCoordinateSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<StopCoordinateSnapshot>;
  return validCoordinate(snapshot.lat) && validCoordinate(snapshot.lng);
}

function normalizeStore(value: unknown): RouteCorrectionStore {
  if (!value || typeof value !== "object") return emptyStore();
  const candidate = value as Partial<RouteCorrectionStore>;
  const corrections: Record<string, StopCorrection> = {};
  const reviewFlags: Record<string, StopReviewFlag> = {};

  if (candidate.corrections && typeof candidate.corrections === "object") {
    for (const [stopId, raw] of Object.entries(candidate.corrections)) {
      if (!raw || typeof raw !== "object") continue;
      const correction = raw as Partial<StopCorrection>;
      if (!validSnapshot(correction.original) || !validSnapshot(correction.current)) continue;
      corrections[stopId] = {
        stopId,
        original: correction.original,
        current: correction.current,
        reason: typeof correction.reason === "string" ? correction.reason : "Corrección de ubicación",
        updatedAt: typeof correction.updatedAt === "number" ? correction.updatedAt : Date.now(),
        history: Array.isArray(correction.history)
          ? correction.history.filter((entry): entry is StopCorrectionHistoryEntry => {
            if (!entry || typeof entry !== "object") return false;
            const item = entry as Partial<StopCorrectionHistoryEntry>;
            return typeof item.id === "string" && typeof item.at === "number" && validSnapshot(item.from) && validSnapshot(item.to);
          })
          : [],
      };
    }
  }

  if (candidate.reviewFlags && typeof candidate.reviewFlags === "object") {
    for (const [stopId, raw] of Object.entries(candidate.reviewFlags)) {
      if (!raw || typeof raw !== "object") continue;
      const flag = raw as Partial<StopReviewFlag>;
      if (typeof flag.reason !== "string") continue;
      reviewFlags[stopId] = {
        stopId,
        reason: flag.reason,
        createdAt: typeof flag.createdAt === "number" ? flag.createdAt : Date.now(),
      };
    }
  }

  return {
    version: 1,
    routeId: "santuario",
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
    corrections,
    reviewFlags,
  };
}

function snapshot(stop: Stop): StopCoordinateSnapshot {
  return {
    lat: stop.lat,
    lng: stop.lng,
    address: stop.address,
    note: stop.note,
  };
}

function applySnapshot(stop: Stop, value: StopCoordinateSnapshot) {
  stop.lat = value.lat;
  stop.lng = value.lng;
  stop.address = value.address;
  stop.note = value.note;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function persist(store: RouteCorrectionStore) {
  store.updatedAt = Date.now();
  await writeSecureStored("journeys", STORAGE_KEY, store);
  return store;
}

export async function loadRouteCorrectionStore() {
  try {
    return normalizeStore(await readSecureStored<unknown>("journeys", STORAGE_KEY));
  } catch {
    return emptyStore();
  }
}

export async function initializeRouteCorrections() {
  const store = await loadRouteCorrectionStore();
  for (const correction of Object.values(store.corrections)) {
    const stop = STOPS.find((item) => item.id === correction.stopId);
    if (stop) applySnapshot(stop, correction.current);
  }
  return store;
}

export async function saveStopCorrection(input: {
  stopId: string;
  lat: number;
  lng: number;
  address?: string;
  note?: string;
  reason?: string;
}) {
  if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90) throw new Error("Latitud inválida");
  if (!Number.isFinite(input.lng) || Math.abs(input.lng) > 180) throw new Error("Longitud inválida");

  const stop = STOPS.find((item) => item.id === input.stopId);
  if (!stop) throw new Error("No se encontró la vivienda seleccionada");

  const store = await loadRouteCorrectionStore();
  const existing = store.corrections[input.stopId];
  const from = snapshot(stop);
  const to: StopCoordinateSnapshot = {
    lat: input.lat,
    lng: input.lng,
    address: input.address?.trim() || stop.address,
    note: input.note?.trim() || undefined,
  };
  const reason = input.reason?.trim() || "Punto corregido durante revisión de terreno";
  const entry: StopCorrectionHistoryEntry = {
    id: makeId(),
    at: Date.now(),
    reason,
    from,
    to,
  };

  const correction: StopCorrection = {
    stopId: input.stopId,
    original: existing?.original ?? from,
    current: to,
    reason,
    updatedAt: entry.at,
    history: [...(existing?.history ?? []), entry].slice(-30),
  };

  store.corrections[input.stopId] = correction;
  delete store.reviewFlags[input.stopId];
  applySnapshot(stop, to);
  await persist(store);
  return correction;
}

export async function restoreOriginalStop(stopId: string) {
  const store = await loadRouteCorrectionStore();
  const correction = store.corrections[stopId];
  if (!correction) return null;
  const stop = STOPS.find((item) => item.id === stopId);
  if (stop) applySnapshot(stop, correction.original);
  delete store.corrections[stopId];
  await persist(store);
  return correction.original;
}

export async function flagStopForReview(stopId: string, reason: string) {
  const stop = STOPS.find((item) => item.id === stopId);
  if (!stop) throw new Error("No se encontró la vivienda seleccionada");
  const store = await loadRouteCorrectionStore();
  store.reviewFlags[stopId] = {
    stopId,
    reason: reason.trim() || "Revisar ubicación durante el próximo recorrido",
    createdAt: Date.now(),
  };
  await persist(store);
  return store.reviewFlags[stopId];
}

export async function clearStopReviewFlag(stopId: string) {
  const store = await loadRouteCorrectionStore();
  delete store.reviewFlags[stopId];
  await persist(store);
}

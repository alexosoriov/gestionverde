import type { Stop } from "./route-data";

export type JourneyPhase = "idle" | "active" | "paused" | "finished";
export type StopStatus = "pending" | "done" | "absent";

export type StopPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
};

export type StopRecord = {
  status: StopStatus;
  note: string;
  material: string;
  kilos: string;
  photos: StopPhoto[];
  visitedAt: number | null;
};

export type PositionSnapshot = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speedKmh: number;
  heading: number;
  actualKm: number;
  updatedAt: number;
};

export type JourneyHistoryEntry = {
  id: string;
  startedAt: number;
  finishedAt: number;
  done: number;
  absent: number;
  total: number;
  actualKm: number;
};

export type CleanJourneyState = {
  version: 1;
  routeId: string;
  phase: JourneyPhase;
  records: Record<string, StopRecord>;
  startedAt: number | null;
  finishedAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  position: PositionSnapshot | null;
  voiceEnabled: boolean;
  updatedAt: number;
};

const STATE_KEY = "gestionverde:journey:v1";
const HISTORY_KEY = "gestionverde:history:v1";

export function emptyRecord(): StopRecord {
  return {
    status: "pending",
    note: "",
    material: "Mixto",
    kilos: "",
    photos: [],
    visitedAt: null,
  };
}

export function createInitialState(stops: Stop[]): CleanJourneyState {
  return {
    version: 1,
    routeId: "santuario-viernes",
    phase: "idle",
    records: Object.fromEntries(stops.map((stop) => [stop.id, emptyRecord()])),
    startedAt: null,
    finishedAt: null,
    pausedAt: null,
    pausedMs: 0,
    position: null,
    voiceEnabled: true,
    updatedAt: Date.now(),
  };
}

function isPhase(value: unknown): value is JourneyPhase {
  return value === "idle" || value === "active" || value === "paused" || value === "finished";
}

function normalizeRecord(value: unknown): StopRecord {
  if (!value || typeof value !== "object") return emptyRecord();
  const candidate = value as Partial<StopRecord>;
  const status = candidate.status === "done" || candidate.status === "absent" ? candidate.status : "pending";
  return {
    status,
    note: typeof candidate.note === "string" ? candidate.note : "",
    material: typeof candidate.material === "string" ? candidate.material : "Mixto",
    kilos: typeof candidate.kilos === "string" ? candidate.kilos : "",
    photos: Array.isArray(candidate.photos)
      ? candidate.photos.filter((photo): photo is StopPhoto => Boolean(
        photo && typeof photo === "object" && typeof (photo as StopPhoto).dataUrl === "string",
      )).slice(0, 3)
      : [],
    visitedAt: typeof candidate.visitedAt === "number" ? candidate.visitedAt : null,
  };
}

export function loadCleanJourney(stops: Stop[]): CleanJourneyState {
  const fallback = createInitialState(stops);
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) || "null") as Partial<CleanJourneyState> | null;
    if (!parsed || parsed.version !== 1 || !isPhase(parsed.phase)) return fallback;
    const records = Object.fromEntries(stops.map((stop) => [stop.id, normalizeRecord(parsed.records?.[stop.id])]));
    return {
      ...fallback,
      ...parsed,
      version: 1,
      routeId: typeof parsed.routeId === "string" ? parsed.routeId : fallback.routeId,
      phase: parsed.phase,
      records,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      finishedAt: typeof parsed.finishedAt === "number" ? parsed.finishedAt : null,
      pausedAt: typeof parsed.pausedAt === "number" ? parsed.pausedAt : null,
      pausedMs: typeof parsed.pausedMs === "number" ? Math.max(0, parsed.pausedMs) : 0,
      position: parsed.position && typeof parsed.position === "object" ? parsed.position as PositionSnapshot : null,
      voiceEnabled: parsed.voiceEnabled !== false,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return fallback;
  }
}

export function saveCleanJourney(state: CleanJourneyState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
}

export function resetCleanJourney(stops: Stop[]) {
  const next = createInitialState(stops);
  saveCleanJourney(next);
  return next;
}

export function loadJourneyHistory(): JourneyHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is JourneyHistoryEntry => Boolean(
      entry && typeof entry === "object" && typeof (entry as JourneyHistoryEntry).finishedAt === "number",
    )).slice(-30).reverse() : [];
  } catch {
    return [];
  }
}

export function appendJourneyHistory(entry: JourneyHistoryEntry) {
  const history = loadJourneyHistory().reverse();
  history.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-30)));
}

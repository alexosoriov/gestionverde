import type { Stop } from "./route-data";

export type RoutePoint = [number, number];

export type RouteDetails = {
  points: RoutePoint[];
  distanceKm: number;
  durationMinutes: number;
  source: "network" | "cache" | "fallback";
};

type RouteResponse = {
  coordinates?: [number, number][];
  distanceMeters?: number;
  durationSeconds?: number;
};

type OsrmRoute = {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }>;
};

type StoredRoute = {
  points: RoutePoint[];
  distanceKm: number;
  durationMinutes: number;
  savedAt: number;
};

const routeCache = new Map<string, RouteDetails>();
const STORAGE_PREFIX = "ruta-verde-road-route:";
const FALLBACK_SPEED_KMH = 22;

function hashKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function haversineKm(a: Stop, b: Stop) {
  const earthRadius = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function fallbackRoute(stops: Stop[]): RouteDetails {
  const distanceKm = stops.slice(1).reduce(
    (total, stop, index) => total + haversineKm(stops[index], stop),
    0,
  );
  return {
    points: stops.map((stop) => [stop.lat, stop.lng]),
    distanceKm,
    durationMinutes: distanceKm > 0 ? (distanceKm / FALLBACK_SPEED_KMH) * 60 : 0,
    source: "fallback",
  };
}

function readStoredRoute(storageKey: string): RouteDetails | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as StoredRoute | null;
    if (!stored?.points?.length) return null;
    return {
      points: stored.points,
      distanceKm: stored.distanceKm,
      durationMinutes: stored.durationMinutes,
      source: "cache",
    };
  } catch {
    return null;
  }
}

function storeRoute(storageKey: string, details: RouteDetails) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredRoute = {
      points: details.points,
      distanceKm: details.distanceKm,
      durationMinutes: details.durationMinutes,
      savedAt: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch {}
}

async function requestRoute(key: string, signal?: AbortSignal) {
  const coordinates = key.split(";").map((pair) => pair.split(",").map(Number) as [number, number]);
  try {
    const response = await fetch("/api/road-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates }),
      signal,
    });
    if (!response.ok) throw new Error("route proxy unavailable");
    const data = await response.json() as RouteResponse;
    if (!data.coordinates?.length) throw new Error("empty route");
    return {
      coordinates: data.coordinates,
      distanceMeters: data.distanceMeters ?? 0,
      durationSeconds: data.durationSeconds ?? 0,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`,
      { signal },
    );
    if (!response.ok) throw new Error("road route unavailable");
    const data = await response.json() as OsrmRoute;
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route?.geometry.coordinates?.length) throw new Error("invalid road route");
    return {
      coordinates: route.geometry.coordinates,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  }
}

export async function getRoadRouteDetails(stops: Stop[], signal?: AbortSignal): Promise<RouteDetails> {
  if (stops.length < 2) return fallbackRoute(stops);
  const key = stops.map((stop) => `${stop.lng.toFixed(6)},${stop.lat.toFixed(6)}`).join(";");
  const memory = routeCache.get(key);
  if (memory) return memory;

  const storageKey = `${STORAGE_PREFIX}${hashKey(key)}`;
  const stored = readStoredRoute(storageKey);
  if (stored && typeof navigator !== "undefined" && !navigator.onLine) {
    routeCache.set(key, stored);
    return stored;
  }

  try {
    const result = await requestRoute(key, signal);
    const details: RouteDetails = {
      points: result.coordinates.map(([lng, lat]) => [lat, lng]),
      distanceKm: result.distanceMeters / 1000,
      durationMinutes: result.durationSeconds / 60,
      source: "network",
    };
    routeCache.set(key, details);
    storeRoute(storageKey, details);
    return details;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (stored) {
      routeCache.set(key, stored);
      return stored;
    }
    const fallback = fallbackRoute(stops);
    routeCache.set(key, fallback);
    return fallback;
  }
}

export async function getRoadRoute(stops: Stop[], signal?: AbortSignal) {
  return (await getRoadRouteDetails(stops, signal)).points;
}

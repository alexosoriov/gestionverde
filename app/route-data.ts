export type Stop = {
  id: string;
  name: string;
  address?: string;
  note?: string;
  day?: string;
  lat: number;
  lng: number;
  km: number;
};

export const ROUTE_DISTANCE_KM = 4.509;

// Los registros reales se cargan después de autenticar al usuario.
// Este archivo no contiene nombres, direcciones ni coordenadas privadas.
export let STOPS: Stop[] = [];

function validStop(value: unknown): value is Stop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<Stop>;
  return typeof stop.id === "string" &&
    typeof stop.name === "string" &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng) &&
    Number.isFinite(stop.km) &&
    Math.abs(stop.lat as number) <= 90 &&
    Math.abs(stop.lng as number) <= 180;
}

export function installRouteData(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(validStop)) {
    throw new Error("Los datos privados del recorrido son inválidos.");
  }
  STOPS = value.map((stop) => ({ ...stop }));
}

export function clearRouteData() {
  STOPS = [];
}

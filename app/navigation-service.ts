export type NavigationPoint = {
  lat: number;
  lng: number;
};

export type NavigationInstructionKind =
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "roundabout"
  | "merge"
  | "fork-left"
  | "fork-right"
  | "arrive";

export type NavigationInstruction = {
  key: string;
  kind: NavigationInstructionKind;
  icon: string;
  primary: string;
  street: string;
  distanceMeters: number;
};

export type NavigationRoute = {
  distanceMeters: number;
  durationSeconds: number;
  instruction: NavigationInstruction;
};

type OsrmManeuver = {
  type?: string;
  modifier?: string;
  exit?: number;
};

type OsrmStep = {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: OsrmManeuver;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    legs?: Array<{ steps?: OsrmStep[] }>;
  }>;
};

function normalizeModifier(value: string | undefined) {
  return (value ?? "straight").toLowerCase();
}

function directionKind(modifier: string): NavigationInstructionKind {
  if (modifier === "uturn") return "uturn";
  if (modifier === "sharp left") return "sharp-left";
  if (modifier === "sharp right") return "sharp-right";
  if (modifier === "slight left") return "slight-left";
  if (modifier === "slight right") return "slight-right";
  if (modifier.includes("left")) return "left";
  if (modifier.includes("right")) return "right";
  return "straight";
}

function iconFor(kind: NavigationInstructionKind) {
  switch (kind) {
    case "left": return "↰";
    case "right": return "↱";
    case "slight-left": return "↖";
    case "slight-right": return "↗";
    case "sharp-left": return "↶";
    case "sharp-right": return "↷";
    case "uturn": return "⤵";
    case "roundabout": return "⟳";
    case "merge": return "⇢";
    case "fork-left": return "⑂";
    case "fork-right": return "⑂";
    case "arrive": return "✓";
    default: return "↑";
  }
}

function primaryFor(type: string, modifier: string, exit: number | undefined) {
  if (type === "arrive") return "Llegaste al siguiente retiro";
  if (type === "roundabout" || type === "rotary") {
    return exit ? `Entra a la rotonda y toma la salida ${exit}` : "Entra a la rotonda";
  }
  if (type === "exit roundabout" || type === "exit rotary") return "Sal de la rotonda";
  if (type === "merge") {
    if (modifier.includes("left")) return "Incorpórate por la izquierda";
    if (modifier.includes("right")) return "Incorpórate por la derecha";
    return "Incorpórate a la vía";
  }
  if (type === "fork") {
    return modifier.includes("left") ? "Mantente a la izquierda" : "Mantente a la derecha";
  }
  if (type === "end of road") {
    return modifier.includes("left") ? "Al final de la calle, gira a la izquierda" : "Al final de la calle, gira a la derecha";
  }
  if (modifier === "uturn") return "Haz un retorno cuando sea seguro";
  if (modifier === "sharp left") return "Gira pronunciadamente a la izquierda";
  if (modifier === "sharp right") return "Gira pronunciadamente a la derecha";
  if (modifier === "slight left") return "Mantente levemente a la izquierda";
  if (modifier === "slight right") return "Mantente levemente a la derecha";
  if (modifier.includes("left")) return "Gira a la izquierda";
  if (modifier.includes("right")) return "Gira a la derecha";
  return "Continúa recto";
}

function instructionKind(type: string, modifier: string): NavigationInstructionKind {
  if (type === "arrive") return "arrive";
  if (type === "roundabout" || type === "rotary" || type === "exit roundabout" || type === "exit rotary") return "roundabout";
  if (type === "merge") return "merge";
  if (type === "fork") return modifier.includes("left") ? "fork-left" : "fork-right";
  return directionKind(modifier);
}

function buildInstruction(step: OsrmStep, distanceMeters: number, fallbackStreet: string) {
  const type = (step.maneuver?.type ?? "continue").toLowerCase();
  const modifier = normalizeModifier(step.maneuver?.modifier);
  const kind = instructionKind(type, modifier);
  const street = step.name?.trim() || fallbackStreet;
  const primary = primaryFor(type, modifier, step.maneuver?.exit);
  return {
    key: `${type}|${modifier}|${street}|${step.maneuver?.exit ?? ""}`,
    kind,
    icon: iconFor(kind),
    primary,
    street,
    distanceMeters: Math.max(0, distanceMeters),
  } satisfies NavigationInstruction;
}

export function straightLineMeters(a: NavigationPoint, b: NavigationPoint) {
  const earthRadius = 6_371_000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function fallbackNavigationRoute(origin: NavigationPoint, destination: NavigationPoint, destinationLabel: string): NavigationRoute {
  const distanceMeters = straightLineMeters(origin, destination);
  const arriving = distanceMeters <= 35;
  return {
    distanceMeters,
    durationSeconds: distanceMeters / 6,
    instruction: {
      key: arriving ? `arrive|${destinationLabel}` : `fallback|${destinationLabel}`,
      kind: arriving ? "arrive" : "straight",
      icon: arriving ? "✓" : "↑",
      primary: arriving ? "Llegaste al siguiente retiro" : "Continúa hacia la siguiente vivienda",
      street: destinationLabel,
      distanceMeters,
    },
  };
}

export async function getNavigationRoute(
  origin: NavigationPoint,
  destination: NavigationPoint,
  destinationLabel: string,
  signal?: AbortSignal,
): Promise<NavigationRoute> {
  const coordinates = `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)};${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`;
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=true&annotations=false&continue_straight=default`,
    { signal },
  );
  if (!response.ok) throw new Error("No fue posible obtener instrucciones de navegación");
  const data = await response.json() as OsrmResponse;
  const route = data.routes?.[0];
  const steps = route?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  const distanceMeters = route?.distance ?? straightLineMeters(origin, destination);
  const durationSeconds = route?.duration ?? distanceMeters / 6;

  if (data.code !== "Ok" || !route || !steps.length) throw new Error("La ruta de navegación llegó vacía");
  if (distanceMeters <= 35) {
    return {
      distanceMeters,
      durationSeconds,
      instruction: buildInstruction({ name: destinationLabel, maneuver: { type: "arrive" } }, distanceMeters, destinationLabel),
    };
  }

  let distanceToManeuver = 0;
  let maneuverStep: OsrmStep | null = null;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const type = (step.maneuver?.type ?? "").toLowerCase();
    if (index === 0 && type === "depart") {
      distanceToManeuver += step.distance ?? 0;
      continue;
    }
    maneuverStep = step;
    break;
  }

  if (!maneuverStep) {
    maneuverStep = { name: destinationLabel, maneuver: { type: "arrive" } };
    distanceToManeuver = distanceMeters;
  }

  const currentStreet = steps[0]?.name?.trim() || destinationLabel;
  return {
    distanceMeters,
    durationSeconds,
    instruction: buildInstruction(maneuverStep, distanceToManeuver, currentStreet),
  };
}

export function formatNavigationDistance(value: number) {
  if (value < 950) return `${Math.max(0, Math.round(value / 10) * 10)} m`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(".", ",")} km`;
}

export function formatNavigationDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

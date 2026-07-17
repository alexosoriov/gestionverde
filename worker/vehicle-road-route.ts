export type VehicleProfile = {
  vehicleType?: "hgv" | "bus" | "agricultural" | "delivery" | "forestry" | "goods";
  length?: number;
  width?: number;
  height?: number;
  axleload?: number;
  weight?: number;
  hazmat?: boolean;
};

type RoadRouteBody = {
  coordinates?: Array<[number, number]>;
  vehicle?: VehicleProfile;
};

function validCoordinates(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= 2 && value.length <= 100 && value.every((point) =>
    Array.isArray(point) && point.length === 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90,
  );
}

function bounded(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function normalizeVehicleProfile(value: unknown, fallback?: VehicleProfile): VehicleProfile {
  const source = value && typeof value === "object" ? value as Partial<VehicleProfile> : {};
  const vehicleType = source.vehicleType === "hgv" || source.vehicleType === "bus" || source.vehicleType === "agricultural" ||
    source.vehicleType === "delivery" || source.vehicleType === "forestry" || source.vehicleType === "goods"
    ? source.vehicleType
    : fallback?.vehicleType ?? "delivery";
  return {
    vehicleType,
    length: bounded(source.length, 1, 30) ?? bounded(fallback?.length, 1, 30),
    width: bounded(source.width, 1, 5) ?? bounded(fallback?.width, 1, 5),
    height: bounded(source.height, 1, 6) ?? bounded(fallback?.height, 1, 6),
    axleload: bounded(source.axleload, 0.5, 30) ?? bounded(fallback?.axleload, 0.5, 30),
    weight: bounded(source.weight, 0.5, 80) ?? bounded(fallback?.weight, 0.5, 80),
    hazmat: typeof source.hazmat === "boolean" ? source.hazmat : Boolean(fallback?.hazmat),
  };
}

function restrictions(profile: VehicleProfile) {
  return Object.fromEntries(
    Object.entries({
      length: profile.length,
      width: profile.width,
      height: profile.height,
      axleload: profile.axleload,
      weight: profile.weight,
      hazmat: profile.hazmat,
    }).filter(([, value]) => value !== undefined),
  );
}

async function routeForTruck(coordinates: Array<[number, number]>, apiKey: string, profile: VehicleProfile) {
  const vehicleRestrictions = restrictions(profile);
  const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-hgv/geojson", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify({
      coordinates,
      instructions: false,
      extra_info: ["roadaccessrestrictions", "waytype"],
      options: {
        vehicle_type: profile.vehicleType ?? "delivery",
        avoid_features: ["ferries"],
        profile_params: { restrictions: vehicleRestrictions },
      },
    }),
  });
  if (!response.ok) throw new Error("Ruta de camión no disponible");
  const data = await response.json() as {
    features?: Array<{
      properties?: {
        summary?: { distance?: number; duration?: number };
        warnings?: Array<{ message?: string }>;
      };
      geometry?: { coordinates?: [number, number][] };
    }>;
  };
  const feature = data.features?.[0];
  if (!feature?.geometry?.coordinates?.length) throw new Error("Ruta de camión vacía");
  return {
    coordinates: feature.geometry.coordinates,
    distanceMeters: feature.properties?.summary?.distance ?? 0,
    durationSeconds: feature.properties?.summary?.duration ?? 0,
    provider: "openrouteservice-hgv",
    truckConstrained: Object.keys(vehicleRestrictions).length >= 4,
    vehicleProfile: profile,
    warnings: feature.properties?.warnings?.flatMap((warning) => warning.message ? [warning.message.slice(0, 240)] : []) ?? [],
  };
}

async function routeForVehicle(coordinates: Array<[number, number]>) {
  const key = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`,
    { headers: { "User-Agent": "Ruta-Verde/1.0" } },
  );
  if (!response.ok) throw new Error("Ruta vehicular no disponible");
  const data = await response.json() as {
    code?: string;
    routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }>;
  };
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.geometry?.coordinates?.length) throw new Error("Ruta vehicular vacía");
  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    provider: "osrm-driving",
    truckConstrained: false,
    warnings: ["Ruta vehicular de respaldo: no valida altura, ancho ni peso del camión."],
  };
}

export async function handleVehicleRoadRoute(request: Request, apiKey?: string, defaultVehicle?: VehicleProfile) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: RoadRouteBody;
  try {
    body = await request.json() as RoadRouteBody;
  } catch {
    return Response.json({ error: "Datos inválidos" }, { status: 400 });
  }

  if (!validCoordinates(body.coordinates)) {
    return Response.json({ error: "Coordenadas inválidas" }, { status: 400 });
  }

  const profile = normalizeVehicleProfile(body.vehicle, defaultVehicle);
  if (apiKey) {
    try {
      return Response.json(await routeForTruck(body.coordinates, apiKey, profile), {
        headers: { "Cache-Control": "private, max-age=900" },
      });
    } catch {
      // Si el proveedor HGV falla, se conserva una ruta vehicular de respaldo claramente identificada.
    }
  }

  try {
    return Response.json(await routeForVehicle(body.coordinates), {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return Response.json({ error: "Ruta no disponible" }, { status: 502 });
  }
}

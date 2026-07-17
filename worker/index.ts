/** Cloudflare Worker entry point for Ruta Verde. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleDiagnostics } from "./diagnostics";
import { handleJourneyState } from "./journey-state";
import { handleVehicleRoadRoute, type VehicleProfile } from "./vehicle-road-route";
import { getSession, handleSessionRequest, requireSession, type SecurityEnv } from "./auth";
import { decryptPrivateRoute } from "./private-route-data";
import { handleTracking } from "./live-tracking";
import { migrateLegacyOperationalData } from "./legacy-data-migration";
import { readStoredPrivateRoute, storePrivateRoute } from "./route-catalog";

interface Env extends SecurityEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  OPENROUTESERVICE_API_KEY?: string;
  ROUTE_DATA_KEY?: string;
  VEHICLE_TYPE?: string;
  VEHICLE_LENGTH_METERS?: string;
  VEHICLE_WIDTH_METERS?: string;
  VEHICLE_HEIGHT_METERS?: string;
  VEHICLE_AXLELOAD_TONS?: string;
  VEHICLE_WEIGHT_TONS?: string;
  VEHICLE_HAZMAT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function requestIsSameOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function withSecurityHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://router.project-osrm.org https://api.openrouteservice.org; worker-src 'self' blob:; manifest-src 'self'",
  );
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function envNumber(value: string | undefined) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function vehicleProfile(env: Env): VehicleProfile {
  const allowedTypes: VehicleProfile["vehicleType"][] = ["hgv", "bus", "agricultural", "delivery", "forestry", "goods"];
  const requestedType = env.VEHICLE_TYPE as VehicleProfile["vehicleType"] | undefined;
  return {
    vehicleType: requestedType && allowedTypes.includes(requestedType) ? requestedType : "delivery",
    length: envNumber(env.VEHICLE_LENGTH_METERS),
    width: envNumber(env.VEHICLE_WIDTH_METERS),
    height: envNumber(env.VEHICLE_HEIGHT_METERS),
    axleload: envNumber(env.VEHICLE_AXLELOAD_TONS),
    weight: envNumber(env.VEHICLE_WEIGHT_TONS),
    hazmat: env.VEHICLE_HAZMAT === "true",
  };
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/_vinext/image") {
    const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
    return handleImageOptimization(request, {
      fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
      transformImage: async (body, { width, format, quality }) => {
        const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
        return result.response();
      },
    }, allowedWidths);
  }

  if (url.pathname === "/api/session") {
    return handleSessionRequest(request, env);
  }

  const protectedApi = url.pathname === "/api/private-route" ||
    url.pathname === "/api/tracking" ||
    url.pathname === "/api/journey-state" ||
    url.pathname === "/api/road-route" ||
    url.pathname === "/api/diagnostics";

  if (protectedApi) {
    const denied = await requireSession(request, env);
    if (denied) return denied;
    if (env.DB && env.ROUTE_DATA_KEY) {
      ctx.waitUntil(migrateLegacyOperationalData(env.DB, env.ROUTE_DATA_KEY));
    }
  }

  if (url.pathname === "/api/private-route") {
    if (!env.ROUTE_DATA_KEY) {
      return noStoreJson({ error: "Falta configurar ROUTE_DATA_KEY en Cloudflare." }, { status: 503 });
    }

    if (request.method === "GET") {
      try {
        const stored = env.DB ? await readStoredPrivateRoute(env.DB, env.ROUTE_DATA_KEY) : null;
        if (stored) return noStoreJson({ stops: stored.stops, source: "catalog", updatedAt: stored.updatedAt });
        const stops = await decryptPrivateRoute(env.ROUTE_DATA_KEY);
        return noStoreJson({ stops, source: "vault" });
      } catch (error) {
        console.error("No fue posible descifrar el recorrido privado", error);
        return noStoreJson({ error: "No fue posible descifrar los datos privados." }, { status: 503 });
      }
    }

    if (request.method === "POST") {
      if (!requestIsSameOrigin(request)) return noStoreJson({ error: "Solicitud rechazada." }, { status: 403 });
      if (!env.DB) return noStoreJson({ error: "Base de datos no configurada." }, { status: 503 });
      const session = await getSession(request, env);
      if (session?.role !== "superadmin") {
        return noStoreJson({ error: "Solo Superadministrador puede reemplazar las viviendas." }, { status: 403 });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return noStoreJson({ error: "El archivo enviado no contiene JSON válido." }, { status: 400 });
      }
      try {
        const saved = await storePrivateRoute(env.DB, env.ROUTE_DATA_KEY, body);
        return noStoreJson({ ok: true, total: saved.stops.length, updatedAt: saved.updatedAt });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No fue posible guardar el listado.";
        return noStoreJson({ error: message }, { status: 400 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }

  if (url.pathname === "/api/tracking") {
    if (!env.DB) return noStoreJson({ error: "Base de datos no configurada" }, { status: 503 });
    if (!env.ROUTE_DATA_KEY) return noStoreJson({ error: "Falta configurar ROUTE_DATA_KEY" }, { status: 503 });
    return handleTracking(request, env.DB, env.ROUTE_DATA_KEY);
  }

  if (url.pathname === "/api/journey-state") {
    if (!env.DB) return noStoreJson({ error: "Base de datos no configurada" }, { status: 503 });
    if (!env.ROUTE_DATA_KEY) return noStoreJson({ error: "Falta configurar ROUTE_DATA_KEY" }, { status: 503 });
    return handleJourneyState(request, env.DB, env.ROUTE_DATA_KEY);
  }

  if (url.pathname === "/api/diagnostics") {
    if (!env.DB) return noStoreJson({ error: "Base de datos no configurada" }, { status: 503 });
    if (!env.ROUTE_DATA_KEY) return noStoreJson({ error: "Falta configurar ROUTE_DATA_KEY" }, { status: 503 });
    if (request.method === "GET" || request.method === "DELETE") {
      const session = await getSession(request, env);
      if (session?.role !== "manager" && session?.role !== "superadmin") {
        return noStoreJson({ error: "Solo Jefatura o Superadministrador pueden consultar diagnósticos." }, { status: 403 });
      }
    }
    return handleDiagnostics(request, env.DB, env.ROUTE_DATA_KEY);
  }

  if (url.pathname === "/api/road-route") {
    return handleVehicleRoadRoute(request, env.OPENROUTESERVICE_API_KEY, vehicleProfile(env));
  }

  return handler.fetch(request, env, ctx);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await handleRequest(request, env, ctx), request);
  },
};

export default worker;

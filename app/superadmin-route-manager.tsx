"use client";

import { useEffect, useState, type ChangeEvent } from "react";

type ExistingStop = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  note?: string;
  day?: string;
  lat: number;
  lng: number;
  km: number;
};

type UploadedHome = {
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  note?: unknown;
  day?: unknown;
  lat?: unknown;
  lng?: unknown;
};

type CurrentRoute = {
  total: number;
  source: "catalog" | "vault" | "unknown";
  updatedAt?: number;
};

type Preview = {
  additions: ExistingStop[];
  merged: ExistingStop[];
  currentTotal: number;
  finalTotal: number;
  duplicates: string[];
  unresolved: string[];
};

const EXPECTED_CURRENT_TOTAL = 41;
const EXPECTED_ADDITIONS = 3;
const TARGET_TOTAL = 44;
const GENERIC_WORDS = new Set(["calle", "pje", "pasaje", "numero", "n", "de", "del", "la", "el"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bote\b/g, "oriente")
    .replace(/\boeste\b/g, "poniente")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function houseNumber(address: string) {
  const matches = normalize(address).match(/\b\d{3,5}\b/g);
  return matches?.at(-1) ?? "";
}

function streetTokens(address: string) {
  const number = houseNumber(address);
  return normalize(address)
    .split(" ")
    .filter((token) => token && token !== number && !GENERIC_WORDS.has(token) && !/^\d+$/.test(token));
}

function addressKey(address: string) {
  return `${streetTokens(address).join("-")}|${houseNumber(address)}`;
}

function asCoordinate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function distanceKm(a: Pick<ExistingStop, "lat" | "lng">, b: Pick<ExistingStop, "lat" | "lng">) {
  const radius = 6371;
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function extractHomes(parsed: unknown): UploadedHome[] | null {
  if (Array.isArray(parsed)) return parsed as UploadedHome[];
  if (!parsed || typeof parsed !== "object") return null;
  const source = parsed as Record<string, unknown>;
  if (Array.isArray(source.homes)) return source.homes as UploadedHome[];
  if (Array.isArray(source.stops)) return source.stops as UploadedHome[];
  return null;
}

async function readCurrentRoute(): Promise<{ route: CurrentRoute; stops: ExistingStop[] }> {
  const response = await fetch("/api/private-route", { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as {
    stops?: ExistingStop[];
    source?: "catalog" | "vault";
    updatedAt?: number;
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.stops)) {
    throw new Error(body.error || "No pude leer el recorrido activo.");
  }
  return {
    route: {
      total: body.stops.length,
      source: body.source ?? "unknown",
      updatedAt: body.updatedAt,
    },
    stops: body.stops,
  };
}

function nextStopId(stops: ExistingStop[], offset: number) {
  const used = new Set(stops.map((stop) => stop.id));
  let candidate = stops.length + 1 + offset;
  while (used.has(String(candidate).padStart(2, "0"))) candidate += 1;
  return String(candidate).padStart(2, "0");
}

function insertionCost(route: ExistingStop[], stop: ExistingStop, index: number) {
  const previous = index > 0 ? route[index - 1] : null;
  const next = index < route.length ? route[index] : null;
  if (!previous && !next) return 0;
  if (!previous && next) return distanceKm(stop, next);
  if (previous && !next) return distanceKm(previous, stop);
  return distanceKm(previous!, stop) + distanceKm(stop, next!) - distanceKm(previous!, next!);
}

function insertAtBestPosition(route: ExistingStop[], stop: ExistingStop) {
  let bestIndex = route.length;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= route.length; index += 1) {
    const cost = insertionCost(route, stop, index);
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  }
  return [...route.slice(0, bestIndex), stop, ...route.slice(bestIndex)];
}

function recalculateKilometers(stops: ExistingStop[]) {
  let cumulative = 0;
  return stops.map((stop, index) => {
    if (index > 0) cumulative += distanceKm(stops[index - 1], stop);
    return { ...stop, km: Number(cumulative.toFixed(3)) };
  });
}

async function prepareAdditions(file: File): Promise<Preview> {
  const parsed = JSON.parse(await file.text()) as unknown;
  const homes = extractHomes(parsed);
  if (!homes?.length) throw new Error("El archivo no contiene viviendas nuevas.");
  if (homes.length !== EXPECTED_ADDITIONS) {
    throw new Error(`Este archivo debe contener exactamente ${EXPECTED_ADDITIONS} viviendas nuevas.`);
  }

  const { stops: currentStops } = await readCurrentRoute();
  if (currentStops.length === TARGET_TOTAL) {
    throw new Error("El recorrido ya tiene 44 viviendas activas.");
  }
  if (currentStops.length !== EXPECTED_CURRENT_TOTAL) {
    throw new Error(`El servidor tiene ${currentStops.length} viviendas, no 41. No se cambió nada para evitar pérdidas.`);
  }

  const existingKeys = new Set(currentStops.map((stop) => addressKey(stop.address ?? "")).filter(Boolean));
  const newKeys = new Set<string>();
  const duplicates: string[] = [];
  const unresolved: string[] = [];
  const additions: ExistingStop[] = [];

  homes.forEach((home, index) => {
    const name = clean(home.name);
    const address = clean(home.address);
    const phone = clean(home.phone);
    const note = clean(home.note);
    const day = clean(home.day) || "Viernes";
    const lat = asCoordinate(home.lat);
    const lng = asCoordinate(home.lng);

    if (!name || !address) {
      unresolved.push(`Fila ${index + 1}: falta nombre o dirección`);
      return;
    }
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      unresolved.push(address);
      return;
    }

    const key = addressKey(address);
    if (!key || existingKeys.has(key) || newKeys.has(key)) {
      duplicates.push(address);
      return;
    }
    newKeys.add(key);

    additions.push({
      id: nextStopId(currentStops, additions.length),
      name,
      address,
      ...(phone ? { phone } : {}),
      ...(note ? { note } : {}),
      day,
      lat,
      lng,
      km: 0,
    });
  });

  let merged = currentStops.map((stop) => ({ ...stop }));
  additions.forEach((stop) => {
    merged = insertAtBestPosition(merged, stop);
  });
  merged = recalculateKilometers(merged);

  return {
    additions,
    merged,
    currentTotal: currentStops.length,
    finalTotal: merged.length,
    duplicates,
    unresolved,
  };
}

export default function SuperadminRouteManager() {
  const [current, setCurrent] = useState<CurrentRoute | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("Selecciona el archivo Ruta_Verde_agregar_3_viviendas.json.");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void readCurrentRoute()
      .then(({ route }) => { if (active) setCurrent(route); })
      .catch(() => { if (active) setCurrent({ total: 0, source: "unknown" }); });
    return () => { active = false; };
  }, []);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setSaved(false);
    setPreview(null);
    setMessage("Leyendo las 41 viviendas actuales y ubicando las 3 nuevas…");
    try {
      const result = await prepareAdditions(file);
      setPreview(result);
      if (result.duplicates.length || result.unresolved.length) {
        setMessage("No se guardó nada: revisa los registros marcados antes de continuar.");
      } else if (result.finalTotal !== TARGET_TOTAL) {
        setMessage(`La combinación terminó con ${result.finalTotal} viviendas, no 44. No se guardará.`);
      } else {
        setMessage("Listo: se conservarán las 41 viviendas y se agregarán 3 para quedar en 44.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pude revisar el archivo.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const save = async () => {
    if (!preview || preview.unresolved.length || preview.duplicates.length || preview.finalTotal !== TARGET_TOTAL) return;
    if (!window.confirm("¿Conservar las 41 viviendas actuales y agregar estas 3 para dejar 44 en total?")) return;

    setLoading(true);
    setMessage("Cifrando y guardando las 44 viviendas…");
    try {
      const response = await fetch("/api/private-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, stops: preview.merged }),
      });
      const body = await response.json().catch(() => ({})) as { total?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "No fue posible agregar las viviendas.");

      const verified = await readCurrentRoute();
      if (verified.route.total !== TARGET_TOTAL || verified.route.source !== "catalog") {
        throw new Error("El servidor recibió los datos, pero todavía no devuelve las 44 viviendas como recorrido activo.");
      }

      setCurrent(verified.route);
      setSaved(true);
      setMessage("44 viviendas activadas. Recargando el mapa automáticamente…");
      window.setTimeout(() => window.location.reload(), 1_200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible agregar las viviendas.");
    } finally {
      setLoading(false);
    }
  };

  const activeTotal = current?.total ?? 0;
  const ready = preview
    && preview.finalTotal === TARGET_TOTAL
    && preview.unresolved.length === 0
    && preview.duplicates.length === 0;

  return (
    <section className={`route-manager-safe ${activeTotal === TARGET_TOTAL ? "is-current" : "needs-update"}`} aria-label="Agregar viviendas">
      <div className="route-manager-head">
        <div>
          <span className="route-manager-kicker">Solo Superadministrador</span>
          <h2>{activeTotal === TARGET_TOTAL ? "44 viviendas activas" : "Agregar 3 viviendas al recorrido"}</h2>
          <p>El mapa está usando <strong>{activeTotal || "…"} viviendas</strong>. Las existentes no serán eliminadas.</p>
        </div>
        <div className="route-change-count">
          <span>Recorrido</span>
          <strong>{activeTotal || "…"} → 44</strong>
        </div>
      </div>

      {activeTotal !== TARGET_TOTAL && (
        <div className="route-warning">
          Se conservarán las 41 viviendas actuales y se agregarán Los Pimientos 4812, Nueva Oriente 4 #5300 y Los Pimientos 4731.
        </div>
      )}

      <label className="route-file-button">
        <span>{loading ? "Revisando archivo…" : "1. Seleccionar archivo con las 3 viviendas"}</span>
        <input type="file" accept="application/json,.json" onChange={chooseFile} disabled={loading || activeTotal === TARGET_TOTAL} />
      </label>

      {preview && (
        <div className="route-preview-grid">
          <article><span>Viviendas actuales</span><strong>{preview.currentTotal}</strong></article>
          <article><span>Viviendas agregadas</span><strong>{preview.additions.length}</strong></article>
          <article><span>Total final</span><strong>{preview.finalTotal}</strong></article>
          <article className={preview.duplicates.length || preview.unresolved.length ? "warning" : "good"}>
            <span>Problemas</span><strong>{preview.duplicates.length + preview.unresolved.length}</strong>
          </article>
        </div>
      )}

      {preview?.duplicates.length ? (
        <div className="route-unresolved"><strong>Direcciones repetidas:</strong>{preview.duplicates.map((item) => <span key={item}>{item}</span>)}</div>
      ) : null}
      {preview?.unresolved.length ? (
        <div className="route-unresolved"><strong>Sin datos completos:</strong>{preview.unresolved.map((item) => <span key={item}>{item}</span>)}</div>
      ) : null}

      <div className={`route-manager-message ${saved ? "success" : ""}`} role="status">{message}</div>
      <button
        className="route-activate-button"
        type="button"
        onClick={save}
        disabled={loading || !ready || activeTotal === TARGET_TOTAL}
      >
        {loading ? "Procesando…" : "2. Conservar 41 y activar 44 viviendas"}
      </button>

      <style jsx global>{`
        .route-manager-safe{max-width:1500px;margin:10px auto;padding:16px;border:2px solid #d49a2b;border-radius:17px;background:#fff9e8;display:grid;gap:12px;box-shadow:0 12px 30px rgba(72,52,15,.1)}.route-manager-safe.is-current{border-color:#53a579;background:#eff9f3}.route-manager-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.route-manager-kicker{font-size:10px;font-weight:900;text-transform:uppercase;color:#746849}.route-manager-head h2{margin:3px 0 4px;color:#173f33;font-size:22px}.route-manager-head p{margin:0;color:#596d65;font-size:13px}.route-change-count{min-width:115px;padding:11px 14px;border-radius:13px;background:#fff;display:grid;text-align:center;border:1px solid #dfd3ab}.route-change-count span{font-size:10px;text-transform:uppercase;font-weight:850;color:#766b4d}.route-change-count strong{font-size:22px;color:#173f33}.route-warning{padding:12px;border-radius:11px;background:#fff0bd;color:#6e4b08;font-size:13px;font-weight:800}.route-file-button{display:grid;place-items:center;min-height:52px;border:2px dashed #6b9f87;border-radius:12px;background:#fff;color:#185d43;font-size:14px;font-weight:900;cursor:pointer}.route-file-button input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.route-preview-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.route-preview-grid article{padding:12px;border:1px solid #d8e4dc;border-radius:12px;background:#fff;display:grid;gap:3px}.route-preview-grid span{font-size:10px;text-transform:uppercase;color:#6c7e77;font-weight:850}.route-preview-grid strong{font-size:23px;color:#173f33}.route-preview-grid article.good{background:#e9f8ef}.route-preview-grid article.warning{background:#fff0bd}.route-unresolved{display:grid;gap:5px;padding:12px;border-radius:11px;background:#ffe9cc;color:#76511b;font-size:12px}.route-manager-message{padding:11px 12px;border-radius:10px;background:#fff;color:#36584c;font-size:13px;border:1px solid #d8e4dc}.route-manager-message.success{background:#dff3e7;color:#176042}.route-activate-button{width:100%;min-height:50px;border:0;border-radius:12px;background:#176e50;color:#fff;font-size:14px;font-weight:950}.route-activate-button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:700px){.route-manager-safe{margin:8px;padding:13px}.route-manager-head{align-items:flex-start}.route-change-count{min-width:95px}.route-preview-grid{grid-template-columns:1fr 1fr}}
      `}</style>
    </section>
  );
}

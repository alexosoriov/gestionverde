"use client";

import { useState, type ChangeEvent } from "react";
import "./gestionverde-route-manager.css";

type PreviewStop = {
  id?: unknown;
  name?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
  km?: unknown;
  day?: unknown;
};

function extractStops(value: unknown): PreviewStop[] | null {
  if (Array.isArray(value)) return value as PreviewStop[];
  if (value && typeof value === "object" && Array.isArray((value as { stops?: unknown }).stops)) {
    return (value as { stops: PreviewStop[] }).stops;
  }
  return null;
}

function validPreviewStop(stop: PreviewStop) {
  return typeof stop.id === "string" &&
    typeof stop.name === "string" &&
    Number.isFinite(Number(stop.lat)) &&
    Number.isFinite(Number(stop.lng));
}

function downloadTemplate() {
  const template = {
    stops: [
      {
        id: "vivienda-001",
        name: "Vivienda 01",
        address: "Dirección visible solo para usuarios autenticados",
        day: "Viernes",
        lat: -41.4693,
        lng: -72.9424,
        km: 0,
      },
    ],
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "plantilla-gestionverde-ruta.json";
  link.click();
  URL.revokeObjectURL(url);
}

export default function GestionVerdeRouteManager() {
  const [raw, setRaw] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const stops = extractStops(raw);
  const validCount = stops?.filter(validPreviewStop).length ?? 0;
  const ready = Boolean(stops?.length && validCount === stops.length && stops.length <= 500);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMessage("");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const parsedStops = extractStops(parsed);
      if (!parsedStops) throw new Error("El JSON debe ser una lista o contener la propiedad stops.");
      if (parsedStops.length === 0 || parsedStops.length > 500) throw new Error("La ruta debe tener entre 1 y 500 viviendas.");
      if (!parsedStops.every(validPreviewStop)) throw new Error("Cada vivienda necesita id, name, lat y lng válidos.");
      setRaw(parsed);
      setMessage(`${parsedStops.length} viviendas listas para importar.`);
    } catch (error) {
      setRaw(null);
      setMessage(error instanceof Error ? error.message : "No fue posible leer el archivo.");
    }
  };

  const save = async () => {
    if (!ready || !raw) return;
    setBusy(true);
    setMessage("Guardando recorrido…");
    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; total?: number };
      if (!response.ok) throw new Error(body.error || "No fue posible guardar el recorrido.");
      setMessage(`${body.total ?? stops?.length ?? 0} viviendas guardadas. Recargando la aplicación…`);
      window.setTimeout(() => window.location.reload(), 850);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar el recorrido.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("¿Eliminar la ruta guardada? Después se usará la ruta demo sin datos personales.")) return;
    setBusy(true);
    setMessage("Eliminando recorrido…");
    try {
      const response = await fetch("/api/route", { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No fue posible eliminar el recorrido.");
      setMessage("Ruta eliminada. Recargando la demostración…");
      window.setTimeout(() => window.location.reload(), 850);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible eliminar el recorrido.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="gv-admin-route-manager">
      <summary>⚙️ Administrar ruta</summary>
      <div className="gv-admin-route-panel">
        <div className="gv-admin-route-head">
          <span>Superadministrador</span>
          <strong>Importar viviendas</strong>
          <p>El archivo se guarda en la base de datos y no queda publicado dentro de GitHub.</p>
        </div>

        <label className="gv-admin-upload">
          <span>📂 Seleccionar JSON</span>
          <small>{fileName || "Lista o { stops: [...] }"}</small>
          <input type="file" accept="application/json,.json" onChange={chooseFile} />
        </label>

        {stops && (
          <div className="gv-admin-preview">
            <div><span>Viviendas</span><strong>{stops.length}</strong></div>
            <div><span>Válidas</span><strong>{validCount}</strong></div>
            <div><span>Estado</span><strong>{ready ? "Lista" : "Revisar"}</strong></div>
          </div>
        )}

        {message && <p className={ready ? "gv-admin-message ok" : "gv-admin-message"}>{message}</p>}

        <div className="gv-admin-route-actions">
          <button type="button" onClick={save} disabled={!ready || busy}>Guardar ruta</button>
          <button type="button" onClick={downloadTemplate} disabled={busy}>Descargar plantilla</button>
          <button type="button" className="danger" onClick={remove} disabled={busy}>Usar ruta demo</button>
        </div>
      </div>
    </details>
  );
}

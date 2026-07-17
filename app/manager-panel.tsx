"use client";

import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STOPS } from "./route-data";
import { getRoadRoute } from "./road-route";
import type { GpsMetrics, TrackingActivity } from "./tracking-types";
import { applyTruckAppearance, truckIcon } from "./truck-marker";

export type LocalSummary = {
  total: number;
  done: number;
  absent: number;
  pending: number;
  nextStop: string | null;
  startedAt: number | null;
  kilos: number;
  estimatedMinutes: number;
  routeKm: number;
  baselineRouteKm: number;
  routeSavingsKm: number;
  plannedDriveMinutes: number;
  gpsMetrics: GpsMetrics;
  activity: TrackingActivity[];
  presentationMode: boolean;
};

type Props = { localSummary: LocalSummary };

type Tracking = {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  next_stop: string | null;
  completed: number;
  done?: number | null;
  absent?: number | null;
  pending?: number | null;
  total: number;
  kilos?: number | null;
  route_km?: number | null;
  baseline_route_km?: number | null;
  route_savings_km?: number | null;
  planned_drive_minutes?: number | null;
  actual_km?: number | null;
  moving_minutes?: number | null;
  stopped_minutes?: number | null;
  estimated_minutes?: number | null;
  started_at?: number | null;
  activity_json?: string | null;
  status: string;
  updated_at: number;
};

type ConnectionState = "waiting" | "live" | "delayed" | "lost" | "finished";

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatLastUpdate(timestamp: number | null) {
  if (!timestamp) return "Sin ubicación recibida";
  return new Date(timestamp).toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function readActivity(value: string | null | undefined): TrackingActivity[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): TrackingActivity[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Partial<TrackingActivity>;
      if ((item.status !== "done" && item.status !== "absent") || typeof item.at !== "number") return [];
      return [{
        id: typeof item.id === "string" ? item.id : `event-${item.at}`,
        stopId: typeof item.stopId === "string" ? item.stopId : "",
        label: typeof item.label === "string" ? item.label : "Parada registrada",
        status: item.status,
        at: item.at,
        kilos: typeof item.kilos === "number" && Number.isFinite(item.kilos) ? item.kilos : 0,
      }];
    });
  } catch {
    return [];
  }
}

export default function ManagerPanel({ localSummary }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const renderedHeadingRef = useRef(0);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: true });
    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    const controller = new AbortController();
    void getRoadRoute(STOPS, controller.signal).then((roadPoints) => {
      if (!roadPoints.length || controller.signal.aborted) return;
      L.polyline(roadPoints, {
        color: "#1d8062", weight: 5, opacity: 0.82,
        lineCap: "round", lineJoin: "round", smoothFactor: 1,
      }).addTo(map).bringToBack();
    }).catch(() => {});
    STOPS.forEach((stop, index) => {
      const label = stop.address ?? `Punto GPS ${stop.id}`;
      L.circleMarker([stop.lat, stop.lng], {
        radius: 5, color: "#fff", weight: 2, fillColor: "#173e33", fillOpacity: 1,
      }).bindTooltip(`${index + 1}. ${label}`).addTo(map);
    });
    map.fitBounds(L.latLngBounds(STOPS.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12));
    mapRef.current = map;
    return () => { controller.abort(); map.remove(); mapRef.current = null; };
  }, [localSummary.presentationMode]);

  const changeMapStyle = (style: "streets" | "satellite") => {
    const map = mapRef.current;
    if (!map || style === mapStyle) return;
    baseLayerRef.current?.removeFrom(map);
    baseLayerRef.current = style === "streets"
      ? L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imágenes &copy; Esri" });
    baseLayerRef.current.addTo(map).bringToBack();
    setMapStyle(style);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/tracking", { cache: "no-store" });
        if (!response.ok) throw new Error("tracking unavailable");
        const data = await response.json() as { tracking: Tracking | null };
        if (!active) return;
        setTracking(data.tracking);
        setConnected(true);
        if (data.tracking && mapRef.current) {
          const point = L.latLng(data.tracking.lat, data.tracking.lng);
          const heading = data.tracking.heading ?? renderedHeadingRef.current;
          const moving = (data.tracking.speed ?? 0) >= 0.8;
          if (!truckRef.current) {
            renderedHeadingRef.current = heading;
            truckRef.current = L.marker(point, { icon: truckIcon(heading, moving), zIndexOffset: 1000 }).addTo(mapRef.current);
            truckRef.current.bindTooltip(moving ? "🚛 Camión en movimiento" : "🚛 Camión detenido", { direction: "top", offset: [0, -28] });
          } else {
            renderedHeadingRef.current = applyTruckAppearance(truckRef.current, heading, moving, renderedHeadingRef.current);
            truckRef.current.setLatLng(point);
          }
        }
      } catch {
        if (active) setConnected(false);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const useRemote = tracking !== null;
  const done = useRemote ? (tracking.done ?? tracking.completed ?? 0) : localSummary.done;
  const absent = useRemote ? (tracking.absent ?? 0) : localSummary.absent;
  const total = useRemote ? (tracking.total ?? localSummary.total) : localSummary.total;
  const pending = useRemote ? (tracking.pending ?? Math.max(0, total - done - absent)) : localSummary.pending;
  const reviewed = done + absent;
  const progress = Math.round((reviewed / Math.max(1, total)) * 100);
  const nextStop = useRemote ? (tracking.next_stop ?? null) : localSummary.nextStop;
  const kilos = useRemote ? (tracking.kilos ?? 0) : localSummary.kilos;
  const estimatedMinutes = useRemote ? (tracking.estimated_minutes ?? localSummary.estimatedMinutes) : localSummary.estimatedMinutes;
  const startedAt = useRemote ? (tracking.started_at ?? null) : localSummary.startedAt;
  const elapsedMinutes = startedAt ? Math.max(1, Math.round((clock - startedAt) / 60000)) : 0;
  const plannedKm = useRemote ? (tracking.route_km ?? localSummary.routeKm) : localSummary.routeKm;
  const actualKm = useRemote ? (tracking.actual_km ?? 0) : localSummary.gpsMetrics.actualKm;
  const movingMinutes = useRemote ? (tracking.moving_minutes ?? 0) : localSummary.gpsMetrics.movingMinutes;
  const stoppedMinutes = useRemote ? (tracking.stopped_minutes ?? 0) : localSummary.gpsMetrics.stoppedMinutes;
  const routeSavingsKm = useRemote ? (tracking.route_savings_km ?? 0) : localSummary.routeSavingsKm;
  const activities = useRemote ? readActivity(tracking.activity_json) : localSummary.activity;
  const ageSeconds = tracking ? Math.max(0, Math.round((clock - tracking.updated_at) / 1000)) : null;

  const connectionState: ConnectionState = !tracking
    ? "waiting"
    : tracking.status === "finished" || reviewed >= total
      ? "finished"
      : !connected || (ageSeconds !== null && ageSeconds > 60)
        ? "lost"
        : ageSeconds !== null && ageSeconds > 15
          ? "delayed"
          : "live";

  const connectionLabel: Record<ConnectionState, string> = {
    waiting: "Esperando al conductor",
    live: "Ubicación en vivo",
    delayed: "Señal atrasada",
    lost: "Sin señal del camión",
    finished: "Jornada finalizada",
  };

  const connectionColors: Record<ConnectionState, { background: string; color: string; borderColor: string }> = {
    waiting: { background: "#eef2eb", color: "#55645e", borderColor: "#dbe1dc" },
    live: { background: "#dff5e9", color: "#176340", borderColor: "#a9dfc2" },
    delayed: { background: "#fff3d6", color: "#7b5513", borderColor: "#efd28c" },
    lost: { background: "#fde5df", color: "#8b3929", borderColor: "#efb5a7" },
    finished: { background: "#e8ecff", color: "#364b88", borderColor: "#bcc7ef" },
  };

  const lastUpdateText = tracking
    ? `Último dato: ${formatLastUpdate(tracking.updated_at)}${ageSeconds !== null ? ` · hace ${ageSeconds} s` : ""}`
    : "La ubicación aparecerá cuando el conductor active el GPS";

  return (
    <section className="manager-view">
      <div className="manager-heading">
        <div><p className="eyebrow"><span /> Supervisión de la jornada</p><h1>Panel de jefatura</h1><p>Avance, incidencias, métricas y ubicación del camión en una sola pantalla.</p></div>
        <div
          className="connection-badge"
          style={{ ...connectionColors[connectionState], border: `1px solid ${connectionColors[connectionState].borderColor}` }}
          role="status"
          aria-live="polite"
        ><i />{connectionLabel[connectionState]}</div>
      </div>

      {(connectionState === "delayed" || connectionState === "lost") && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${connectionColors[connectionState].borderColor}`,
            background: connectionColors[connectionState].background,
            color: connectionColors[connectionState].color,
            fontWeight: 800,
          }}
        >
          {connectionState === "lost"
            ? "La ubicación dejó de actualizarse. Se conserva el último punto conocido; confirma que el conductor tenga GPS e internet activos."
            : "La ubicación está llegando con retraso. El mapa puede mostrar una posición anterior del camión."}
          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600 }}>{lastUpdateText}</div>
        </div>
      )}

      <div className="manager-kpi-grid">
        <article className="success"><span>Retiros realizados</span><strong>{done}</strong><small>de {total} viviendas</small></article>
        <article className="warning"><span>Ausentes</span><strong>{absent}</strong><small>visitas sin retiro</small></article>
        <article><span>Pendientes</span><strong>{pending}</strong><small>por visitar</small></article>
        <article><span>Material registrado</span><strong>{kilos > 0 ? `${kilos.toLocaleString("es-CL", { maximumFractionDigits: 1 })} kg` : "—"}</strong><small>{kilos > 0 ? "acumulado de hoy" : "por medir en terreno"}</small></article>
      </div>

      <div className="manager-grid">
        <div className="manager-map-card">
          <div className="map-style-switch manager-map-switch" aria-label="Cambiar tipo de mapa de jefatura">
            <button className={mapStyle === "streets" ? "active" : ""} onClick={() => changeMapStyle("streets")}>Calles</button>
            <button className={mapStyle === "satellite" ? "active" : ""} onClick={() => changeMapStyle("satellite")}>Satélite</button>
            <a href="https://www.google.com/maps/@?api=1&map_action=map&center=-41.461,-72.899&zoom=16" target="_blank" rel="noreferrer">Google Maps ↗</a>
          </div>
          <div ref={mapElement} className="manager-map" aria-label="Ubicación compartida del camión" />
          <div className="manager-map-footer">{lastUpdateText}</div>
        </div>

        <aside className="manager-summary">
          <span className="manager-kicker">Jornada Santuario · Viernes</span>
          <div className="manager-progress-line"><div className="manager-progress-number">{progress}%</div><span>del recorrido revisado</span></div>
          <div className="progress-track manager-track"><i style={{ width: `${progress}%` }} /></div>

          <div className="manager-operational-metrics">
            <div><span>Tiempo transcurrido</span><strong>{startedAt ? formatMinutes(elapsedMinutes) : "Sin iniciar"}</strong></div>
            <div><span>Tiempo restante</span><strong>{connectionState === "finished" ? "Finalizado" : `~${formatMinutes(estimatedMinutes)}`}</strong></div>
            <div><span>Ruta planificada</span><strong>{plannedKm.toFixed(1)} km</strong></div>
            <div><span>Recorrido GPS</span><strong>{actualKm.toFixed(2)} km</strong></div>
            <div><span>En movimiento</span><strong>{formatMinutes(movingMinutes)}</strong></div>
            <div><span>Detenido</span><strong>{formatMinutes(stoppedMinutes)}</strong></div>
            <div><span>Ahorro vs. base</span><strong>{routeSavingsKm > 0.01 ? `${routeSavingsKm.toFixed(2)} km` : "Por medir"}</strong></div>
          </div>

          <div className="manager-next"><span>Próxima parada</span><strong>{nextStop || (reviewed >= total ? "Recorrido finalizado" : "Esperando inicio")}</strong></div>

          <div className="manager-activity">
            <div className="manager-activity-head"><strong>Actividad reciente</strong><span>{connectionState === "live" ? "En vivo" : "Últimos registros"}</span></div>
            {activities.length ? activities.slice(0, 6).map((entry) => (
              <div className="activity-row" key={entry.id}>
                <i className={entry.status} />
                <span><strong>{entry.label}</strong><small>{entry.status === "done" ? `Retiro realizado${entry.kilos > 0 ? ` · ${entry.kilos.toLocaleString("es-CL")} kg` : ""}` : "Marcada como ausente"}</small></span>
                <time>{new Date(entry.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            )) : <p className="manager-note">Las visitas registradas por el conductor aparecerán aquí.</p>}
          </div>

          {loading && <p className="manager-note">Conectando con el seguimiento del camión…</p>}
        </aside>
      </div>

      <div className="manager-next-stage">
        <span>Datos del piloto</span>
        <strong>Ruta planificada, kilómetros reales y tiempos ya se miden durante la jornada.</strong>
        <p>Al finalizar podrás comparar el orden original con Ruta Verde usando datos del recorrido real.</p>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STOPS } from "./route-data";
import { getRoadRoute } from "./road-route";
import { applyTruckAppearance, bearingBetween, truckIcon } from "./truck-marker";

type SimStatus = "pending" | "done" | "absent";
type SimActivity = {
  stopId: string;
  status: Exclude<SimStatus, "pending">;
  at: number;
};

type Props = {
  onClose: () => void;
};

const DEMO_STOPS = STOPS.slice(0, 5);

function stopAddress(stop?: (typeof DEMO_STOPS)[number]) {
  return stop?.address ?? (stop ? `Punto GPS ${stop.id}` : "Punto GPS registrado");
}

function nearestIndexes(points: L.LatLng[], stops: typeof DEMO_STOPS) {
  let startAt = 0;
  return stops.map((stop) => {
    const target = L.latLng(stop.lat, stop.lng);
    let bestIndex = startAt;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = startAt; index < points.length; index += 1) {
      const candidateDistance = points[index].distanceTo(target);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        bestIndex = index;
      }
    }
    startAt = bestIndex;
    return bestIndex;
  });
}

export default function RouteSimulation({ onClose }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const roadLayerRef = useRef<L.Polyline | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const routePointsRef = useRef<L.LatLng[]>(DEMO_STOPS.map((stop) => L.latLng(stop.lat, stop.lng)));
  const stopIndexesRef = useRef<number[]>(DEMO_STOPS.map((_, index) => index));
  const pathIndexRef = useRef(0);
  const renderedHeadingRef = useRef(0);
  const driveTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const currentIndexRef = useRef(0);

  const [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<"driver" | "manager">("driver");
  const [statuses, setStatuses] = useState<Record<string, SimStatus>>({});
  const [activity, setActivity] = useState<SimActivity[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [moving, setMoving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lastMessage, setLastMessage] = useState("La voz te irá indicando qué hacer durante el ensayo.");

  const speak = useCallback((message: string) => {
    setLastMessage(message);
    if (mutedRef.current || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const voice = new SpeechSynthesisUtterance(message);
    voice.lang = "es-CL";
    voice.rate = 0.96;
    voice.pitch = 1;
    window.speechSynthesis.speak(voice);
  }, []);

  const clearDriveTimer = useCallback(() => {
    if (driveTimerRef.current !== null) window.clearInterval(driveTimerRef.current);
    driveTimerRef.current = null;
  }, []);

  const driveToStop = useCallback((stopIndex: number) => {
    clearDriveTimer();
    const points = routePointsRef.current;
    const targetIndex = stopIndexesRef.current[stopIndex] ?? points.length - 1;
    const arrive = () => {
      const stop = DEMO_STOPS[stopIndex];
      const marker = truckRef.current;
      marker?.setLatLng([stop.lat, stop.lng]);
      if (marker) renderedHeadingRef.current = applyTruckAppearance(marker, renderedHeadingRef.current, false, renderedHeadingRef.current);
      mapRef.current?.panTo([stop.lat, stop.lng], { animate: true, duration: 0.5 });
      setMoving(false);
      navigator.vibrate?.(140);
      speak(`Llegaste a la dirección ${stopAddress(stop)}. Selecciona retiro realizado o ausente.`);
    };

    if (targetIndex <= pathIndexRef.current || !points.length) {
      window.setTimeout(arrive, 180);
      return;
    }

    setMoving(true);
    driveTimerRef.current = window.setInterval(() => {
      const remaining = targetIndex - pathIndexRef.current;
      pathIndexRef.current = Math.min(targetIndex, pathIndexRef.current + Math.max(1, Math.ceil(remaining / 12)));
      const point = points[pathIndexRef.current];
      const marker = truckRef.current;
      if (marker) {
        const previousPoint = marker.getLatLng();
        const heading = previousPoint.distanceTo(point) > 0.5 ? bearingBetween(previousPoint, point) : renderedHeadingRef.current;
        renderedHeadingRef.current = applyTruckAppearance(marker, heading, true, renderedHeadingRef.current);
        marker.setLatLng(point);
      }
      if (pathIndexRef.current >= targetIndex) {
        clearDriveTimer();
        arrive();
      }
    }, 95);
  }, [clearDriveTimer, speak]);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) window.speechSynthesis?.cancel();
  }, [muted]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;
    const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);

    const fallbackPoints = DEMO_STOPS.map((stop) => L.latLng(stop.lat, stop.lng));
    roadLayerRef.current = L.polyline(fallbackPoints, {
      color: "#1d8062",
      weight: 6,
      opacity: 0.86,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    truckRef.current = L.marker(fallbackPoints[0], { icon: truckIcon(0, false), zIndexOffset: 1200 }).addTo(map);
    truckRef.current.bindTooltip("Camión de prueba · GPS simulado", { direction: "top" });
    map.fitBounds(L.latLngBounds(fallbackPoints).pad(0.3));
    setMapReady(true);

    const controller = new AbortController();
    void getRoadRoute(DEMO_STOPS, controller.signal).then((roadPoints) => {
      if (controller.signal.aborted || !roadPoints.length) return;
      const points = roadPoints.map((point) => L.latLng(point));
      routePointsRef.current = points;
      stopIndexesRef.current = nearestIndexes(points, DEMO_STOPS);
      pathIndexRef.current = stopIndexesRef.current[currentIndexRef.current] ?? 0;
      roadLayerRef.current?.setLatLngs(points);
      truckRef.current?.setLatLng(points[pathIndexRef.current]);
      map.fitBounds(L.latLngBounds(points).pad(0.12));
    }).catch(() => {
      setLastMessage("Simulación lista. El trazado simplificado funciona aunque no haya conexión.");
    });

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 160);
    return () => {
      controller.abort();
      window.clearTimeout(resizeTimer);
      clearDriveTimer();
      window.speechSynthesis?.cancel();
      map.remove();
      mapRef.current = null;
    };
  }, [clearDriveTimer]);

  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer || !mapReady) return;
    layer.clearLayers();
    DEMO_STOPS.forEach((stop, index) => {
      const state = statuses[stop.id] ?? "pending";
      const active = index === currentIndex && !finished;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "stop-marker-wrap",
          html: `<span class="street-stop ${state} ${active ? "active" : ""}">${index + 1}</span>`,
          iconSize: active ? [36, 36] : [28, 28],
          iconAnchor: active ? [18, 18] : [14, 14],
        }),
      }).addTo(layer);
      marker.bindTooltip(`${stopAddress(stop)} · ${state === "done" ? "Realizado" : state === "absent" ? "Ausente" : active ? "Siguiente" : "Pendiente"}`);
    });
  }, [currentIndex, finished, mapReady, statuses]);

  const counts = useMemo(() => {
    const values = Object.values(statuses);
    const done = values.filter((status) => status === "done").length;
    const absent = values.filter((status) => status === "absent").length;
    return { done, absent, pending: DEMO_STOPS.length - done - absent, reviewed: done + absent };
  }, [statuses]);

  const recommendedAction = currentIndex < 2 ? "Retiro realizado" : currentIndex === 2 ? "Ausente" : "Elige cualquier resultado";

  const startSimulation = () => {
    setStarted(true);
    setFinished(false);
    speak(`Simulación iniciada. GPS de prueba activo. Primera parada: ${stopAddress(DEMO_STOPS[0])}. Registra el retiro para continuar.`);
  };

  const register = (status: Exclude<SimStatus, "pending">) => {
    if (!started || moving || finished) return;
    const stop = DEMO_STOPS[currentIndex];
    const now = Date.now();
    setStatuses((old) => ({ ...old, [stop.id]: status }));
    setActivity((old) => [{ stopId: stop.id, status, at: now }, ...old]);

    if (currentIndex >= DEMO_STOPS.length - 1) {
      setFinished(true);
      speak("Ensayo completado. Cambia a Jefatura simulada para presentar el resumen.");
      return;
    }

    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    speak(`${status === "done" ? "Retiro registrado" : "Ausencia registrada"}. Avanzando a ${stopAddress(DEMO_STOPS[nextIndex])}.`);
    driveToStop(nextIndex);
  };

  const resetSimulation = () => {
    clearDriveTimer();
    setStatuses({});
    setActivity([]);
    setCurrentIndex(0);
    setStarted(false);
    setMoving(false);
    setFinished(false);
    setMode("driver");
    pathIndexRef.current = stopIndexesRef.current[0] ?? 0;
    const first = DEMO_STOPS[0];
    truckRef.current?.setLatLng([first.lat, first.lng]);
    if (truckRef.current) renderedHeadingRef.current = applyTruckAppearance(truckRef.current, renderedHeadingRef.current, false, renderedHeadingRef.current);
    mapRef.current?.panTo([first.lat, first.lng]);
    speak("Simulación reiniciada. Los datos reales siguen intactos.");
  };

  const switchMode = (nextMode: "driver" | "manager") => {
    setMode(nextMode);
    if (nextMode === "manager") speak(`Vista de jefatura. ${counts.reviewed} paradas revisadas, ${counts.pending} pendientes y ${counts.absent} ausentes en el ensayo.`);
    window.setTimeout(() => mapRef.current?.invalidateSize(), 100);
  };

  const closeSimulation = () => {
    clearDriveTimer();
    window.speechSynthesis?.cancel();
    onClose();
  };

  return (
    <div className="simulation-backdrop" role="dialog" aria-modal="true" aria-labelledby="simulation-title">
      <section className="simulation-shell">
        <header className="simulation-header">
          <div>
            <span className="simulation-safe-badge">SIMULACIÓN · DATOS DE PRUEBA</span>
            <h2 id="simulation-title">Ensayo del recorrido</h2>
            <p>Practica el flujo completo sin activar el GPS ni modificar la jornada real.</p>
          </div>
          <button className="simulation-close" onClick={closeSimulation} aria-label="Cerrar simulación">×</button>
        </header>

        <div className="simulation-toolbar">
          <div className="simulation-tabs" aria-label="Vista de la simulación">
            <button className={mode === "driver" ? "active" : ""} onClick={() => switchMode("driver")}>Conductor</button>
            <button className={mode === "manager" ? "active" : ""} onClick={() => switchMode("manager")}>Jefatura simulada</button>
          </div>
          <div className="simulation-toolbar-actions">
            <button onClick={() => setMuted((value) => !value)}>{muted ? "🔇 Activar voz" : "🔊 Voz activa"}</button>
            <button onClick={() => speak(lastMessage)} disabled={muted}>Repetir indicación</button>
            <button onClick={resetSimulation}>Reiniciar ensayo</button>
          </div>
        </div>

        <div className={mode === "driver" ? "simulation-driver-grid" : "simulation-map-hidden"}>
          <article className="simulation-map-card">
            <div className="simulation-map-head">
              <div><span className={`gps-pulse ${started ? "on" : ""}`} /><strong>{started ? moving ? "Camión de prueba en movimiento" : "GPS simulado activo" : "GPS simulado detenido"}</strong></div>
              <small>No usa tu ubicación real</small>
            </div>
            <div ref={mapElement} className="simulation-map" aria-label="Mapa del recorrido simulado" />
            <div className="simulation-voice-line"><span>🔊</span><p>{lastMessage}</p></div>
          </article>

          <aside className="simulation-control-card">
            <div className="simulation-cue">
              <span>Tu siguiente acción</span>
              <strong>{started ? recommendedAction : "Iniciar simulación"}</strong>
            </div>
            {!started ? <>
              <span className="simulation-stop-number" aria-hidden="true">📍</span>
              <h3>Todo listo para practicar</h3>
              <p>El ensayo usa cinco direcciones del recorrido, una voz guía y un camión animado.</p>
              <button className="simulation-start" onClick={startSimulation}>▶ Iniciar simulación con voz</button>
            </> : <>
              <span className="simulation-stop-number" aria-hidden="true">📍</span>
              <h3>{finished ? "Ensayo de conductor listo" : stopAddress(DEMO_STOPS[currentIndex])}</h3>
              <p>{finished ? "Ya puedes abrir Jefatura simulada y cerrar la presentación." : moving ? "El camión se está acercando a la próxima parada…" : "Registra el resultado para que el camión continúe."}</p>
              {!finished && <>
                <button className="simulation-done" onClick={() => register("done")} disabled={moving}>✓ Retiro realizado · siguiente</button>
                <button className="simulation-absent" onClick={() => register("absent")} disabled={moving}>No estaba · marcar ausente</button>
              </>}
              {(counts.reviewed >= 3 || finished) && <button className="simulation-manager-action" onClick={() => switchMode("manager")}>Ver resumen en Jefatura →</button>}
            </>}
            <div className="simulation-mini-stats">
              <div><span>Realizadas</span><strong>{counts.done}</strong></div>
              <div><span>Ausentes</span><strong>{counts.absent}</strong></div>
              <div><span>Pendientes</span><strong>{counts.pending}</strong></div>
            </div>
            <div className="simulation-progress"><i style={{ width: `${(counts.reviewed / DEMO_STOPS.length) * 100}%` }} /></div>
            <small className="simulation-rehearsal-note">Ensayo recomendado: 2 retiros realizados y luego 1 ausencia.</small>
          </aside>
        </div>

        {mode === "manager" && <section className="simulation-manager-view">
          <div className="simulation-manager-heading">
            <div><span>JEFATURA · ENSAYO</span><h3>Avance del recorrido</h3><p>Resumen instantáneo de lo registrado por el conductor.</p></div>
            <div className="simulation-live-badge"><i /> Datos simulados en vivo</div>
          </div>
          <div className="simulation-kpis">
            <article><span>Avance</span><strong>{Math.round((counts.reviewed / DEMO_STOPS.length) * 100)}%</strong><small>{counts.reviewed} de {DEMO_STOPS.length} revisadas</small></article>
            <article className="success"><span>Realizadas</span><strong>{counts.done}</strong><small>retiros confirmados</small></article>
            <article className="warning"><span>Ausentes</span><strong>{counts.absent}</strong><small>para seguimiento</small></article>
            <article><span>Pendientes</span><strong>{counts.pending}</strong><small>en este ensayo</small></article>
          </div>
          <div className="simulation-manager-grid">
            <article className="simulation-summary-card">
              <span className="simulation-card-kicker">Resumen operativo</span>
              <div className="simulation-big-progress"><strong>{counts.reviewed}</strong><span>/ {DEMO_STOPS.length}<small>paradas revisadas</small></span></div>
              <div className="simulation-progress manager"><i style={{ width: `${(counts.reviewed / DEMO_STOPS.length) * 100}%` }} /></div>
              <div className="simulation-summary-rows">
                <p><span>Siguiente parada</span><strong>{finished ? "Ensayo completado" : stopAddress(DEMO_STOPS[currentIndex])}</strong></p>
                <p><span>Estado del vehículo</span><strong>{moving ? "En movimiento" : started ? "En parada" : "Sin iniciar"}</strong></p>
                <p><span>Jornada real</span><strong>Sin cambios · 41 viviendas</strong></p>
              </div>
            </article>
            <article className="simulation-activity-card">
              <div><span className="simulation-card-kicker">Actividad reciente</span><strong>{activity.length} registros</strong></div>
              {activity.length ? activity.map((entry) => <div className="simulation-activity-row" key={`${entry.stopId}-${entry.at}`}>
                <i className={entry.status} />
                <span><strong>{stopAddress(DEMO_STOPS.find((stop) => stop.id === entry.stopId))}</strong><small>{entry.status === "done" ? "Retiro realizado" : "Ausente"}</small></span>
                <time>{new Date(entry.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>) : <p className="simulation-empty">Registra una parada en Conductor para verla aquí.</p>}
            </article>
          </div>
        </section>}

        <footer className="simulation-script">
          <div><span>CIERRE SUGERIDO</span><strong>“La siguiente etapa es medir kilómetros y tiempo ahorrado durante un recorrido real”.</strong></div>
          <button onClick={() => speak("La siguiente etapa es medir kilómetros y tiempo ahorrado durante un recorrido real.")}>🔊 Escuchar frase final</button>
        </footer>
      </section>
    </div>
  );
}

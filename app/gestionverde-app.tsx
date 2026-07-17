"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { STOPS, type Stop } from "./route-data";
import ManagerPanel, { type LocalSummary } from "./manager-panel";
import { EMPTY_GPS_METRICS } from "./tracking-types";
import {
  appendJourneyHistory,
  emptyRecord,
  loadCleanJourney,
  loadJourneyHistory,
  resetCleanJourney,
  saveCleanJourney,
  type CleanJourneyState,
  type JourneyHistoryEntry,
  type PositionSnapshot,
  type StopRecord,
  type StopStatus,
} from "./gestionverde-storage";
import "./gestionverde-v2.css";

const GestionVerdeMap = dynamic(() => import("./gestionverde-map"), {
  ssr: false,
  loading: () => <div className="gv-map-loading">Preparando mapa, ruta y GPS…</div>,
});

type Role = "driver" | "manager" | "superadmin";
type View = "route" | "stops" | "dashboard" | "history";
type Props = { role: Role };

const MATERIALS = ["Mixto", "Orgánico", "Vidrio", "Plástico", "Cartón", "Latas", "Otro"];

function formatDuration(milliseconds: number) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
}

function addressOf(stop: Stop) {
  return stop.address ?? stop.name;
}

function numericKilos(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function roleLabel(role: Role) {
  return role === "driver" ? "Conductor" : role === "manager" ? "Jefatura" : "Superadministrador";
}

async function compressPhoto(file: File) {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = source;
  });
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export default function GestionVerdeApp({ role }: Props) {
  const [state, setState] = useState<CleanJourneyState>(() => loadCleanJourney(STOPS));
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>(role === "manager" ? "dashboard" : "route");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  const [history, setHistory] = useState<JourneyHistoryEntry[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const lastAnnouncedRef = useRef<string | null>(null);

  useEffect(() => {
    setState(loadCleanJourney(STOPS));
    setHistory(loadJourneyHistory());
    setOnline(navigator.onLine);
    setHydrated(true);
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (hydrated) saveCleanJourney(state);
  }, [state, hydrated]);

  const records = state.records;
  const orderedStops = STOPS;
  const current = orderedStops.find((stop) => (records[stop.id]?.status ?? "pending") === "pending");
  const selectedStop = orderedStops.find((stop) => stop.id === selectedStopId) ?? current ?? orderedStops[0];
  const selectedRecord = selectedStop ? records[selectedStop.id] ?? emptyRecord() : null;
  const done = orderedStops.filter((stop) => records[stop.id]?.status === "done").length;
  const absent = orderedStops.filter((stop) => records[stop.id]?.status === "absent").length;
  const pending = Math.max(0, orderedStops.length - done - absent);
  const reviewed = done + absent;
  const progress = Math.round((reviewed / Math.max(1, orderedStops.length)) * 100);
  const totalKilos = orderedStops.reduce((sum, stop) => sum + numericKilos(records[stop.id]?.kilos ?? ""), 0);
  const currentPause = state.phase === "paused" && state.pausedAt ? clock - state.pausedAt : 0;
  const elapsedMs = state.startedAt ? Math.max(0, (state.finishedAt ?? clock) - state.startedAt - state.pausedMs - currentPause) : 0;
  const averageMinutes = reviewed > 0 ? Math.max(1, elapsedMs / 60_000 / reviewed) : 3;
  const etaMinutes = Math.max(0, Math.round(pending * Math.min(8, Math.max(2, averageMinutes))));
  const tracking = state.phase === "active";

  const speak = useCallback((text: string) => {
    if (!state.voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const message = new SpeechSynthesisUtterance(text);
    message.lang = "es-CL";
    message.rate = 0.92;
    message.pitch = 1;
    window.speechSynthesis.speak(message);
  }, [state.voiceEnabled]);

  useEffect(() => {
    if (state.phase !== "active" || !current || lastAnnouncedRef.current === current.id) return;
    lastAnnouncedRef.current = current.id;
    const timer = window.setTimeout(() => speak(`Próxima vivienda: ${addressOf(current)}`), 350);
    return () => window.clearTimeout(timer);
  }, [current, speak, state.phase]);

  const syncTracking = useCallback(async (position: PositionSnapshot, overrideState?: CleanJourneyState) => {
    if (role === "manager") return;
    const snapshot = overrideState ?? state;
    const activity = orderedStops.flatMap((stop) => {
      const record = snapshot.records[stop.id];
      if (!record?.visitedAt || record.status === "pending") return [];
      return [{
        id: `${stop.id}-${record.visitedAt}`,
        stopId: stop.id,
        label: addressOf(stop),
        status: record.status,
        at: record.visitedAt,
        kilos: numericKilos(record.kilos),
      }];
    }).sort((a, b) => b.at - a.at);
    const payload = {
      journeyId: snapshot.routeId,
      lat: position.lat,
      lng: position.lng,
      speed: position.speedKmh / 3.6,
      heading: position.heading,
      accuracy: position.accuracy,
      nextStop: current ? addressOf(current) : null,
      completed: reviewed,
      done,
      absent,
      pending,
      total: orderedStops.length,
      kilos: totalKilos,
      routeKm: 0,
      baselineRouteKm: 0,
      routeSavingsKm: 0,
      plannedDriveMinutes: 0,
      actualKm: position.actualKm,
      movingMinutes: elapsedMs / 60_000,
      stoppedMinutes: 0,
      estimatedMinutes: etaMinutes,
      startedAt: snapshot.startedAt,
      activity,
      status: snapshot.phase === "finished" ? "finished" : snapshot.phase === "paused" ? "paused" : "active",
    };
    try {
      await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      localStorage.removeItem("gestionverde:tracking-outbox");
    } catch {
      localStorage.setItem("gestionverde:tracking-outbox", JSON.stringify(payload));
    }
  }, [absent, current, done, elapsedMs, etaMinutes, orderedStops, pending, reviewed, role, state, totalKilos]);

  useEffect(() => {
    const flush = async () => {
      const queued = localStorage.getItem("gestionverde:tracking-outbox");
      if (!queued) return;
      try {
        const response = await fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: queued });
        if (response.ok) localStorage.removeItem("gestionverde:tracking-outbox");
      } catch {}
    };
    window.addEventListener("online", flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  const onPosition = useCallback((position: PositionSnapshot) => {
    setState((old) => ({ ...old, position, updatedAt: Date.now() }));
    if (Date.now() - position.updatedAt < 10_000) void syncTracking(position);
  }, [syncTracking]);

  const begin = () => {
    const now = Date.now();
    setState((old) => ({
      ...old,
      phase: "active",
      startedAt: old.startedAt ?? now,
      finishedAt: null,
      pausedAt: null,
      updatedAt: now,
    }));
    setView("route");
    speak(current ? `Recorrido iniciado. Próxima vivienda: ${addressOf(current)}` : "Recorrido iniciado");
    setNotice("Jornada iniciada. GPS, camión y seguimiento activados.");
  };

  const pause = () => {
    const now = Date.now();
    setState((old) => ({ ...old, phase: "paused", pausedAt: now, updatedAt: now }));
    speak("Recorrido pausado");
    setNotice("Jornada pausada. La ubicación dejó de enviarse.");
  };

  const resume = () => {
    const now = Date.now();
    setState((old) => ({
      ...old,
      phase: "active",
      pausedMs: old.pausedMs + (old.pausedAt ? now - old.pausedAt : 0),
      pausedAt: null,
      updatedAt: now,
    }));
    speak(current ? `Recorrido reanudado. Próxima vivienda: ${addressOf(current)}` : "Recorrido reanudado");
    setNotice("Jornada reanudada.");
  };

  const finish = () => {
    if (!state.startedAt) return;
    if (!confirm("¿Finalizar la jornada y guardar el resumen?")) return;
    const finishedAt = Date.now();
    const nextState: CleanJourneyState = { ...state, phase: "finished", finishedAt, pausedAt: null, updatedAt: finishedAt };
    setState(nextState);
    appendJourneyHistory({
      id: `${state.routeId}-${finishedAt}`,
      startedAt: state.startedAt,
      finishedAt,
      done,
      absent,
      total: orderedStops.length,
      actualKm: state.position?.actualKm ?? 0,
    });
    setHistory(loadJourneyHistory());
    if (state.position) void syncTracking(state.position, nextState);
    speak(`Jornada finalizada. ${done} retiros realizados y ${absent} viviendas ausentes.`);
    setView("dashboard");
    setNotice("Jornada finalizada y guardada en el historial.");
  };

  const setStatus = (stop: Stop, status: StopStatus) => {
    const now = Date.now();
    setState((old) => ({
      ...old,
      startedAt: old.startedAt ?? now,
      phase: old.phase === "idle" ? "active" : old.phase,
      records: {
        ...old.records,
        [stop.id]: {
          ...(old.records[stop.id] ?? emptyRecord()),
          status,
          visitedAt: status === "pending" ? null : now,
        },
      },
      updatedAt: now,
    }));
    setSelectedStopId(null);
    const remaining = Math.max(0, pending - (status === "pending" ? 0 : 1));
    speak(status === "done" ? `Vivienda completada. Quedan ${remaining} viviendas.` : status === "absent" ? `Vivienda marcada como ausente. Quedan ${remaining} viviendas.` : "Vivienda devuelta a pendiente");
    setNotice(status === "done" ? `${addressOf(stop)} registrada como realizada.` : status === "absent" ? `${addressOf(stop)} registrada como ausente.` : `${addressOf(stop)} volvió a pendiente.`);
  };

  const updateRecord = (stopId: string, patch: Partial<StopRecord>) => {
    setState((old) => ({
      ...old,
      records: {
        ...old.records,
        [stopId]: { ...(old.records[stopId] ?? emptyRecord()), ...patch },
      },
      updatedAt: Date.now(),
    }));
  };

  const addPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedStop) return;
    const existing = records[selectedStop.id]?.photos ?? [];
    if (existing.length >= 3) {
      setNotice("Cada vivienda admite hasta 3 fotografías comprimidas.");
      event.target.value = "";
      return;
    }
    setPhotoBusy(true);
    try {
      const dataUrl = await compressPhoto(file);
      updateRecord(selectedStop.id, {
        photos: [...existing, { id: `${selectedStop.id}-${Date.now()}`, name: file.name, dataUrl, createdAt: Date.now() }],
      });
      setNotice("Fotografía guardada en el teléfono.");
    } catch {
      setNotice("No fue posible procesar la fotografía.");
    } finally {
      setPhotoBusy(false);
      event.target.value = "";
    }
  };

  const removePhoto = (photoId: string) => {
    if (!selectedStop || !selectedRecord) return;
    updateRecord(selectedStop.id, { photos: selectedRecord.photos.filter((photo) => photo.id !== photoId) });
  };

  const onArrival = useCallback((stop: Stop, meters: number) => {
    setNotice(`Llegaste a ${addressOf(stop)} · ${meters} m.`);
    speak(`Ha llegado al destino: ${addressOf(stop)}`);
    setSelectedStopId(stop.id);
  }, [speak]);

  const reset = () => {
    if (!confirm("¿Borrar el avance, fotos y observaciones de la jornada actual?")) return;
    setState(resetCleanJourney(STOPS));
    setSelectedStopId(null);
    lastAnnouncedRef.current = null;
    setNotice("Jornada reiniciada. El historial anterior se mantiene.");
  };

  const exportCsv = () => {
    const rows = [["Orden", "Vivienda", "Dirección", "Estado", "Hora", "Kilos", "Material", "Observaciones", "Fotos"]];
    orderedStops.forEach((stop, index) => {
      const record = records[stop.id] ?? emptyRecord();
      rows.push([
        String(index + 1), stop.name, addressOf(stop), record.status,
        record.visitedAt ? new Date(record.visitedAt).toLocaleString("es-CL") : "",
        record.kilos, record.material, record.note, String(record.photos.length),
      ]);
    });
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `gestionverde-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const localSummary = useMemo<LocalSummary>(() => ({
    total: orderedStops.length,
    done,
    absent,
    pending,
    nextStop: current ? addressOf(current) : null,
    startedAt: state.startedAt,
    kilos: totalKilos,
    estimatedMinutes: etaMinutes,
    routeKm: 0,
    baselineRouteKm: 0,
    routeSavingsKm: 0,
    plannedDriveMinutes: 0,
    gpsMetrics: { ...EMPTY_GPS_METRICS, actualKm: state.position?.actualKm ?? 0 },
    activity: orderedStops.flatMap((stop) => {
      const record = records[stop.id];
      if (!record?.visitedAt || record.status === "pending") return [];
      return [{ id: `${stop.id}-${record.visitedAt}`, stopId: stop.id, label: addressOf(stop), status: record.status, at: record.visitedAt, kilos: numericKilos(record.kilos) }];
    }).sort((a, b) => b.at - a.at),
    presentationMode: false,
  }), [absent, current, done, etaMinutes, orderedStops, pending, records, state.position?.actualKm, state.startedAt, totalKilos]);

  if (!hydrated) return <div className="gv-boot">Preparando GestiónVerde…</div>;

  return (
    <main className="gv-app">
      <header className="gv-topbar">
        <div className="gv-brand">
          <Image src="/icon-192.png" width={44} height={44} alt="GestiónVerde" priority unoptimized />
          <div><strong>GestiónVerde</strong><span>Operación de reciclaje · {roleLabel(role)}</span></div>
        </div>
        <div className="gv-top-actions">
          <button className={state.voiceEnabled ? "gv-icon-button active" : "gv-icon-button"} onClick={() => setState((old) => ({ ...old, voiceEnabled: !old.voiceEnabled }))} aria-label="Activar o desactivar voz">{state.voiceEnabled ? "🔊" : "🔇"}</button>
          <span className={online ? "gv-online" : "gv-online offline"}><i />{online ? "En línea" : "Modo offline"}</span>
        </div>
      </header>

      <section className="gv-status-strip">
        <div><span>Jornada</span><strong>{state.phase === "idle" ? "Sin iniciar" : state.phase === "active" ? "En curso" : state.phase === "paused" ? "Pausada" : "Finalizada"}</strong></div>
        <div><span>Avance</span><strong>{progress}%</strong></div>
        <div><span>GPS</span><strong>{state.position ? `${state.position.speedKmh.toFixed(0)} km/h` : "Esperando"}</strong></div>
        <div><span>Tiempo</span><strong>{state.startedAt ? formatDuration(elapsedMs) : "0 min"}</strong></div>
      </section>

      {notice && <div className="gv-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

      <div className="gv-content">
        {view === "route" && (
          <section className="gv-route-layout">
            <div className="gv-map-column">
              <GestionVerdeMap
                stops={orderedStops}
                records={records}
                activeStop={current}
                tracking={tracking}
                initialPosition={state.position}
                onPosition={onPosition}
                onArrival={onArrival}
              />
              <div className="gv-route-kpis">
                <article><span>Realizadas</span><strong>{done}</strong></article>
                <article><span>Ausentes</span><strong>{absent}</strong></article>
                <article><span>Pendientes</span><strong>{pending}</strong></article>
                <article><span>Recorrido GPS</span><strong>{(state.position?.actualKm ?? 0).toFixed(2)} km</strong></article>
              </div>
            </div>

            <aside className="gv-next-card">
              <div className="gv-next-top"><span className="gv-pulse" />Próximo destino</div>
              {current ? (
                <>
                  <div className="gv-destination-index">{orderedStops.findIndex((stop) => stop.id === current.id) + 1}</div>
                  <h1>{addressOf(current)}</h1>
                  <p>{current.name} · {pending} viviendas pendientes</p>
                  <div className="gv-next-meta">
                    <div><span>Estado</span><strong>Pendiente</strong></div>
                    <div><span>ETA estimada</span><strong>~{etaMinutes} min</strong></div>
                    <div><span>Precisión GPS</span><strong>{state.position?.accuracy ? `±${Math.round(state.position.accuracy)} m` : "—"}</strong></div>
                  </div>
                  <a className="gv-primary" href={`https://www.google.com/maps/dir/?api=1&destination=${current.lat},${current.lng}&travelmode=driving`} target="_blank" rel="noreferrer">🧭 Navegar a la vivienda</a>
                  <button className="gv-success" onClick={() => setStatus(current, "done")}>✓ Retiro realizado</button>
                  <button className="gv-danger" onClick={() => setStatus(current, "absent")}>No estaba · marcar ausente</button>
                  <button className="gv-secondary" onClick={() => setSelectedStopId(current.id)}>📸 Foto y observaciones</button>
                </>
              ) : (
                <div className="gv-finished-card"><span>✓</span><strong>Recorrido revisado</strong><p>Ya no quedan viviendas pendientes.</p></div>
              )}

              <div className="gv-journey-controls">
                {state.phase === "idle" && <button className="start" onClick={begin}>▶ Iniciar recorrido</button>}
                {state.phase === "active" && <button className="pause" onClick={pause}>Ⅱ Pausar jornada</button>}
                {state.phase === "paused" && <button className="start" onClick={resume}>▶ Continuar recorrido</button>}
                {(state.phase === "active" || state.phase === "paused") && <button className="finish" onClick={finish}>■ Finalizar jornada</button>}
                {state.phase === "finished" && <button className="secondary" onClick={reset}>Nueva jornada</button>}
              </div>
            </aside>
          </section>
        )}

        {view === "stops" && (
          <section className="gv-panel">
            <div className="gv-section-heading"><div><span>Viviendas</span><h1>Control del recorrido</h1></div><strong>{reviewed}/{orderedStops.length}</strong></div>
            <div className="gv-stop-grid">
              {orderedStops.map((stop, index) => {
                const record = records[stop.id] ?? emptyRecord();
                return (
                  <article className={`gv-stop-card ${record.status} ${current?.id === stop.id ? "current" : ""}`} key={stop.id}>
                    <button className="gv-stop-open" onClick={() => setSelectedStopId(stop.id)}>
                      <span className="gv-stop-number">{String(index + 1).padStart(2, "0")}</span>
                      <span><strong>{addressOf(stop)}</strong><small>{stop.name} · {record.material}{record.photos.length ? ` · ${record.photos.length} foto(s)` : ""}</small></span>
                      <em>{record.status === "done" ? "Realizada" : record.status === "absent" ? "Ausente" : current?.id === stop.id ? "Siguiente" : "Pendiente"}</em>
                    </button>
                    <div className="gv-stop-actions">
                      <button onClick={() => setStatus(stop, "done")}>✓</button>
                      <button onClick={() => setStatus(stop, "absent")}>×</button>
                      {record.status !== "pending" && <button onClick={() => setStatus(stop, "pending")}>↶</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {view === "dashboard" && (
          role === "manager" ? <ManagerPanel localSummary={localSummary} /> : (
            <section className="gv-panel gv-dashboard">
              <div className="gv-section-heading"><div><span>Resumen en vivo</span><h1>Dashboard de jornada</h1></div><div className="gv-live-badge"><i />Actualización automática</div></div>
              <div className="gv-dashboard-grid">
                <article className="green"><span>Retiros realizados</span><strong>{done}</strong><small>de {orderedStops.length} viviendas</small></article>
                <article className="red"><span>Ausentes</span><strong>{absent}</strong><small>sin retiro</small></article>
                <article><span>Pendientes</span><strong>{pending}</strong><small>por visitar</small></article>
                <article><span>Material</span><strong>{totalKilos ? `${totalKilos.toFixed(1)} kg` : "—"}</strong><small>registrado</small></article>
                <article><span>Tiempo activo</span><strong>{formatDuration(elapsedMs)}</strong><small>{state.phase === "paused" ? "jornada pausada" : "tiempo operativo"}</small></article>
                <article><span>Recorrido GPS</span><strong>{(state.position?.actualKm ?? 0).toFixed(2)} km</strong><small>distancia real</small></article>
                <article><span>Velocidad</span><strong>{state.position ? `${state.position.speedKmh.toFixed(0)} km/h` : "—"}</strong><small>última lectura</small></article>
                <article><span>Tiempo restante</span><strong>~{etaMinutes} min</strong><small>según ritmo actual</small></article>
              </div>
              <div className="gv-report-card">
                <div><span>Avance general</span><strong>{progress}%</strong></div>
                <div className="gv-progress"><i style={{ width: `${progress}%` }} /></div>
                <p>Próxima vivienda: <strong>{current ? addressOf(current) : "Recorrido finalizado"}</strong></p>
                <div className="gv-report-actions"><button onClick={exportCsv}>Descargar CSV</button><button onClick={() => window.print()}>Imprimir / guardar PDF</button><button onClick={reset}>Reiniciar jornada</button></div>
              </div>
            </section>
          )
        )}

        {view === "history" && (
          <section className="gv-panel">
            <div className="gv-section-heading"><div><span>Historial</span><h1>Últimas jornadas</h1></div><strong>{history.length}</strong></div>
            <div className="gv-history-list">
              {history.length ? history.map((entry) => (
                <article key={entry.id}>
                  <div><strong>{new Date(entry.finishedAt).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}</strong><span>{new Date(entry.startedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} – {new Date(entry.finishedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</span></div>
                  <div><span>Realizadas</span><strong>{entry.done}</strong></div>
                  <div><span>Ausentes</span><strong>{entry.absent}</strong></div>
                  <div><span>GPS</span><strong>{entry.actualKm.toFixed(2)} km</strong></div>
                </article>
              )) : <div className="gv-empty">El historial aparecerá al finalizar la primera jornada.</div>}
            </div>
          </section>
        )}
      </div>

      <nav className="gv-bottom-nav" aria-label="Navegación principal">
        {role !== "manager" && <button className={view === "route" ? "active" : ""} onClick={() => setView("route")}><span>🗺️</span>Recorrido</button>}
        {role !== "manager" && <button className={view === "stops" ? "active" : ""} onClick={() => setView("stops")}><span>🏠</span>Viviendas</button>}
        <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><span>📊</span>Dashboard</button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><span>🕘</span>Historial</button>
      </nav>

      {selectedStop && selectedRecord && selectedStopId && (
        <div className="gv-modal-backdrop" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.currentTarget === event.target) setSelectedStopId(null); }}>
          <section className="gv-stop-modal" role="dialog" aria-modal="true" aria-labelledby="gv-stop-title">
            <div className="gv-modal-head"><div><span>Vivienda {orderedStops.findIndex((stop) => stop.id === selectedStop.id) + 1}</span><h2 id="gv-stop-title">{addressOf(selectedStop)}</h2><p>{selectedStop.name}</p></div><button onClick={() => setSelectedStopId(null)}>×</button></div>
            <div className="gv-modal-fields">
              <label>Tipo de residuo<select value={selectedRecord.material} onChange={(event: ChangeEvent<HTMLSelectElement>) => updateRecord(selectedStop.id, { material: event.target.value })}>{MATERIALS.map((material) => <option key={material}>{material}</option>)}</select></label>
              <label>Kilos retirados<input inputMode="decimal" value={selectedRecord.kilos} onChange={(event: ChangeEvent<HTMLInputElement>) => updateRecord(selectedStop.id, { kilos: event.target.value })} placeholder="Ej. 8,5" /></label>
              <label className="wide">Observaciones<textarea value={selectedRecord.note} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateRecord(selectedStop.id, { note: event.target.value })} placeholder="Bolsa afuera, llamar, portón cerrado…" rows={3} /></label>
            </div>
            <div className="gv-photo-section">
              <div><strong>Fotografías</strong><span>Máximo 3 por vivienda · se comprimen automáticamente</span></div>
              <label className="gv-photo-button">{photoBusy ? "Procesando…" : "📸 Tomar o agregar foto"}<input type="file" accept="image/*" capture="environment" onChange={addPhoto} disabled={photoBusy} /></label>
              <div className="gv-photo-grid">{selectedRecord.photos.map((photo) => <figure key={photo.id}><img src={photo.dataUrl} alt="Evidencia de retiro" /><button onClick={() => removePhoto(photo.id)}>Eliminar</button></figure>)}</div>
            </div>
            <div className="gv-modal-actions">
              <button className="done" onClick={() => setStatus(selectedStop, "done")}>✓ Realizada</button>
              <button className="absent" onClick={() => setStatus(selectedStop, "absent")}>Ausente</button>
              {selectedRecord.status !== "pending" && <button onClick={() => setStatus(selectedStop, "pending")}>Volver a pendiente</button>}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

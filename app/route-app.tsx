"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ROUTE_DISTANCE_KM, STOPS, type Stop } from "./route-data";
import { getRoadRouteDetails, type RouteDetails } from "./road-route";
import OfflineSupport from "./offline-support";
import AppInstall from "./app-install";
import { EMPTY_GPS_METRICS, type GpsMetrics, type TrackingActivity } from "./tracking-types";
import {
  currentJourneyId,
  flushJourneyOutbox,
  loadJourneySnapshot,
  queueJourneySnapshot,
  saveJourneyEmergency,
  saveJourneySnapshot,
  type ActivityEntry,
  type JourneySnapshot,
  type StopDetail,
  type StopStatus,
  type StoredPosition,
} from "./journey-storage";

const LiveMap = dynamic(() => import("./live-map"), {
  ssr: false,
  loading: () => <div className="map-shell map-loading"><Image src="/icon-192.png" width={58} height={58} alt="" unoptimized /><span>Cargando calles y paradas…</span></div>,
});
const ManagerPanel = dynamic(() => import("./manager-panel"), {
  ssr: false,
  loading: () => <div className="manager-view">Cargando panel de jefatura…</div>,
});
const RouteSimulation = dynamic(() => import("./route-simulation"), {
  ssr: false,
  loading: () => <div className="simulation-loading">Preparando simulación segura…</div>,
});

const JOURNEY_ID = currentJourneyId();

type SaveState = "loading" | "saved" | "queued" | "syncing" | "synced" | "error";
type OptimizerResponse = { code: string; waypoints: Array<{ waypoint_index: number }> };
type NewStopForm = { name: string; address: string; lat: string; lng: string; note: string; day: string };

const EMPTY_NEW_STOP: NewStopForm = { name: "", address: "", lat: "", lng: "", note: "", day: "Viernes" };
const DEFAULT_ROUTE: RouteDetails = {
  points: STOPS.map((stop) => [stop.lat, stop.lng] as [number, number]),
  distanceKm: ROUTE_DISTANCE_KM,
  durationMinutes: (ROUTE_DISTANCE_KM / 22) * 60,
  source: "fallback",
};

function mapsUrl(stop: Stop, vehicle: string) {
  const mode = vehicle === "Bicicleta" ? "bicycling" : "driving";
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=${mode}`;
}

function segmentUrl(stops: Stop[], vehicle: string) {
  const mode = vehicle === "Bicicleta" ? "bicycling" : "driving";
  const origin = stops[0];
  const destination = stops.at(-1)!;
  const waypoints = stops.slice(1, -1).map((stop) => `${stop.lat},${stop.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${mode}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
}

function distance(a: Pick<Stop, "lat" | "lng">, b: Pick<Stop, "lat" | "lng">) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function numericKilos(value: string | undefined) {
  const number = Number((value ?? "").replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatVisitTime(entry?: ActivityEntry) {
  if (!entry) return "Aún sin visita";
  return new Date(entry.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function formatMinutes(value: number) {
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export default function RouteApp() {
  const [statuses, setStatuses] = useState<Record<string, StopStatus>>({});
  const [details, setDetails] = useState<Record<string, StopDetail>>({});
  const [customStops, setCustomStops] = useState<Stop[]>([]);
  const [reverse, setReverse] = useState(false);
  const [vehicle, setVehicle] = useState("Camioneta");
  const [filter, setFilter] = useState<"all" | StopStatus>("all");
  const [notice, setNotice] = useState("");
  const [detailStop, setDetailStop] = useState<string | null>(null);
  const [newStop, setNewStop] = useState<NewStopForm>(EMPTY_NEW_STOP);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"driver" | "manager">("driver");
  const [optimizedIds, setOptimizedIds] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [arrival, setArrival] = useState<{ stop: Stop; distance: number } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [presentationMode, setPresentationMode] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [lastPosition, setLastPosition] = useState<StoredPosition | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [gpsTracking, setGpsTracking] = useState(false);
  const [gpsMetrics, setGpsMetrics] = useState<GpsMetrics>(EMPTY_GPS_METRICS);
  const [gpsStartSignal, setGpsStartSignal] = useState(0);
  const [gpsResetSignal, setGpsResetSignal] = useState(0);
  const [pickLocationMode, setPickLocationMode] = useState(false);
  const [plannedRoute, setPlannedRoute] = useState<RouteDetails>(DEFAULT_ROUTE);
  const [baselineRoute, setBaselineRoute] = useState<RouteDetails>(DEFAULT_ROUTE);
  const lastAutoReorderAtRef = useRef(0);
  const autoRoutingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadJourneySnapshot(JOURNEY_ID).then((saved) => {
      if (cancelled) return;
      if (saved) {
        setStatuses(saved.statuses || {});
        setDetails(saved.details || {});
        setCustomStops(saved.customStops || []);
        setReverse(Boolean(saved.reverse));
        setOptimizedIds(saved.optimizedIds || []);
        setStartedAt(saved.startedAt || null);
        setCompletedAt(saved.completedAt || null);
        setActivity(saved.activity || []);
        setVehicle(saved.vehicle || "Camioneta");
        setLastPosition(saved.lastPosition || null);
        setGpsMetrics(saved.gpsMetrics || EMPTY_GPS_METRICS);
      }
      setHydrated(true);
      setSaveState(saved ? "saved" : "synced");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const allStops = useMemo(() => {
    const result = [...STOPS];
    for (const custom of customStops) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      result.forEach((stop, index) => {
        const currentDistance = distance(stop, custom);
        if (currentDistance < bestDistance) {
          bestDistance = currentDistance;
          bestIndex = index;
        }
      });
      result.splice(bestIndex + 1, 0, custom);
    }
    return result;
  }, [customStops]);

  const optimizedStops = useMemo(() => {
    if (!optimizedIds.length) return allStops;
    const byId = new Map(allStops.map((stop) => [stop.id, stop]));
    const sorted = optimizedIds.map((id) => byId.get(id)).filter((stop): stop is Stop => Boolean(stop));
    const used = new Set(sorted.map((stop) => stop.id));
    return [...sorted, ...allStops.filter((stop) => !used.has(stop.id))];
  }, [allStops, optimizedIds]);

  const ordered = useMemo(() => reverse ? [...optimizedStops].reverse() : optimizedStops, [reverse, optimizedStops]);

  useEffect(() => {
    const controller = new AbortController();
    void getRoadRouteDetails(STOPS, controller.signal).then((result) => {
      if (!controller.signal.aborted) setBaselineRoute(result);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getRoadRouteDetails(ordered, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPlannedRoute(result);
    }).catch(() => {});
    return () => controller.abort();
  }, [ordered]);

  const current = ordered.find((stop) => (statuses[stop.id] ?? "pending") === "pending");
  const done = Object.values(statuses).filter((status) => status === "done").length;
  const absent = Object.values(statuses).filter((status) => status === "absent").length;
  const pending = Math.max(0, allStops.length - done - absent);
  const reviewed = done + absent;
  const totalKilos = Object.values(details).reduce((total, detail) => total + numericKilos(detail.kilos), 0);
  const elapsedMinutes = startedAt && clock ? Math.max(1, (clock - startedAt) / 60_000) : 0;
  const routeBasedRemaining = plannedRoute.durationMinutes * (pending / Math.max(1, allStops.length)) + pending * 2;
  const paceBasedRemaining = reviewed >= 2 && elapsedMinutes > 0 ? (elapsedMinutes / reviewed) * pending : 0;
  const estimatedMinutes = Math.max(0, Math.round(paceBasedRemaining > 0 ? routeBasedRemaining * 0.45 + paceBasedRemaining * 0.55 : routeBasedRemaining));
  const routeSavingsKm = Math.max(0, baselineRoute.distanceKm - plannedRoute.distanceKm);
  const visible = ordered.filter((stop) => filter === "all" || (statuses[stop.id] ?? "pending") === filter);
  const segments = useMemo(() => {
    const result: Stop[][] = [];
    for (let index = 0; index < ordered.length - 1; index += 9) result.push(ordered.slice(index, index + 10));
    return result;
  }, [ordered]);
  const activityByStop = useMemo(() => new Map(activity.map((entry) => [entry.stopId, entry])), [activity]);

  const addressLabel = (stop: Stop) => stop.address ?? `Punto GPS ${stop.id}`;
  const residentLabel = (stop: Stop) => presentationMode ? "Nombre protegido" : stop.name;

  const trackingActivity = useMemo<TrackingActivity[]>(() => activity.map((entry) => {
    const stop = allStops.find((item) => item.id === entry.stopId);
    const address = stop ? addressLabel(stop) : entry.stopAddress ?? entry.stopName;
    return {
      id: entry.id,
      stopId: entry.stopId,
      label: presentationMode || !stop ? address : `${address} · ${stop.name}`,
      status: entry.status,
      at: entry.at,
      kilos: numericKilos(details[entry.stopId]?.kilos),
    };
  }), [activity, allStops, details, presentationMode]);

  useEffect(() => {
    if (!hydrated || !allStops.length) return;
    if (pending === 0 && !completedAt) setCompletedAt(Date.now());
    if (pending > 0 && completedAt) setCompletedAt(null);
  }, [pending, completedAt, hydrated, allStops.length]);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot: JourneySnapshot = {
      version: 4,
      journeyId: JOURNEY_ID,
      statuses,
      details,
      customStops,
      reverse,
      optimizedIds,
      startedAt,
      completedAt,
      activity,
      vehicle,
      lastPosition,
      gpsMetrics,
      updatedAt: Date.now(),
    };

    saveJourneyEmergency(snapshot);
    setSaveState(navigator.onLine ? "saved" : "queued");
    const timer = window.setTimeout(async () => {
      await saveJourneySnapshot(snapshot);
      await queueJourneySnapshot(snapshot);
      if (!navigator.onLine) {
        setSaveState("queued");
        return;
      }
      setSaveState("syncing");
      const synced = await flushJourneyOutbox(JOURNEY_ID);
      setSaveState(synced ? "synced" : "queued");
    }, 220);
    return () => window.clearTimeout(timer);
  }, [statuses, details, customStops, reverse, optimizedIds, startedAt, completedAt, activity, vehicle, lastPosition, gpsMetrics, hydrated]);

  useEffect(() => {
    const flush = async () => {
      if (!hydrated) return;
      setSaveState("syncing");
      const synced = await flushJourneyOutbox(JOURNEY_ID);
      setSaveState(synced ? "synced" : "queued");
    };
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [hydrated]);

  const setStatus = (id: string, status: StopStatus) => {
    setStatuses((old) => ({ ...old, [id]: status }));
    if (status === "pending") {
      setActivity((old) => old.filter((entry) => entry.stopId !== id));
      return;
    }
    const now = Date.now();
    if (!startedAt) setStartedAt(now);
    const stop = allStops.find((item) => item.id === id);
    if (!stop) return;
    setActivity((old) => [{
      id: `${id}-${now}`,
      stopId: id,
      stopName: stop.name,
      stopAddress: stop.address,
      status,
      at: now,
    }, ...old.filter((entry) => entry.stopId !== id)].slice(0, allStops.length));
  };

  const startNearMe = () => {
    if (!navigator.geolocation) return setNotice("Este dispositivo no permite obtener la ubicación.");
    setNotice("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        const me = { lat: coords.latitude, lng: coords.longitude };
        setLastPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp });
        const useReverse = distance(me, STOPS.at(-1)!) < distance(me, STOPS[0]);
        setReverse(useReverse);
        setNotice(useReverse ? `Conviene comenzar por ${addressLabel(STOPS.at(-1)!)}.` : `Conviene comenzar por ${addressLabel(STOPS[0])}.`);
      },
      () => setNotice("No pude obtener tu ubicación. Puedes invertir el sentido manualmente."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const startRoute = () => {
    if (!startedAt) setStartedAt(Date.now());
    setView("driver");
    setGpsStartSignal((value) => value + 1);
    setNotice("Jornada iniciada. Solicitando GPS y centrando el mapa en el camión…");
  };

  const reset = () => {
    if (confirm("¿Borrar todo el avance y los datos del recorrido de hoy?")) {
      setStatuses({});
      setDetails({});
      setStartedAt(null);
      setCompletedAt(null);
      setActivity([]);
      setLastPosition(null);
      setGpsMetrics(EMPTY_GPS_METRICS);
      setGpsResetSignal((value) => value + 1);
      setNotice("Jornada reiniciada. La ruta optimizada se mantiene disponible.");
    }
  };

  const updateDetail = (id: string, field: keyof StopDetail, value: string) => {
    setDetails((old) => {
      const existing = old[id] ?? { kilos: "", material: "Mixto", note: "" };
      return { ...old, [id]: { ...existing, [field]: value } };
    });
  };

  const useCurrentLocationForNewStop = () => {
    if (!navigator.geolocation) return setNotice("Este dispositivo no permite obtener la ubicación.");
    setNotice("Obteniendo ubicación para la casa nueva…");
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        setLastPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp });
        setNewStop((old) => ({ ...old, lat: coords.latitude.toFixed(7), lng: coords.longitude.toFixed(7) }));
        setNotice("Ubicación actual cargada. Revisa la dirección antes de agregar.");
      },
      () => setNotice("No pude obtener la ubicación actual."),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const handleLocationPicked = useCallback((lat: number, lng: number) => {
    setNewStop((old) => ({ ...old, lat: lat.toFixed(7), lng: lng.toFixed(7) }));
    setPickLocationMode(false);
    setNotice("Punto seleccionado en el mapa. Completa nombre y dirección.");
  }, []);

  const addStop = () => {
    const lat = Number(newStop.lat.replace(",", "."));
    const lng = Number(newStop.lng.replace(",", "."));
    if (!newStop.name.trim() || !newStop.address.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setNotice("Escribe nombre, calle y número, y selecciona una ubicación válida.");
      return;
    }
    const target = { lat, lng };
    const nearest = STOPS.reduce((best, stop) => distance(stop, target) < distance(best, target) ? stop : best);
    const stop: Stop = {
      id: `N${Date.now()}`,
      name: newStop.name.trim(),
      address: newStop.address.trim(),
      note: newStop.note.trim() || undefined,
      day: newStop.day,
      lat,
      lng,
      km: nearest.km,
    };
    setCustomStops((old) => [...old, stop]);
    if (newStop.note.trim()) setDetails((old) => ({ ...old, [stop.id]: { kilos: "", material: "Mixto", note: newStop.note.trim() } }));
    setOptimizedIds([]);
    setNewStop(EMPTY_NEW_STOP);
    setPickLocationMode(false);
    setNotice(`${stop.address} agregada al recorrido de ${stop.day}.`);
  };

  const optimizeRoute = useCallback(async (origin?: { lat: number; lng: number }, automatic = false) => {
    if (!navigator.onLine) {
      setNotice("Sin internet: usaré el último orden y el trazado local guardado.");
      return;
    }
    if (autoRoutingRef.current) return;
    const pendingStops = ordered.filter((stop) => (statuses[stop.id] ?? "pending") === "pending");
    if (pendingStops.length < 2) return;

    autoRoutingRef.current = true;
    setOptimizing(true);
    setNotice(automatic ? "Detecté un cambio de recorrido. Reordenando las paradas pendientes…" : "Calculando un orden sugerido por calles y sentidos de tránsito…");
    try {
      const inputs = origin ? [{ id: "current-position", name: "Ubicación actual", lat: origin.lat, lng: origin.lng, km: 0 }, ...pendingStops] : pendingStops;
      const coordinates = inputs.map((stop) => `${stop.lng},${stop.lat}`).join(";");
      const destination = origin ? "any" : "last";
      const response = await fetch(`https://router.project-osrm.org/trip/v1/driving/${coordinates}?roundtrip=false&source=first&destination=${destination}&overview=false&steps=false`);
      if (!response.ok) throw new Error("optimizer unavailable");
      const data = await response.json() as OptimizerResponse;
      if (data.code !== "Ok" || data.waypoints.length !== inputs.length) throw new Error("invalid route");
      const sortedPending = pendingStops
        .map((stop, index) => ({ stop, order: data.waypoints[index + (origin ? 1 : 0)].waypoint_index }))
        .sort((a, b) => a.order - b.order)
        .map((item) => item.stop.id);
      const completedIds = ordered.filter((stop) => (statuses[stop.id] ?? "pending") !== "pending").map((stop) => stop.id);
      setOptimizedIds([...completedIds, ...sortedPending]);
      setReverse(false);
      setNotice(automatic ? "Ruta reajustada desde la ubicación actual. Las casas ya realizadas no cambiaron." : "Orden sugerido actualizado. Distancia y tiempo se recalcularán con la ruta real.");
    } catch {
      setNotice("No pude contactar el optimizador. La ruta anterior sigue disponible y no se perdió nada.");
    } finally {
      autoRoutingRef.current = false;
      setOptimizing(false);
    }
  }, [ordered, statuses]);

  useEffect(() => {
    if (!hydrated || !gpsTracking || !startedAt || pending < 2) return;
    const checkDeviation = () => {
      if (!navigator.onLine || autoRoutingRef.current || Date.now() - lastAutoReorderAtRef.current < 120_000) return;
      navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => {
        const position = { lat: coords.latitude, lng: coords.longitude };
        setLastPosition({ ...position, accuracy: coords.accuracy, at: timestamp });
        const pendingStops = ordered.filter((stop) => (statuses[stop.id] ?? "pending") === "pending");
        const active = pendingStops[0];
        if (!active) return;
        const nearest = pendingStops.reduce((best, stop) => distance(position, stop) < distance(position, best) ? stop : best);
        const currentDistance = distance(position, active);
        const nearestDistance = distance(position, nearest);
        if (nearest.id !== active.id && currentDistance > 0.25 && nearestDistance + 0.08 < currentDistance) {
          lastAutoReorderAtRef.current = Date.now();
          void optimizeRoute(position, true);
        }
      }, () => {}, { enableHighAccuracy: true, maximumAge: 15_000, timeout: 12_000 });
    };
    const timer = window.setInterval(checkDeviation, 30_000);
    checkDeviation();
    return () => window.clearInterval(timer);
  }, [hydrated, gpsTracking, startedAt, pending, ordered, statuses, optimizeRoute]);

  const exportCsv = () => {
    const rows = [["Orden", "Casa", "Dirección", "Día", "Estado", "Hora visita", "Kilos", "Tipo de residuo", "Observaciones"]];
    ordered.forEach((stop, index) => {
      const detail = details[stop.id] || { kilos: "", material: "", note: stop.note ?? "" };
      const visit = activityByStop.get(stop.id);
      rows.push([String(index + 1), stop.name, stop.address ?? "Punto GPS registrado", stop.day ?? "Viernes", statuses[stop.id] || "pending", visit ? new Date(visit.at).toLocaleString("es-CL") : "", detail.kilos, detail.material, detail.note]);
    });
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "informe-santuario-viernes.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const currentDetail = current ? details[current.id] || { kilos: "", material: "Mixto", note: current.note ?? "" } : null;
  const saveLabel = saveState === "loading" ? "Cargando jornada…" : saveState === "syncing" ? "Sincronizando…" : saveState === "queued" ? "Guardado en el teléfono · pendiente de sincronizar" : saveState === "error" ? "Guardado local · revisa la conexión" : saveState === "synced" ? "Jornada guardada y sincronizada" : "Jornada guardada automáticamente";
  const routeSourceLabel = plannedRoute.source === "network" ? "calculada por calles reales" : plannedRoute.source === "cache" ? "última ruta guardada" : "trazado local de respaldo";

  return (
    <main>
      <OfflineSupport />
      <header className="topbar">
        <Image className="brand-mark" src="/icon-192.png" width={45} height={45} alt="Logo Ruta Verde" priority unoptimized />
        <div className="brand-copy"><span>Reciclaje en movimiento</span><strong>Ruta Verde · Santuario</strong></div>
        <div className="header-actions"><div style={{ textAlign: "right", fontSize: 10, fontWeight: 800, color: saveState === "queued" ? "#ffd08a" : "#dcec75" }}>{saveLabel}</div><AppInstall /><div className="header-date"><span>Viernes · recorrido activo</span><strong>{allStops.length} casas</strong></div></div>
      </header>

      <nav className="app-tabs" aria-label="Cambiar vista de la aplicación">
        <button className={view === "driver" ? "active" : ""} onClick={() => setView("driver")}>Conductor</button>
        <button className={view === "manager" ? "active" : ""} onClick={() => setView("manager")}>Jefatura · seguimiento</button>
      </nav>

      {view === "manager" ? <ManagerPanel localSummary={{ total: allStops.length, done, absent, pending, nextStop: current ? addressLabel(current) : null, startedAt, kilos: totalKilos, estimatedMinutes, routeKm: plannedRoute.distanceKm, baselineRouteKm: baselineRoute.distanceKm, routeSavingsKm, plannedDriveMinutes: plannedRoute.durationMinutes, gpsMetrics, activity: trackingActivity, presentationMode }} /> : <>
      <section className="presentation-bar" aria-label="Ayuda para la demostración"><div><strong>Demostración sugerida</strong><span>Comenzar recorrido → registra 2 retiros y 1 ausencia → abre Jefatura</span></div><div className="presentation-actions"><button className="simulation-launch" onClick={() => setSimulationOpen(true)}>▶ Probar simulación</button><button className={presentationMode ? "active" : ""} onClick={() => setPresentationMode((value) => !value)}>{presentationMode ? "Mostrar nombres" : "Ocultar nombres"}</button></div></section>

      <section className="hero"><div><p className="eyebrow"><span /> Jornada Santuario · Viernes</p><h1>{allStops.length} viviendas.<br />Un recorrido claro.</h1><p className="lead">Ruta Verde ordena las paradas, activa el GPS, guía al conductor y convierte cada retiro en avance visible para jefatura.</p><div className="hero-actions"><a href="#recorrido" onClick={startRoute}>Comenzar recorrido y GPS</a><button onClick={() => setView("manager")}>Ver panel de jefatura</button></div></div><div className="progress-card"><div className="progress-head"><span>Avance de hoy</span><strong>{Math.round((reviewed / Math.max(1, allStops.length)) * 100)}%</strong></div><div className="progress-track"><i style={{ width: `${(reviewed / Math.max(1, allStops.length)) * 100}%` }} /></div><div className="progress-numbers"><strong>{done}</strong> realizadas <span>·</span> <strong>{pending}</strong> pendientes <span>·</span> <strong>{absent}</strong> ausentes</div></div></section>

      <section className="workflow-strip" aria-label="Flujo de trabajo"><div><b>1</b><span><strong>Iniciar</strong>Activa jornada y GPS</span></div><div><b>2</b><span><strong>Navegar</strong>Sigue la próxima dirección</span></div><div><b>3</b><span><strong>Registrar</strong>Realizado o ausente</span></div><div><b>4</b><span><strong>Supervisar</strong>Jefatura recibe todo</span></div></section>

      <section className="workspace" id="recorrido"><div className="map-column"><LiveMap stops={ordered} statuses={statuses} activeId={current?.id} activeStop={current} completed={reviewed} done={done} absent={absent} pending={pending} total={allStops.length} kilos={totalKilos} routeKm={plannedRoute.distanceKm} baselineRouteKm={baselineRoute.distanceKm} routeSavingsKm={routeSavingsKm} plannedDriveMinutes={plannedRoute.durationMinutes} estimatedMinutes={estimatedMinutes} startedAt={startedAt} privacyMode={presentationMode} activity={trackingActivity} initialMetrics={gpsMetrics} startSignal={gpsStartSignal} resetSignal={gpsResetSignal} pickLocationMode={pickLocationMode} onTrackingChange={(active: boolean) => { setGpsTracking(active); if (active && !startedAt) setStartedAt(Date.now()); }} onArrival={(stop: Stop, distanceMeters: number) => setArrival({ stop, distance: distanceMeters })} onGpsMetrics={setGpsMetrics} onLocationPicked={handleLocationPicked} />
        <div className="stats-row"><article><span>Ruta planificada</span><strong>{plannedRoute.distanceKm.toFixed(1).replace(".", ",")} km</strong><small>{routeSourceLabel}</small></article><article><span>Recorrido por GPS</span><strong>{gpsMetrics.actualKm.toFixed(2).replace(".", ",")} km</strong><small>distancia efectivamente recorrida</small></article><article><span>Tiempo transcurrido</span><strong>{startedAt ? formatMinutes(elapsedMinutes) : "Sin iniciar"}</strong><small>{completedAt ? `terminado ${new Date(completedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}` : "se inicia con el GPS"}</small></article><article><span>En movimiento</span><strong>{formatMinutes(gpsMetrics.movingMinutes)}</strong><small>camión avanzando</small></article><article><span>Detenido</span><strong>{formatMinutes(gpsMetrics.stoppedMinutes)}</strong><small>retiros y esperas</small></article><article><span>Tiempo restante</span><strong>~{formatMinutes(estimatedMinutes)}</strong><small>recalculado con el avance real</small></article><article><span>Diferencia vs. ruta base</span><strong>{routeSavingsKm > 0.01 ? `-${routeSavingsKm.toFixed(2).replace(".", ",")} km` : "Sin diferencia"}</strong><small>comparación con el orden original</small></article></div>
      </div>
      <aside className="next-card"><div className="next-label"><span className="live-dot" /> Siguiente retiro</div>{current ? <><div className="next-number">{ordered.findIndex((stop) => stop.id === current.id) + 1}</div><h2>{addressLabel(current)}</h2><p>{residentLabel(current)} · parada {ordered.findIndex((stop) => stop.id === current.id) + 1} de {ordered.length}</p><div style={{ display: "grid", gap: 7, margin: "14px 0", padding: 12, borderRadius: 13, background: "#eef2eb", fontSize: 11 }}><span><strong>Estado:</strong> Pendiente</span><span><strong>Tipo de residuo:</strong> {currentDetail?.material || "Mixto"}</span><span><strong>Observaciones:</strong> {currentDetail?.note || "Sin observaciones"}</span><span><strong>Última ubicación:</strong> {lastPosition ? `${new Date(lastPosition.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} · precisión ${lastPosition.accuracy === null ? "GPS" : `${Math.round(lastPosition.accuracy)} m`}` : "El GPS la registrará al iniciar"}</span></div><a className="primary-action" href={mapsUrl(current, vehicle)} target="_blank" rel="noreferrer">Abrir navegación</a><button className="complete-action" onClick={() => setStatus(current.id, "done")}>✓ Retiro realizado · siguiente</button><button className="absent-action" onClick={() => setStatus(current.id, "absent")}>No estaba · marcar ausente</button></> : <div className="finished"><strong>Recorrido terminado</strong><p>Las {allStops.length} casas ya fueron revisadas.</p></div>}<div className="quick-settings"><label>Vehículo<select value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option>Camioneta</option><option>Camión</option><option>Auto</option><option>Bicicleta</option></select></label><button className="optimize-button" onClick={() => void optimizeRoute()} disabled={optimizing}>{optimizing ? "Optimizando…" : optimizedIds.length ? "Optimizar nuevamente" : "Optimizar ruta por calles"}</button><button onClick={startNearMe}>Comenzar por el extremo más cercano</button><button onClick={() => setReverse((value) => !value)}>Invertir sentido</button></div><div className="segment-box"><strong>Navegar el recorrido por tramos</strong><p>Google Maps limita las paradas; por eso van separadas automáticamente.</p><div>{segments.map((segment, index) => <a key={segment[0].id} href={segmentUrl(segment, vehicle)} target="_blank" rel="noreferrer">Tramo {index + 1}</a>)}</div></div>{notice && <div className="notice" role="status">{notice}</div>}</aside></section>

      <section className="route-list-section"><div className="section-heading"><div><p className="eyebrow"><span /> Control de retiros</p><h2>Orden completo de paradas</h2></div><div className="filters" aria-label="Filtrar paradas">{(["all", "pending", "done", "absent"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? "Todas" : item === "pending" ? "Pendientes" : item === "done" ? "Realizadas" : "Ausentes"}</button>)}</div></div>
      <div className="stop-list">{visible.map((stop, index) => { const status = statuses[stop.id] ?? "pending"; const detail = details[stop.id] || { kilos: "", material: "Mixto", note: stop.note ?? "" }; const visit = activityByStop.get(stop.id); return <article className={`stop-row ${status} ${current?.id === stop.id ? "current" : ""}`} key={stop.id}><div className="stop-order">{String(index + 1).padStart(2, "0")}</div><div className="stop-main"><strong>{addressLabel(stop)}</strong><span>{residentLabel(stop)} · {stop.day ?? "Viernes"} · {detail.material || "Mixto"} · {formatVisitTime(visit)}</span>{detail.note && <span>Obs.: {detail.note}</span>}</div><div className={`status-pill ${status}`}>{status === "done" ? "Realizado" : status === "absent" ? "Ausente" : current?.id === stop.id ? "Siguiente" : "Pendiente"}</div><a className="row-nav" href={mapsUrl(stop, vehicle)} target="_blank" rel="noreferrer">Navegar</a><div className="row-actions"><button className="data-button" aria-label={`Datos de ${addressLabel(stop)}`} onClick={() => setDetailStop(detailStop === stop.id ? null : stop.id)}>i</button>{status === "pending" ? <><button aria-label={`Marcar ${addressLabel(stop)} como realizado`} onClick={() => setStatus(stop.id, "done")}>✓</button><button aria-label={`Marcar ${addressLabel(stop)} como ausente`} onClick={() => setStatus(stop.id, "absent")}>×</button></> : <button className="undo" onClick={() => setStatus(stop.id, "pending")}>Deshacer</button>}</div>{detailStop === stop.id && <div className="stop-detail"><label>Kilos retirados<input inputMode="decimal" value={detail.kilos} onChange={(event) => updateDetail(stop.id, "kilos", event.target.value)} placeholder="Ej. 8,5" /></label><label>Tipo de residuo<select value={detail.material} onChange={(event) => updateDetail(stop.id, "material", event.target.value)}><option>Mixto</option><option>Vidrio</option><option>Plástico</option><option>Cartón</option><option>Latas</option><option>Orgánico</option><option>Otro</option></select></label><label className="note-field">Observaciones<input value={detail.note} onChange={(event) => updateDetail(stop.id, "note", event.target.value)} placeholder="Bolsa afuera, llamar, acceso cerrado…" /></label></div>}</article>; })}</div>
      <div className="tools-panel"><details className="add-stop"><summary>Agregar una casa nueva</summary><div className="add-stop-form"><label>Nombre<input value={newStop.name} onChange={(event) => setNewStop((old) => ({ ...old, name: event.target.value }))} placeholder="Nombre del retiro" /></label><label>Calle y número<input value={newStop.address} onChange={(event) => setNewStop((old) => ({ ...old, address: event.target.value }))} placeholder="Ej. Los Pimientos 4810" /></label><label>Día<select value={newStop.day} onChange={(event) => setNewStop((old) => ({ ...old, day: event.target.value }))}><option>Lunes</option><option>Martes</option><option>Miércoles</option><option>Jueves</option><option>Viernes</option><option>Sábado</option></select></label><label>Nota especial<input value={newStop.note} onChange={(event) => setNewStop((old) => ({ ...old, note: event.target.value }))} placeholder="Llamar, portón, bolsa afuera…" /></label><label>Latitud<input inputMode="decimal" value={newStop.lat} onChange={(event) => setNewStop((old) => ({ ...old, lat: event.target.value }))} placeholder="-41.4600" /></label><label>Longitud<input inputMode="decimal" value={newStop.lng} onChange={(event) => setNewStop((old) => ({ ...old, lng: event.target.value }))} placeholder="-72.9000" /></label><button type="button" onClick={useCurrentLocationForNewStop}>Usar ubicación actual</button><button type="button" onClick={() => setPickLocationMode((value) => !value)}>{pickLocationMode ? "Cancelar selección" : "Seleccionar punto en el mapa"}</button><button type="button" onClick={addStop}>Agregar al recorrido</button></div></details><button className="export-button" onClick={exportCsv}>Descargar informe CSV</button></div><div className="list-footer"><span>Estados, horas, ubicación, métricas, kilos y observaciones se guardan automáticamente y se sincronizan al volver internet.</span><button onClick={reset}>Reiniciar jornada</button></div></section>
      </>}

      {arrival && <div className="arrival-backdrop" role="dialog" aria-modal="true" aria-labelledby="arrival-title"><div className="arrival-card"><span className="arrival-icon">✓</span><p>Llegada automática</p><h2 id="arrival-title">Llegaste a {addressLabel(arrival.stop)}</h2><span>Estás aproximadamente a {Math.round(arrival.distance)} metros del punto.</span><button onClick={() => { setStatus(arrival.stop.id, "done"); setArrival(null); }}>Registrar retiro y continuar</button><button className="arrival-secondary" onClick={() => setArrival(null)}>Todavía no · cerrar aviso</button></div></div>}
      {simulationOpen && <RouteSimulation onClose={() => setSimulationOpen(false)} />}
    </main>
  );
}

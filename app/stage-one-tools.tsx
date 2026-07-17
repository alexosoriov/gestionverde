"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { readSecureStored } from "./journey-db";
import { currentJourneyId, type JourneySnapshot } from "./journey-storage";
import {
  clearStopReviewFlag,
  flagStopForReview,
  loadRouteCorrectionStore,
  restoreOriginalStop,
  saveStopCorrection,
  type RouteCorrectionStore,
} from "./route-corrections";
import {
  fallbackNavigationRoute,
  formatNavigationDistance,
  formatNavigationDuration,
  getNavigationRoute,
  straightLineMeters,
  type NavigationPoint,
  type NavigationRoute,
} from "./navigation-service";
import { STOPS, type Stop } from "./route-data";

const JOURNEY_ID = currentJourneyId();

type Props = {
  onRouteChanged: () => void;
};

type DraftCorrection = {
  lat: string;
  lng: string;
  address: string;
  note: string;
  reason: string;
};

type CurrentPosition = NavigationPoint & {
  accuracy: number;
  at: number;
};

function addressLabel(stop: Stop) {
  return stop.address ?? `Punto GPS ${stop.id}`;
}

function distanceBetweenStops(a: Pick<Stop, "lat" | "lng">, b: Pick<Stop, "lat" | "lng">) {
  return straightLineMeters(a, b);
}

function insertCustomStops(base: Stop[], customStops: Stop[]) {
  const result = [...base];
  for (const custom of customStops) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    result.forEach((stop, index) => {
      const distance = distanceBetweenStops(stop, custom);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    result.splice(bestIndex + 1, 0, custom);
  }
  return result;
}

function orderedStopsFromSnapshot(snapshot: JourneySnapshot | null) {
  const base = insertCustomStops([...STOPS], snapshot?.customStops ?? []);
  let ordered = base;
  if (snapshot?.optimizedIds?.length) {
    const byId = new Map(base.map((stop) => [stop.id, stop]));
    const optimized = snapshot.optimizedIds.map((id) => byId.get(id)).filter((stop): stop is Stop => Boolean(stop));
    const used = new Set(optimized.map((stop) => stop.id));
    ordered = [...optimized, ...base.filter((stop) => !used.has(stop.id))];
  }
  return snapshot?.reverse ? [...ordered].reverse() : ordered;
}

function navigationVoiceText(route: NavigationRoute, target: Stop, phase: "prepare" | "now" | "arrival") {
  if (phase === "arrival") return `Llegaste a ${addressLabel(target)}.`;
  const street = route.instruction.street ? ` hacia ${route.instruction.street}` : "";
  if (phase === "now") return `${route.instruction.primary}${street}.`;
  return `En ${formatNavigationDistance(route.instruction.distanceMeters)}, ${route.instruction.primary.toLocaleLowerCase("es-CL")}${street}.`;
}

function TurnByTurnNavigation({ revision }: { revision: number }) {
  const [snapshot, setSnapshot] = useState<JourneySnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [position, setPosition] = useState<CurrentPosition | null>(null);
  const [route, setRoute] = useState<NavigationRoute | null>(null);
  const [message, setMessage] = useState("La guía se activará al comenzar el recorrido.");
  const [online, setOnline] = useState(true);
  const manuallyDisabledRef = useRef(false);
  const lastRequestRef = useRef<{ point: NavigationPoint; at: number; targetId: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const spokenRef = useRef(new Set<string>());
  const routeRef = useRef<NavigationRoute | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    try {
      const savedSpeech = localStorage.getItem("ruta-verde-navigation-speech");
      if (savedSpeech !== null) setSpeechEnabled(savedSpeech === "true");
    } catch {}
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const value = await readSecureStored<JourneySnapshot>("journeys", JOURNEY_ID);
        if (!active) return;
        setSnapshot(value);
        if (value?.startedAt && !manuallyDisabledRef.current) setEnabled(true);
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [revision]);

  const ordered = useMemo(() => orderedStopsFromSnapshot(snapshot), [snapshot, revision]);
  const target = useMemo(
    () => ordered.find((stop) => (snapshot?.statuses?.[stop.id] ?? "pending") === "pending"),
    [ordered, snapshot],
  );

  useEffect(() => {
    spokenRef.current.clear();
    lastRequestRef.current = null;
    setRoute(null);
    routeRef.current = null;
  }, [target?.id, revision]);

  useEffect(() => {
    if (!enabled || !target) return;
    if (!navigator.geolocation) {
      setMessage("Este dispositivo no permite obtener ubicación GPS.");
      return;
    }

    setMessage("Buscando señal GPS para iniciar la guía…");
    const watch = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        setPosition({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          at: timestamp,
        });
      },
      (error) => {
        setMessage(error.code === error.PERMISSION_DENIED
          ? "Activa el permiso de ubicación para usar la navegación."
          : "GPS temporalmente no disponible. Mantendré la última instrucción.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2_500,
        timeout: 15_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [enabled, target?.id]);

  const requestNavigation = useCallback(async (origin: CurrentPosition, force = false) => {
    if (!target) return;
    const now = Date.now();
    const previous = lastRequestRef.current;
    const currentRoute = routeRef.current;
    const refreshAfter = currentRoute && currentRoute.instruction.distanceMeters <= 120 ? 4_500 : 11_000;
    const moved = previous ? straightLineMeters(previous.point, origin) : Number.POSITIVE_INFINITY;
    if (!force && previous && previous.targetId === target.id && now - previous.at < refreshAfter && moved < 16) return;

    lastRequestRef.current = { point: origin, at: now, targetId: target.id };
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const fallback = fallbackNavigationRoute(origin, target, addressLabel(target));

    if (!navigator.onLine) {
      setRoute(fallback);
      routeRef.current = fallback;
      setMessage("Sin internet: mostrando distancia directa hasta la vivienda.");
      return;
    }

    try {
      const nextRoute = await getNavigationRoute(origin, target, addressLabel(target), controller.signal);
      setRoute(nextRoute);
      routeRef.current = nextRoute;
      setMessage(`GPS ±${Math.round(origin.accuracy)} m · ruta actualizada`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRoute(fallback);
      routeRef.current = fallback;
      setMessage(error instanceof Error ? `${error.message}. Usando orientación directa.` : "Usando orientación directa.");
    }
  }, [target]);

  useEffect(() => {
    if (!enabled || !position || !target) return;
    void requestNavigation(position);
  }, [enabled, position, target, requestNavigation]);

  const speak = useCallback((text: string) => {
    if (!speechEnabled || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-CL";
    utterance.rate = 0.94;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [speechEnabled]);

  useEffect(() => {
    if (!enabled || !speechEnabled || !route || !target) return;
    const instructionDistance = route.instruction.distanceMeters;
    let phase: "prepare" | "now" | "arrival" | null = null;
    if (route.instruction.kind === "arrive" || route.distanceMeters <= 35) phase = "arrival";
    else if (instructionDistance <= 48) phase = "now";
    else if (instructionDistance <= 180) phase = "prepare";
    if (!phase) return;

    const key = `${target.id}|${route.instruction.key}|${phase}`;
    if (spokenRef.current.has(key)) return;
    spokenRef.current.add(key);
    speak(navigationVoiceText(route, target, phase));
  }, [enabled, speechEnabled, route, target, speak]);

  useEffect(() => () => {
    requestRef.current?.abort();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const toggleSpeech = () => {
    const next = !speechEnabled;
    setSpeechEnabled(next);
    try { localStorage.setItem("ruta-verde-navigation-speech", String(next)); } catch {}
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const enableNavigation = () => {
    manuallyDisabledRef.current = false;
    setEnabled(true);
    setMessage("Activando guía de navegación…");
  };

  const disableNavigation = () => {
    manuallyDisabledRef.current = true;
    setEnabled(false);
    setPosition(null);
    setRoute(null);
    routeRef.current = null;
    requestRef.current?.abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setMessage("Guía detenida. El GPS principal del mapa puede continuar activo.");
  };

  if (!target) {
    return (
      <section className="rv1-navigation rv1-navigation-finished" aria-live="polite">
        <span className="rv1-nav-icon">✓</span>
        <div><strong>Recorrido completado</strong><small>No quedan viviendas pendientes.</small></div>
      </section>
    );
  }

  if (!enabled) {
    return (
      <section className="rv1-navigation rv1-navigation-idle" aria-live="polite">
        <span className="rv1-nav-icon">🧭</span>
        <div className="rv1-nav-copy"><strong>Guía giro a giro lista</strong><small>Siguiente: {addressLabel(target)}</small></div>
        <button type="button" onClick={enableNavigation}>Activar guía</button>
      </section>
    );
  }

  const displayedRoute = route ?? (position ? fallbackNavigationRoute(position, target, addressLabel(target)) : null);
  return (
    <section className="rv1-navigation" aria-live="polite">
      <span className="rv1-nav-icon">{displayedRoute?.instruction.icon ?? "…"}</span>
      <div className="rv1-nav-main">
        <div className="rv1-nav-distance">{displayedRoute ? formatNavigationDistance(displayedRoute.instruction.distanceMeters) : "Buscando GPS"}</div>
        <strong>{displayedRoute?.instruction.primary ?? "Calculando próxima maniobra"}</strong>
        <span>{displayedRoute?.instruction.street || addressLabel(target)}</span>
        <small>{displayedRoute ? `${formatNavigationDistance(displayedRoute.distanceMeters)} · ${formatNavigationDuration(displayedRoute.durationSeconds)} hasta ${addressLabel(target)}` : message}</small>
      </div>
      <div className="rv1-nav-actions">
        <button type="button" title={speechEnabled ? "Silenciar voz" : "Activar voz"} onClick={toggleSpeech}>{speechEnabled ? "🔊" : "🔇"}</button>
        <button type="button" title="Recalcular ahora" onClick={() => position && void requestNavigation(position, true)}>↻</button>
        <button type="button" title="Repetir instrucción" onClick={() => displayedRoute && speak(navigationVoiceText(displayedRoute, target, displayedRoute.distanceMeters <= 35 ? "arrival" : "now"))}>▶</button>
        <button type="button" title="Detener guía" onClick={disableNavigation}>×</button>
      </div>
      <div className={`rv1-nav-status ${online ? "online" : "offline"}`}>{message}</div>
    </section>
  );
}

function CorrectionPanel({
  store,
  onStoreChange,
  onRouteChanged,
}: {
  store: RouteCorrectionStore;
  onStoreChange: (store: RouteCorrectionStore) => void;
  onRouteChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(() => STOPS[0]?.id ?? "");
  const [draft, setDraft] = useState<DraftCorrection>({ lat: "", lng: "", address: "", note: "", reason: "" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const selectedMarkerRef = useRef<L.Marker | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);

  const selected = STOPS.find((stop) => stop.id === selectedId) ?? STOPS[0];
  const correction = selected ? store.corrections[selected.id] : undefined;
  const reviewFlag = selected ? store.reviewFlags[selected.id] : undefined;

  const loadSelectedIntoDraft = useCallback((stop: Stop | undefined) => {
    if (!stop) return;
    setDraft({
      lat: stop.lat.toFixed(7),
      lng: stop.lng.toFixed(7),
      address: stop.address ?? "",
      note: stop.note ?? "",
      reason: store.reviewFlags[stop.id]?.reason ?? store.corrections[stop.id]?.reason ?? "",
    });
  }, [store]);

  useEffect(() => loadSelectedIntoDraft(selected), [selected?.id, loadSelectedIntoDraft]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!open || !mapElementRef.current || mapRef.current || !selected) return;
    const map = L.map(mapElementRef.current, {
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: true,
    }).setView([selected.lat, selected.lng], 18);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap",
      errorTileUrl: "/offline-map-tile.svg",
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    stopsLayerRef.current = layer;

    const marker = L.marker([selected.lat, selected.lng], {
      draggable: true,
      icon: L.divIcon({
        className: "rv1-selected-marker-wrap",
        html: "<span class=\"rv1-selected-marker\">⌖</span>",
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      }),
    }).addTo(map);
    selectedMarkerRef.current = marker;

    const updatePoint = (point: L.LatLng) => {
      marker.setLatLng(point);
      setDraft((old) => ({ ...old, lat: point.lat.toFixed(7), lng: point.lng.toFixed(7) }));
    };
    marker.on("dragend", () => updatePoint(marker.getLatLng()));
    map.on("click", (event: L.LeafletMouseEvent) => updatePoint(event.latlng));
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      selectedMarkerRef.current = null;
      stopsLayerRef.current = null;
    };
  }, [open, selected?.id]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = selectedMarkerRef.current;
    const layer = stopsLayerRef.current;
    if (!map || !marker || !layer || !selected) return;
    layer.clearLayers();
    STOPS.forEach((stop) => {
      if (stop.id === selected.id) return;
      L.marker([stop.lat, stop.lng], {
        interactive: false,
        icon: L.divIcon({
          className: "rv1-other-marker-wrap",
          html: `<span class="rv1-other-marker${store.reviewFlags[stop.id] ? " review" : store.corrections[stop.id] ? " corrected" : ""}"></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      }).addTo(layer);
    });
    marker.setLatLng([selected.lat, selected.lng]);
    map.flyTo([selected.lat, selected.lng], Math.max(17, map.getZoom()), { duration: 0.45 });
  }, [selected?.id, store]);

  useEffect(() => {
    const lat = Number(draft.lat.replace(",", "."));
    const lng = Number(draft.lng.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    selectedMarkerRef.current?.setLatLng([lat, lng]);
  }, [draft.lat, draft.lng]);

  const refreshStore = async () => {
    const nextStore = await loadRouteCorrectionStore();
    onStoreChange(nextStore);
    return nextStore;
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("Este dispositivo no permite obtener la ubicación.");
      return;
    }
    setMessage("Buscando ubicación precisa…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = L.latLng(coords.latitude, coords.longitude);
        setDraft((old) => ({ ...old, lat: point.lat.toFixed(7), lng: point.lng.toFixed(7) }));
        selectedMarkerRef.current?.setLatLng(point);
        mapRef.current?.flyTo(point, 19);
        setMessage(`Ubicación cargada con precisión aproximada de ${Math.round(coords.accuracy)} m.`);
      },
      () => setMessage("No pude obtener la ubicación actual. Revisa el permiso GPS."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const saveCorrection = async () => {
    if (!selected) return;
    const lat = Number(draft.lat.replace(",", "."));
    const lng = Number(draft.lng.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Selecciona un punto válido en el mapa.");
      return;
    }
    setSaving(true);
    try {
      const moved = distanceBetweenStops(selected, { lat, lng });
      await saveStopCorrection({
        stopId: selected.id,
        lat,
        lng,
        address: draft.address,
        note: draft.note,
        reason: draft.reason,
      });
      await refreshStore();
      onRouteChanged();
      setMessage(`${addressLabel(selected)} guardada. El punto se movió ${Math.round(moved)} m y la ruta fue recalculada.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible guardar la corrección.");
    } finally {
      setSaving(false);
    }
  };

  const toggleReviewFlag = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      if (reviewFlag) await clearStopReviewFlag(selected.id);
      else await flagStopForReview(selected.id, draft.reason);
      await refreshStore();
      setMessage(reviewFlag ? "Marca de revisión eliminada." : "Vivienda marcada para revisar durante el próximo recorrido.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible actualizar la revisión.");
    } finally {
      setSaving(false);
    }
  };

  const restoreOriginal = async () => {
    if (!selected || !correction) return;
    if (!confirm(`¿Restaurar la ubicación original de ${addressLabel(selected)}?`)) return;
    setSaving(true);
    try {
      await restoreOriginalStop(selected.id);
      await refreshStore();
      onRouteChanged();
      loadSelectedIntoDraft(selected);
      setMessage("Ubicación original restaurada y ruta recalculada.");
    } finally {
      setSaving(false);
    }
  };

  const exportCorrections = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ruta-verde-correcciones-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const testVoice = () => {
    if (!("speechSynthesis" in window)) {
      setMessage("Este navegador no tiene voz disponible.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance("Ruta Verde. Prueba de voz correcta. En cien metros, gira a la derecha.");
    utterance.lang = "es-CL";
    utterance.rate = 0.94;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setMessage("Prueba de voz reproducida.");
  };

  const lat = Number(draft.lat.replace(",", "."));
  const lng = Number(draft.lng.replace(",", "."));
  const movedMeters = selected && Number.isFinite(lat) && Number.isFinite(lng)
    ? distanceBetweenStops(selected, { lat, lng })
    : 0;
  const correctedCount = Object.keys(store.corrections).length;
  const reviewCount = Object.keys(store.reviewFlags).length;

  return (
    <>
      <button className="rv1-tools-launcher" type="button" onClick={() => setOpen(true)}>
        <span>⌖</span><strong>Precisión 1.0</strong><small>{correctedCount} corregidas · {reviewCount} por revisar</small>
      </button>

      {open && <div className="rv1-tools-backdrop" role="dialog" aria-modal="true" aria-labelledby="rv1-tools-title">
        <section className="rv1-tools-panel">
          <header>
            <div><span>Ruta Verde 1.0</span><h2 id="rv1-tools-title">Precisión de viviendas</h2><p>Toca el mapa o arrastra el punto hasta la entrada real donde se detiene el camión.</p></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar">×</button>
          </header>

          <div className="rv1-diagnostics">
            <span className={navigator.geolocation ? "ok" : "bad"}>GPS {navigator.geolocation ? "disponible" : "no disponible"}</span>
            <span className={"speechSynthesis" in window ? "ok" : "bad"}>Voz {"speechSynthesis" in window ? "disponible" : "no disponible"}</span>
            <span className={online ? "ok" : "warn"}>{online ? "En línea" : "Sin conexión"}</span>
            <span className={STOPS.length ? "ok" : "bad"}>{STOPS.length} viviendas cargadas</span>
            <button type="button" onClick={testVoice}>Probar voz</button>
          </div>

          <div className="rv1-tools-grid">
            <div className="rv1-map-side">
              <label className="rv1-field">Vivienda
                <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
                  {STOPS.map((stop, index) => <option value={stop.id} key={stop.id}>
                    {index + 1}. {addressLabel(stop)}{store.reviewFlags[stop.id] ? " · REVISAR" : store.corrections[stop.id] ? " · CORREGIDA" : ""}
                  </option>)}
                </select>
              </label>
              <div className="rv1-correction-map" ref={mapElementRef} />
              <div className="rv1-map-help"><strong>Cómo corregir</strong><span>Amplía el mapa, toca la entrada correcta o arrastra el símbolo ⌖.</span></div>
            </div>

            <div className="rv1-form-side">
              <div className="rv1-stop-state">
                <strong>{selected ? addressLabel(selected) : "Sin vivienda"}</strong>
                <span className={correction ? "corrected" : reviewFlag ? "review" : "original"}>{correction ? "Ubicación corregida" : reviewFlag ? "Pendiente de revisar" : "Ubicación original"}</span>
              </div>
              <div className="rv1-coordinate-grid">
                <label className="rv1-field">Latitud<input inputMode="decimal" value={draft.lat} onChange={(event) => setDraft((old) => ({ ...old, lat: event.target.value }))} /></label>
                <label className="rv1-field">Longitud<input inputMode="decimal" value={draft.lng} onChange={(event) => setDraft((old) => ({ ...old, lng: event.target.value }))} /></label>
              </div>
              <label className="rv1-field">Calle y número<input value={draft.address} onChange={(event) => setDraft((old) => ({ ...old, address: event.target.value }))} /></label>
              <label className="rv1-field">Observación para el conductor<input value={draft.note} onChange={(event) => setDraft((old) => ({ ...old, note: event.target.value }))} placeholder="Portón azul, detenerse al lado derecho…" /></label>
              <label className="rv1-field">Motivo de la corrección<input value={draft.reason} onChange={(event) => setDraft((old) => ({ ...old, reason: event.target.value }))} placeholder="El punto estaba 30 m antes de la entrada" /></label>

              <div className="rv1-distance-change"><span>Movimiento del punto</span><strong>{Math.round(movedMeters)} m</strong></div>
              {correction && <div className="rv1-history-summary"><strong>Último cambio</strong><span>{new Date(correction.updatedAt).toLocaleString("es-CL")} · {correction.reason}</span><small>{correction.history.length} cambio(s) guardado(s)</small></div>}
              {reviewFlag && <div className="rv1-review-summary"><strong>Marcada para revisar</strong><span>{reviewFlag.reason}</span></div>}

              <div className="rv1-form-actions">
                <button type="button" onClick={useCurrentLocation}>Usar GPS actual</button>
                <button type="button" className="secondary" onClick={() => loadSelectedIntoDraft(selected)}>Descartar movimiento</button>
                <button type="button" className={reviewFlag ? "warning active" : "warning"} onClick={() => void toggleReviewFlag()} disabled={saving}>{reviewFlag ? "Quitar marca" : "Marcar para revisar"}</button>
                <button type="button" className="primary" onClick={() => void saveCorrection()} disabled={saving}>{saving ? "Guardando…" : "Guardar y recalcular ruta"}</button>
                {correction && <button type="button" className="danger" onClick={() => void restoreOriginal()} disabled={saving}>Restaurar ubicación original</button>}
              </div>
              {message && <div className="rv1-tools-message" role="status">{message}</div>}
            </div>
          </div>

          <footer><span>Las correcciones se guardan cifradas en este dispositivo. En la Etapa 2 pasarán a la base de datos central.</span><button type="button" onClick={exportCorrections}>Exportar respaldo JSON</button></footer>
        </section>
      </div>}
    </>
  );
}

export default function StageOneTools({ onRouteChanged }: Props) {
  const [store, setStore] = useState<RouteCorrectionStore | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void loadRouteCorrectionStore().then((value) => {
      if (active) setStore(value);
    });
    return () => { active = false; };
  }, []);

  const routeChanged = () => {
    setRevision((value) => value + 1);
    onRouteChanged();
  };

  return (
    <>
      <TurnByTurnNavigation revision={revision} />
      {store && <CorrectionPanel store={store} onStoreChange={setStore} onRouteChanged={routeChanged} />}
      <style jsx global>{`
        .rv1-navigation {
          position: fixed;
          z-index: 9998;
          top: 72px;
          left: 50%;
          transform: translateX(-50%);
          width: min(760px, calc(100vw - 24px));
          display: grid;
          grid-template-columns: 86px minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          padding: 13px 16px 12px;
          border: 1px solid rgba(255,255,255,.13);
          border-radius: 20px;
          background: rgba(7, 29, 22, .96);
          color: white;
          box-shadow: 0 20px 50px rgba(0,0,0,.3);
          backdrop-filter: blur(16px);
        }
        .rv1-navigation-idle { grid-template-columns: 58px minmax(0, 1fr) auto; }
        .rv1-navigation-finished { grid-template-columns: 58px minmax(0, 1fr); background: rgba(18, 101, 71, .97); }
        .rv1-nav-icon { display: grid; place-items: center; min-height: 64px; border-radius: 16px; background: #e3f4b2; color: #123d2e; font-size: 45px; font-weight: 900; line-height: 1; }
        .rv1-nav-main, .rv1-nav-copy { display: grid; min-width: 0; }
        .rv1-nav-distance { color: #d9ef8e; font-size: 13px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase; }
        .rv1-nav-main strong, .rv1-nav-copy strong { overflow: hidden; font-size: 22px; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
        .rv1-nav-main > span { overflow: hidden; margin-top: 5px; color: #b9d8ce; font-size: 14px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
        .rv1-nav-main small, .rv1-nav-copy small, .rv1-navigation-finished small { overflow: hidden; margin-top: 4px; color: rgba(255,255,255,.65); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .rv1-navigation-idle > button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 13px; background: #dcec75; color: #143d2f; font-weight: 900; cursor: pointer; }
        .rv1-nav-actions { display: grid; grid-template-columns: repeat(2, 38px); gap: 6px; }
        .rv1-nav-actions button { width: 38px; height: 35px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(255,255,255,.08); color: white; font-size: 17px; cursor: pointer; }
        .rv1-nav-status { position: absolute; right: 18px; bottom: -21px; max-width: 70%; overflow: hidden; padding: 4px 10px; border-radius: 0 0 10px 10px; background: #102e25; color: #a8cfc2; font-size: 9px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
        .rv1-nav-status.offline { color: #ffd166; }

        .rv1-tools-launcher {
          position: fixed;
          z-index: 9997;
          left: 16px;
          bottom: 16px;
          display: grid;
          grid-template-columns: 38px auto;
          grid-template-rows: auto auto;
          align-items: center;
          column-gap: 9px;
          min-width: 188px;
          padding: 9px 13px;
          border: 1px solid rgba(255,255,255,.3);
          border-radius: 17px;
          background: rgba(13, 58, 44, .96);
          color: white;
          box-shadow: 0 15px 35px rgba(0,0,0,.24);
          cursor: pointer;
        }
        .rv1-tools-launcher > span { grid-row: 1 / 3; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: #dcec75; color: #174534; font-size: 24px; }
        .rv1-tools-launcher strong { text-align: left; font-size: 12px; }
        .rv1-tools-launcher small { color: #b8d5cb; font-size: 9px; text-align: left; }
        .rv1-tools-backdrop { position: fixed; z-index: 10020; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(2, 15, 11, .78); backdrop-filter: blur(8px); }
        .rv1-tools-panel { width: min(1120px, 100%); max-height: calc(100vh - 36px); overflow: auto; border: 1px solid #d7e2dc; border-radius: 26px; background: #f6f8f5; color: #173d31; box-shadow: 0 35px 90px rgba(0,0,0,.45); }
        .rv1-tools-panel > header { position: sticky; z-index: 500; top: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px 24px 17px; background: rgba(246,248,245,.96); border-bottom: 1px solid #dce5e0; backdrop-filter: blur(12px); }
        .rv1-tools-panel > header span { color: #278064; font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
        .rv1-tools-panel > header h2 { margin: 4px 0 3px; font-size: 28px; }
        .rv1-tools-panel > header p { margin: 0; color: #5c746b; font-size: 12px; }
        .rv1-tools-panel > header > button { width: 42px; height: 42px; flex: 0 0 auto; border: 0; border-radius: 13px; background: #e4ebe7; color: #173d31; font-size: 28px; cursor: pointer; }
        .rv1-diagnostics { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 12px 24px; border-bottom: 1px solid #dce5e0; background: #eef3f0; }
        .rv1-diagnostics span { padding: 6px 9px; border-radius: 999px; background: white; font-size: 10px; font-weight: 900; }
        .rv1-diagnostics .ok { color: #16704f; }
        .rv1-diagnostics .warn { color: #9b6200; }
        .rv1-diagnostics .bad { color: #a63e2f; }
        .rv1-diagnostics button { margin-left: auto; padding: 7px 11px; border: 1px solid #b9cbc2; border-radius: 10px; background: white; color: #174534; font-weight: 900; cursor: pointer; }
        .rv1-tools-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(330px, .85fr); gap: 18px; padding: 20px 24px 24px; }
        .rv1-map-side, .rv1-form-side { min-width: 0; }
        .rv1-correction-map { height: 500px; margin-top: 10px; overflow: hidden; border: 2px solid #cad8d1; border-radius: 20px; background: #dfe8e3; }
        .rv1-map-help { display: grid; gap: 2px; margin-top: 9px; padding: 10px 12px; border-radius: 13px; background: #e8f1ec; font-size: 11px; }
        .rv1-map-help span { color: #5e746c; }
        .rv1-selected-marker { display: grid; place-items: center; width: 42px; height: 42px; border: 4px solid white; border-radius: 50%; background: #e65c3c; color: white; box-shadow: 0 8px 20px rgba(0,0,0,.3); font-size: 25px; font-weight: 900; }
        .rv1-other-marker { display: block; width: 12px; height: 12px; border: 2px solid white; border-radius: 50%; background: #46675b; box-shadow: 0 2px 7px rgba(0,0,0,.25); }
        .rv1-other-marker.corrected { background: #1d9b6c; }
        .rv1-other-marker.review { background: #f0a51d; }
        .rv1-field { display: grid; gap: 5px; margin-bottom: 11px; color: #456057; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; }
        .rv1-field input, .rv1-field select { width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid #bdccc5; border-radius: 12px; background: white; color: #173d31; font: inherit; font-size: 13px; font-weight: 700; text-transform: none; letter-spacing: 0; outline: none; }
        .rv1-field input:focus, .rv1-field select:focus { border-color: #2b8b69; box-shadow: 0 0 0 3px rgba(43,139,105,.12); }
        .rv1-coordinate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        .rv1-stop-state { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; padding: 13px; border-radius: 15px; background: white; border: 1px solid #d4dfd9; }
        .rv1-stop-state strong { font-size: 14px; }
        .rv1-stop-state span { padding: 6px 9px; border-radius: 999px; font-size: 9px; font-weight: 900; white-space: nowrap; }
        .rv1-stop-state span.original { background: #edf1ef; color: #5c6f68; }
        .rv1-stop-state span.corrected { background: #d9f3e7; color: #13724e; }
        .rv1-stop-state span.review { background: #fff0cf; color: #9a5f00; }
        .rv1-distance-change { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 11px; padding: 11px 13px; border-radius: 13px; background: #173d31; color: white; }
        .rv1-distance-change span { font-size: 11px; }
        .rv1-distance-change strong { color: #dcec75; font-size: 20px; }
        .rv1-history-summary, .rv1-review-summary { display: grid; gap: 3px; margin-bottom: 10px; padding: 11px 13px; border-radius: 13px; background: #e0f2e9; color: #1c6048; font-size: 10px; }
        .rv1-review-summary { background: #fff0cf; color: #825200; }
        .rv1-history-summary span, .rv1-review-summary span { line-height: 1.35; }
        .rv1-history-summary small { opacity: .7; }
        .rv1-form-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rv1-form-actions button { min-height: 44px; padding: 8px 10px; border: 1px solid #b9cbc2; border-radius: 12px; background: white; color: #174534; font-weight: 900; cursor: pointer; }
        .rv1-form-actions button.primary { grid-column: 1 / -1; background: #167153; border-color: #167153; color: white; }
        .rv1-form-actions button.warning { background: #fff3d8; border-color: #efc96f; color: #855500; }
        .rv1-form-actions button.warning.active { background: #f0a51d; color: #442b00; }
        .rv1-form-actions button.danger { grid-column: 1 / -1; background: #fff0ed; border-color: #e6aaa0; color: #a13c2e; }
        .rv1-form-actions button:disabled { opacity: .55; cursor: wait; }
        .rv1-tools-message { margin-top: 10px; padding: 11px 13px; border-radius: 12px; background: #e2ebe6; color: #284d40; font-size: 11px; font-weight: 800; line-height: 1.4; }
        .rv1-tools-panel > footer { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 24px 18px; border-top: 1px solid #dce5e0; color: #61776f; font-size: 10px; }
        .rv1-tools-panel > footer button { flex: 0 0 auto; padding: 9px 12px; border: 1px solid #b9cbc2; border-radius: 11px; background: white; color: #174534; font-weight: 900; cursor: pointer; }

        @media (max-width: 900px) {
          .rv1-navigation { top: 67px; grid-template-columns: 62px minmax(0, 1fr) auto; gap: 9px; width: calc(100vw - 14px); padding: 9px 10px; border-radius: 16px; }
          .rv1-navigation-idle { grid-template-columns: 48px minmax(0, 1fr) auto; }
          .rv1-navigation-finished { grid-template-columns: 48px minmax(0, 1fr); }
          .rv1-nav-icon { min-height: 52px; border-radius: 12px; font-size: 34px; }
          .rv1-nav-main strong, .rv1-nav-copy strong { font-size: 16px; }
          .rv1-nav-main > span { font-size: 11px; }
          .rv1-nav-main small { display: none; }
          .rv1-nav-actions { grid-template-columns: repeat(2, 32px); gap: 4px; }
          .rv1-nav-actions button { width: 32px; height: 30px; font-size: 14px; }
          .rv1-nav-status { display: none; }
          .rv1-navigation-idle > button { min-height: 38px; padding: 0 11px; font-size: 11px; }
          .rv1-tools-launcher { left: 8px; bottom: 8px; min-width: 154px; padding: 7px 9px; }
          .rv1-tools-launcher small { display: none; }
          .rv1-tools-backdrop { padding: 0; }
          .rv1-tools-panel { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; }
          .rv1-tools-panel > header { padding: 14px 15px 12px; }
          .rv1-tools-panel > header h2 { font-size: 22px; }
          .rv1-tools-panel > header p { max-width: 290px; font-size: 10px; }
          .rv1-diagnostics { padding: 9px 12px; }
          .rv1-diagnostics button { margin-left: 0; }
          .rv1-tools-grid { grid-template-columns: 1fr; padding: 12px; }
          .rv1-correction-map { height: 44vh; min-height: 320px; }
          .rv1-tools-panel > footer { align-items: flex-start; padding: 12px; }
        }
      `}</style>
    </>
  );
}

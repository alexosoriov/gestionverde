"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "./route-data";
import { getRoadRoute } from "./road-route";
import type { GpsMetrics, TrackingActivity } from "./tracking-types";
import { applyTruckAppearance, bearingBetween, normalizeHeading, truckIcon } from "./truck-marker";

type Props = {
  stops: Stop[];
  statuses: Record<string, "pending" | "done" | "absent">;
  activeId?: string;
  activeStop?: Stop;
  completed: number;
  done: number;
  absent: number;
  pending: number;
  total: number;
  kilos: number;
  routeKm: number;
  baselineRouteKm: number;
  routeSavingsKm: number;
  plannedDriveMinutes: number;
  estimatedMinutes: number;
  startedAt: number | null;
  privacyMode: boolean;
  activity: TrackingActivity[];
  initialMetrics: GpsMetrics;
  startSignal: number;
  resetSignal: number;
  pickLocationMode: boolean;
  onTrackingChange: (active: boolean) => void;
  onArrival: (stop: Stop, distanceMeters: number) => void;
  onGpsMetrics: (metrics: GpsMetrics) => void;
  onLocationPicked: (lat: number, lng: number) => void;
};

type PositionInfo = {
  accuracy: number;
  speed: number | null;
  heading: number;
  moving: boolean;
};

type PendingJump = { point: L.LatLng; count: number };
type ArrivalCandidate = { stopId: string; confirmations: number; firstSeenAt: number };
type WakeLockHandle = { release(): Promise<void> };
type LiveState = {
  activeStop?: Stop;
  completed: number;
  done: number;
  absent: number;
  pending: number;
  total: number;
  kilos: number;
  routeKm: number;
  baselineRouteKm: number;
  routeSavingsKm: number;
  plannedDriveMinutes: number;
  estimatedMinutes: number;
  startedAt: number | null;
  privacyMode: boolean;
  activity: TrackingActivity[];
};

const OUTBOX_KEY = "santuario-tracking-outbox-v4";
const MAX_GPS_ACCURACY_METERS = 70;
const ARRIVAL_MAX_ACCURACY_METERS = 25;
const ARRIVAL_CONFIRMATIONS = 3;
const ARRIVAL_MIN_DWELL_MS = 2_500;
const ARRIVAL_MAX_SPEED_METERS_PER_SECOND = 5.5;
const MIN_RECORDED_STEP_METERS = 5;
const MIN_HEADING_STEP_METERS = 8;
const MOVING_SPEED_METERS_PER_SECOND = 1.2;
const HEADING_SPEED_METERS_PER_SECOND = 1.8;
const MAX_NORMAL_JUMP_METERS = 220;
const MAX_REASONABLE_SPEED_METERS_PER_SECOND = 55;
const GPS_RESET_AFTER_MS = 20_000;
const GPS_DELAY_WARNING_MS = 12_000;
const GPS_LOST_WARNING_MS = 25_000;
const SYNC_INTERVAL_MS = 5_000;
const MAX_METRIC_INTERVAL_MS = 30_000;

function addressLabel(stop: Stop) {
  return stop.address ?? `Punto GPS ${stop.id}`;
}

function visibleStopLabel(stop: Stop, privacyMode: boolean) {
  return privacyMode ? addressLabel(stop) : `${stop.name} · ${addressLabel(stop)}`;
}

function journeyId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `santuario-${date}`;
}

function roundedMetrics(distanceMeters: number, movingMs: number, stoppedMs: number): GpsMetrics {
  return {
    actualKm: Math.round((distanceMeters / 1000) * 1000) / 1000,
    movingMinutes: Math.round((movingMs / 60_000) * 10) / 10,
    stoppedMinutes: Math.round((stoppedMs / 60_000) * 10) / 10,
  };
}

function shortestHeadingDelta(from: number, to: number) {
  return ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180;
}

function smoothHeading(current: number, next: number) {
  return normalizeHeading(current + shortestHeadingDelta(current, next) * 0.28);
}

export default function LiveMap({
  stops,
  statuses,
  activeId,
  activeStop,
  completed,
  done,
  absent,
  pending,
  total,
  kilos,
  routeKm,
  baselineRouteKm,
  routeSavingsKm,
  plannedDriveMinutes,
  estimatedMinutes,
  startedAt,
  privacyMode,
  activity,
  initialMetrics,
  startSignal,
  resetSignal,
  pickLocationMode,
  onTrackingChange,
  onArrival,
  onGpsMetrics,
  onLocationPicked,
}: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const watchRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const acceptedPointRef = useRef<L.LatLng | null>(null);
  const lastFixAtRef = useRef<number | null>(null);
  const lastMetricAtRef = useRef<number | null>(null);
  const pendingJumpRef = useRef<PendingJump | null>(null);
  const headingRef = useRef(0);
  const renderedHeadingRef = useRef(0);
  const arrivalRef = useRef<string | null>(null);
  const arrivalCandidateRef = useRef<ArrivalCandidate | null>(null);
  const lastSyncRef = useRef(0);
  const followRef = useRef(true);
  const trackingRef = useRef(false);
  const positionInfoRef = useRef<PositionInfo | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const initialStopsRef = useRef(stops);
  const handledStartSignalRef = useRef(0);
  const handledResetSignalRef = useRef(resetSignal);
  const distanceMetersRef = useRef(initialMetrics.actualKm * 1000);
  const movingMsRef = useRef(initialMetrics.movingMinutes * 60_000);
  const stoppedMsRef = useRef(initialMetrics.stoppedMinutes * 60_000);
  const hasCenteredFirstFixRef = useRef(false);
  const liveStateRef = useRef<LiveState>({
    activeStop,
    completed,
    done,
    absent,
    pending,
    total,
    kilos,
    routeKm,
    baselineRouteKm,
    routeSavingsKm,
    plannedDriveMinutes,
    estimatedMinutes,
    startedAt,
    privacyMode,
    activity,
  });

  const [tracking, setTracking] = useState(false);
  const [follow, setFollow] = useState(true);
  const [gpsMessage, setGpsMessage] = useState("GPS detenido");
  const [positionInfo, setPositionInfo] = useState<PositionInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    arrivalRef.current = null;
    arrivalCandidateRef.current = null;
  }, [activeId]);

  useEffect(() => {
    liveStateRef.current = {
      activeStop,
      completed,
      done,
      absent,
      pending,
      total,
      kilos,
      routeKm,
      baselineRouteKm,
      routeSavingsKm,
      plannedDriveMinutes,
      estimatedMinutes,
      startedAt,
      privacyMode,
      activity,
    };
  }, [
    activeStop,
    completed,
    done,
    absent,
    pending,
    total,
    kilos,
    routeKm,
    baselineRouteKm,
    routeSavingsKm,
    plannedDriveMinutes,
    estimatedMinutes,
    startedAt,
    privacyMode,
    activity,
  ]);

  useEffect(() => {
    if (trackingRef.current) return;
    distanceMetersRef.current = initialMetrics.actualKm * 1000;
    movingMsRef.current = initialMetrics.movingMinutes * 60_000;
    stoppedMsRef.current = initialMetrics.stoppedMinutes * 60_000;
  }, [initialMetrics]);

  const releaseWakeLock = useCallback(async () => {
    const current = wakeLockRef.current;
    wakeLockRef.current = null;
    try {
      await current?.release();
    } catch {}
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (document.visibilityState !== "visible" || wakeLockRef.current) return;
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<WakeLockHandle> };
    }).wakeLock;
    if (!wakeLockApi) return;
    try {
      wakeLockRef.current = await wakeLockApi.request("screen");
    } catch {}
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && trackingRef.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [requestWakeLock]);

  const sendTracking = useCallback(async (
    point: L.LatLng,
    info: PositionInfo,
    statusOverride?: "active" | "paused" | "finished",
  ) => {
    const state = liveStateRef.current;
    const metrics = roundedMetrics(distanceMetersRef.current, movingMsRef.current, stoppedMsRef.current);
    const payload = JSON.stringify({
      journeyId: journeyId(),
      lat: point.lat,
      lng: point.lng,
      speed: info.speed,
      heading: info.heading,
      accuracy: info.accuracy,
      nextStop: state.activeStop ? visibleStopLabel(state.activeStop, state.privacyMode) : null,
      completed: state.completed,
      done: state.done,
      absent: state.absent,
      pending: state.pending,
      total: state.total,
      kilos: state.kilos,
      routeKm: state.routeKm,
      baselineRouteKm: state.baselineRouteKm,
      routeSavingsKm: state.routeSavingsKm,
      plannedDriveMinutes: state.plannedDriveMinutes,
      actualKm: metrics.actualKm,
      movingMinutes: metrics.movingMinutes,
      stoppedMinutes: metrics.stoppedMinutes,
      estimatedMinutes: state.estimatedMinutes,
      startedAt: state.startedAt,
      activity: state.activity,
      status: statusOverride ?? (state.completed >= state.total ? "finished" : "active"),
    });

    try {
      const response = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (!response.ok) throw new Error("sync failed");
      localStorage.removeItem(OUTBOX_KEY);
    } catch {
      localStorage.setItem(OUTBOX_KEY, payload);
    }
  }, []);

  useEffect(() => {
    const flush = async () => {
      const queued = localStorage.getItem(OUTBOX_KEY);
      if (!queued) return;
      try {
        const response = await fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: queued,
        });
        if (response.ok) localStorage.removeItem(OUTBOX_KEY);
      } catch {}
    };
    window.addEventListener("online", flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  useEffect(() => {
    if (!tracking) return;
    const point = acceptedPointRef.current;
    const info = positionInfoRef.current;
    if (!point || !info) return;
    const timer = window.setTimeout(() => void sendTracking(point, info), 180);
    return () => window.clearTimeout(timer);
  }, [
    tracking,
    activeId,
    completed,
    done,
    absent,
    pending,
    total,
    kilos,
    routeKm,
    baselineRouteKm,
    routeSavingsKm,
    plannedDriveMinutes,
    estimatedMinutes,
    startedAt,
    privacyMode,
    activity,
    sendTracking,
  ]);

  useEffect(() => {
    if (!tracking) return;
    const timer = window.setInterval(() => {
      const lastFix = lastFixAtRef.current;
      if (!lastFix) return;
      const age = Date.now() - lastFix;
      if (age >= GPS_LOST_WARNING_MS) {
        setGpsMessage("Señal GPS perdida · buscando nuevamente…");
      } else if (age >= GPS_DELAY_WARNING_MS) {
        setGpsMessage("GPS sin actualización reciente · manteniendo última ubicación");
      }
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    const map = L.map(mapElement.current, {
      zoomControl: true,
      attributionControl: true,
      zoomAnimation: true,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });

    baseLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
      errorTileUrl: "/offline-map-tile.svg",
    }).addTo(map);

    mapRef.current = map;
    stopsLayerRef.current = L.layerGroup().addTo(map);
    trailRef.current = L.polyline([], {
      color: "#0f6f54",
      weight: 6,
      opacity: 0.88,
      lineCap: "round",
      lineJoin: "round",
      smoothFactor: 1.2,
    }).addTo(map);

    const initialStops = initialStopsRef.current;
    if (initialStops.length) {
      map.fitBounds(
        L.latLngBounds(initialStops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12),
      );
    }

    const stopFollowingForManualMapUse = () => {
      if (!trackingRef.current || !followRef.current) return;
      followRef.current = false;
      setFollow(false);
      setGpsMessage("Vista libre · usa “Seguir camión” para recentrar");
    };

    const container = map.getContainer();
    container.addEventListener("pointerdown", stopFollowingForManualMapUse, { passive: true });
    container.addEventListener("touchstart", stopFollowingForManualMapUse, { passive: true });
    container.addEventListener("wheel", stopFollowingForManualMapUse, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", stopFollowingForManualMapUse);
      container.removeEventListener("touchstart", stopFollowingForManualMapUse);
      container.removeEventListener("wheel", stopFollowingForManualMapUse);
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      void releaseWakeLock();
      map.remove();
      mapRef.current = null;
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    container.style.cursor = pickLocationMode ? "crosshair" : "";
    if (!pickLocationMode) return;

    const handleClick = (event: L.LeafletMouseEvent) => {
      followRef.current = false;
      setFollow(false);
      onLocationPicked(event.latlng.lat, event.latlng.lng);
      map.flyTo(event.latlng, Math.max(map.getZoom(), 17));
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      container.style.cursor = "";
    };
  }, [pickLocationMode, onLocationPicked]);

  useEffect(() => {
    const layer = stopsLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const controller = new AbortController();
    layer.clearLayers();

    void getRoadRoute(stops, controller.signal)
      .then((roadPoints) => {
        if (!roadPoints.length || controller.signal.aborted) return;
        L.polyline(roadPoints, {
          color: "#1d8062",
          weight: 5,
          opacity: 0.82,
          lineCap: "round",
          lineJoin: "round",
          smoothFactor: 1,
        }).addTo(layer).bringToBack();
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGpsMessage("Paradas visibles · usando trazado local de respaldo");
        }
      });

    stops.forEach((stop, index) => {
      const state = statuses[stop.id] ?? "pending";
      const active = stop.id === activeId;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "stop-marker-wrap",
          html: `<span class="street-stop ${state} ${active ? "active" : ""}">${index + 1}</span>`,
          iconSize: active ? [36, 36] : [28, 28],
          iconAnchor: active ? [18, 18] : [14, 14],
        }),
      }).addTo(layer);

      marker.bindTooltip(`${index + 1}. ${visibleStopLabel(stop, privacyMode)}`, {
        direction: "top",
        offset: [0, -12],
      });

      marker.on("click", () => {
        if (pickLocationMode) return;
        followRef.current = false;
        setFollow(false);
        map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 17));
      });
    });

    return () => controller.abort();
  }, [stops, statuses, activeId, privacyMode, pickLocationMode]);

  const animateTruckTo = useCallback((target: L.LatLng, accuracy: number) => {
    const marker = truckRef.current;
    if (!marker) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);

    const start = marker.getLatLng();
    const distance = start.distanceTo(target);
    if (distance < 1) {
      accuracyRef.current?.setLatLng(target).setRadius(accuracy);
      return;
    }

    const duration = Math.min(900, Math.max(300, distance * 30));
    const started = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const current = L.latLng(
        start.lat + (target.lat - start.lat) * eased,
        start.lng + (target.lng - start.lng) * eased,
      );
      marker.setLatLng(current);
      accuracyRef.current?.setLatLng(current).setRadius(accuracy);
      if (progress < 1) animationRef.current = requestAnimationFrame(step);
      else animationRef.current = null;
    };

    animationRef.current = requestAnimationFrame(step);
  }, []);

  const acceptPoint = useCallback((raw: L.LatLng, accuracy: number, timestamp: number) => {
    const previous = acceptedPointRef.current;
    if (!previous) return raw;

    const distance = previous.distanceTo(raw);
    const gap = lastFixAtRef.current === null ? 0 : timestamp - lastFixAtRef.current;
    const elapsedSeconds = Math.max(gap / 1_000, 0.1);
    const impliedSpeed = distance / elapsedSeconds;
    const plausibleMovement =
      distance <= MAX_NORMAL_JUMP_METERS ||
      impliedSpeed <= MAX_REASONABLE_SPEED_METERS_PER_SECOND;

    if (gap >= GPS_RESET_AFTER_MS) {
      pendingJumpRef.current = null;
      setGpsMessage("GPS recuperado después de perder señal");
      return raw;
    }

    if (!plausibleMovement) {
      const pendingJump = pendingJumpRef.current;
      const confirmationRadius = Math.max(accuracy * 1.5, 35);
      const consistent = pendingJump && pendingJump.point.distanceTo(raw) <= confirmationRadius;
      pendingJumpRef.current = {
        point: raw,
        count: consistent ? pendingJump.count + 1 : 1,
      };
      if (pendingJumpRef.current.count >= 3) {
        pendingJumpRef.current = null;
        setGpsMessage("Nueva ubicación GPS confirmada");
        return raw;
      }
      return null;
    }

    pendingJumpRef.current = null;

    const stationaryRadius = Math.max(MIN_RECORDED_STEP_METERS, Math.min(14, accuracy * 0.45));
    if (distance <= stationaryRadius) return previous;

    const alpha = accuracy <= 8 ? 0.7 : accuracy <= 18 ? 0.48 : 0.3;
    return L.latLng(
      previous.lat + (raw.lat - previous.lat) * alpha,
      previous.lng + (raw.lng - previous.lng) * alpha,
    );
  }, []);

  const stopTracking = useCallback(() => {
    const point = acceptedPointRef.current;
    const info = positionInfoRef.current;
    const state = liveStateRef.current;
    if (point && info) {
      void sendTracking(point, info, state.completed >= state.total ? "finished" : "paused");
    }

    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    watchRef.current = null;
    animationRef.current = null;
    acceptedPointRef.current = null;
    lastFixAtRef.current = null;
    lastMetricAtRef.current = null;
    pendingJumpRef.current = null;
    arrivalCandidateRef.current = null;
    hasCenteredFirstFixRef.current = false;
    trackingRef.current = false;
    setTracking(false);
    onTrackingChange(false);
    setGpsMessage("GPS detenido");
    void releaseWakeLock();
  }, [onTrackingChange, releaseWakeLock, sendTracking]);

  const beginTracking = useCallback(() => {
    if (trackingRef.current) {
      followRef.current = true;
      setFollow(true);
      const point = truckRef.current?.getLatLng();
      if (point && mapRef.current) mapRef.current.panTo(point, { animate: true, duration: 0.35 });
      return;
    }

    if (!navigator.geolocation) {
      setGpsMessage("Este dispositivo no tiene GPS disponible");
      return;
    }

    trackingRef.current = true;
    followRef.current = true;
    setTracking(true);
    setFollow(true);
    onTrackingChange(true);
    setGpsMessage("Solicitando ubicación de alta precisión…");
    void requestWakeLock();

    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const map = mapRef.current;
        if (!map) return;

        if (coords.accuracy > MAX_GPS_ACCURACY_METERS) {
          arrivalCandidateRef.current = null;
          setGpsMessage(`Esperando una señal GPS más precisa (${Math.round(coords.accuracy)} m)`);
          return;
        }

        const rawPoint = L.latLng(coords.latitude, coords.longitude);
        const point = acceptPoint(rawPoint, coords.accuracy, timestamp);
        if (!point) {
          setGpsMessage("Verificando un cambio grande de ubicación…");
          return;
        }

        const previous = acceptedPointRef.current;
        const movedMeters = previous?.distanceTo(point) ?? 0;
        const elapsedSeconds = lastFixAtRef.current === null
          ? null
          : Math.max((timestamp - lastFixAtRef.current) / 1_000, 0.1);
        const derivedSpeed = elapsedSeconds === null ? null : movedMeters / elapsedSeconds;
        const gpsSpeed =
          coords.speed !== null && Number.isFinite(coords.speed) && coords.speed >= 0
            ? coords.speed
            : null;
        const currentSpeed = gpsSpeed ?? derivedSpeed;
        const reliableMovementRadius = Math.max(
          MIN_RECORDED_STEP_METERS,
          Math.min(14, coords.accuracy * 0.45),
        );
        const moving = gpsSpeed !== null
          ? gpsSpeed >= MOVING_SPEED_METERS_PER_SECOND
          : movedMeters >= reliableMovementRadius;

        const canUpdateHeading =
          moving &&
          (
            (gpsSpeed !== null && gpsSpeed >= HEADING_SPEED_METERS_PER_SECOND) ||
            movedMeters >= MIN_HEADING_STEP_METERS
          );
        const gpsHeading =
          canUpdateHeading &&
          coords.heading !== null &&
          Number.isFinite(coords.heading)
            ? coords.heading
            : null;
        const calculatedHeading =
          canUpdateHeading && previous && movedMeters >= MIN_HEADING_STEP_METERS
            ? (gpsHeading ?? bearingBetween(previous, point))
            : headingRef.current;

        const metricDelta = lastMetricAtRef.current === null
          ? 0
          : Math.min(Math.max(0, timestamp - lastMetricAtRef.current), MAX_METRIC_INTERVAL_MS);
        if (metricDelta > 0) {
          if (moving) movingMsRef.current += metricDelta;
          else stoppedMsRef.current += metricDelta;
        }

        const reasonableStep =
          movedMeters >= reliableMovementRadius &&
          movedMeters <= MAX_NORMAL_JUMP_METERS &&
          (currentSpeed === null || currentSpeed <= MAX_REASONABLE_SPEED_METERS_PER_SECOND);
        if (reasonableStep) distanceMetersRef.current += movedMeters;

        if (canUpdateHeading) {
          headingRef.current = smoothHeading(headingRef.current, calculatedHeading);
        }

        acceptedPointRef.current = point;
        lastFixAtRef.current = timestamp;
        lastMetricAtRef.current = timestamp;

        if (!truckRef.current) {
          renderedHeadingRef.current = headingRef.current;
          truckRef.current = L.marker(point, {
            icon: truckIcon(renderedHeadingRef.current, moving),
            zIndexOffset: 1_000,
          }).addTo(map);
          truckRef.current.bindTooltip(
            moving ? "🚛 Camión en movimiento" : "🚛 Camión detenido",
            { direction: "top", offset: [0, -28] },
          );
          accuracyRef.current = L.circle(point, {
            radius: coords.accuracy,
            color: "#2486ff",
            fillColor: "#2486ff",
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(map);
        } else {
          renderedHeadingRef.current = applyTruckAppearance(
            truckRef.current,
            headingRef.current,
            moving,
            renderedHeadingRef.current,
          );
          animateTruckTo(point, coords.accuracy);
        }

        if (reasonableStep) trailRef.current?.addLatLng(point);

        if (followRef.current) {
          if (!hasCenteredFirstFixRef.current) {
            hasCenteredFirstFixRef.current = true;
            map.setView(point, Math.max(map.getZoom(), 16), { animate: false });
          } else {
            const innerBounds = map.getBounds().pad(-0.28);
            if (!innerBounds.contains(point)) {
              map.panTo(point, { animate: true, duration: 0.35, easeLinearity: 0.4 });
            }
          }
        }

        const info: PositionInfo = {
          accuracy: coords.accuracy,
          speed: currentSpeed,
          heading: headingRef.current,
          moving,
        };
        positionInfoRef.current = info;
        setPositionInfo(info);
        setGpsMessage(
          followRef.current
            ? (moving ? "Camión avanzando en tiempo real" : "Camión localizado · señal estable")
            : "GPS activo · vista libre del mapa",
        );

        const metrics = roundedMetrics(
          distanceMetersRef.current,
          movingMsRef.current,
          stoppedMsRef.current,
        );
        onGpsMetrics(metrics);

        const state = liveStateRef.current;
        if (state.activeStop) {
          const distanceMeters = point.distanceTo(
            L.latLng(state.activeStop.lat, state.activeStop.lng),
          );
          const arrivalRadius = Math.min(32, Math.max(22, 18 + coords.accuracy * 0.48));
          const slowEnough =
            currentSpeed === null || currentSpeed <= ARRIVAL_MAX_SPEED_METERS_PER_SECOND;
          const reliableArrival =
            coords.accuracy <= ARRIVAL_MAX_ACCURACY_METERS &&
            distanceMeters <= arrivalRadius &&
            slowEnough;

          if (reliableArrival) {
            const previousCandidate = arrivalCandidateRef.current;
            arrivalCandidateRef.current = previousCandidate?.stopId === state.activeStop.id
              ? { ...previousCandidate, confirmations: previousCandidate.confirmations + 1 }
              : { stopId: state.activeStop.id, confirmations: 1, firstSeenAt: timestamp };

            const candidate = arrivalCandidateRef.current;
            const confirmed =
              candidate.confirmations >= ARRIVAL_CONFIRMATIONS &&
              timestamp - candidate.firstSeenAt >= ARRIVAL_MIN_DWELL_MS;

            if (confirmed && arrivalRef.current !== state.activeStop.id) {
              arrivalRef.current = state.activeStop.id;
              navigator.vibrate?.([250, 120, 250]);
              if ("speechSynthesis" in window) {
                const message = state.privacyMode
                  ? `Llegaste a la dirección ${addressLabel(state.activeStop)}`
                  : `Llegaste a la parada de ${state.activeStop.name}, dirección ${addressLabel(state.activeStop)}`;
                const voice = new SpeechSynthesisUtterance(message);
                voice.lang = "es-CL";
                voice.rate = 0.96;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(voice);
              }
              onArrival(state.activeStop, distanceMeters);
            }
          } else {
            arrivalCandidateRef.current = null;
          }
        }

        if (Date.now() - lastSyncRef.current >= SYNC_INTERVAL_MS) {
          lastSyncRef.current = Date.now();
          void sendTracking(point, info);
        }
      },
      (error) => {
        if (error.code === 1) {
          if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
          trackingRef.current = false;
          setTracking(false);
          onTrackingChange(false);
          setGpsMessage("Debes permitir la ubicación para ver el camión");
          void releaseWakeLock();
          return;
        }

        if (truckRef.current) {
          renderedHeadingRef.current = applyTruckAppearance(
            truckRef.current,
            headingRef.current,
            false,
            renderedHeadingRef.current,
          );
        }

        setGpsMessage(
          error.code === 2
            ? "Señal GPS temporalmente no disponible · sigo intentando"
            : "El GPS tardó demasiado · sigo buscando ubicación",
        );
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
    );

    watchRef.current = id;
  }, [
    acceptPoint,
    animateTruckTo,
    onArrival,
    onGpsMetrics,
    onTrackingChange,
    releaseWakeLock,
    requestWakeLock,
    sendTracking,
  ]);

  useEffect(() => {
    if (startSignal <= 0 || handledStartSignalRef.current === startSignal) return;
    handledStartSignalRef.current = startSignal;
    beginTracking();
  }, [startSignal, beginTracking]);

  useEffect(() => {
    if (handledResetSignalRef.current === resetSignal) return;
    handledResetSignalRef.current = resetSignal;
    distanceMetersRef.current = 0;
    movingMsRef.current = 0;
    stoppedMsRef.current = 0;
    lastMetricAtRef.current = null;
    trailRef.current?.setLatLngs([]);
    onGpsMetrics({ actualKm: 0, movingMinutes: 0, stoppedMinutes: 0 });
  }, [resetSignal, onGpsMetrics]);

  const changeMapStyle = (style: "streets" | "satellite") => {
    const map = mapRef.current;
    if (!map || style === mapStyle) return;
    baseLayerRef.current?.removeFrom(map);
    baseLayerRef.current = style === "streets"
      ? L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap",
          errorTileUrl: "/offline-map-tile.svg",
        })
      : L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: 19,
            attribution: "Imágenes &copy; Esri",
            errorTileUrl: "/offline-map-tile.svg",
          },
        );
    baseLayerRef.current.addTo(map).bringToBack();
    setMapStyle(style);
  };

  const centerRoute = () => {
    followRef.current = false;
    setFollow(false);
    if (!stops.length) return;
    mapRef.current?.fitBounds(
      L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.12),
    );
  };

  const centerTruck = () => {
    const point = truckRef.current?.getLatLng();
    if (!point || !mapRef.current) return;
    followRef.current = true;
    setFollow(true);
    mapRef.current.panTo(point, { animate: true, duration: 0.35 });
    setGpsMessage("Seguimiento automático reactivado");
  };

  const toggleTracking = () => {
    if (trackingRef.current) stopTracking();
    else beginTracking();
  };

  return (
    <div className="map-shell live-map-shell">
      <div className="map-toolbar">
        <div>
          <span className={`gps-pulse ${tracking ? "on" : ""}`} />
          <div>
            <strong>Mapa y seguimiento del camión</strong>
            <small>{gpsMessage}</small>
          </div>
        </div>
        <div className="map-buttons">
          <button className={tracking ? "tracking" : ""} onClick={toggleTracking}>
            {tracking ? "Detener GPS" : "Iniciar GPS"}
          </button>
          <button
            className={follow ? "tracking" : ""}
            onClick={centerTruck}
            disabled={!positionInfo}
          >
            {follow ? "Siguiendo camión" : "Seguir camión"}
          </button>
          <button onClick={centerRoute}>Ver ruta</button>
        </div>
      </div>

      <div className="map-style-switch" aria-label="Cambiar tipo de mapa">
        <button
          className={mapStyle === "streets" ? "active" : ""}
          onClick={() => changeMapStyle("streets")}
        >
          Calles de Chile
        </button>
        <button
          className={mapStyle === "satellite" ? "active" : ""}
          onClick={() => changeMapStyle("satellite")}
        >
          Vista satélite
        </button>
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=map&center=${stops[0]?.lat},${stops[0]?.lng}&zoom=16`}
          target="_blank"
          rel="noreferrer"
        >
          Abrir Google Maps ↗
        </a>
      </div>

      {pickLocationMode && (
        <div className="notice" role="status">
          Toca el mapa en la ubicación exacta de la casa nueva.
        </div>
      )}

      <div
        ref={mapElement}
        className="street-map"
        aria-label="Mapa con calles, paradas y ubicación del camión"
      />

      <div className="map-caption live-caption">
        <span>
          {mapStyle === "streets"
            ? "Calles reales de Chile · OpenStreetMap"
            : "Imágenes satelitales · Esri"}{" "}
          · {stops.length} paradas
        </span>
        <span>
          {positionInfo
            ? `${positionInfo.moving ? "En movimiento" : "Detenido"} · ${
                positionInfo.speed === null
                  ? "velocidad sin datos"
                  : `${Math.round(positionInfo.speed * 3.6)} km/h`
              } · precisión ${Math.round(positionInfo.accuracy)} m`
            : "Activa el GPS desde el teléfono del camión"}
        </span>
      </div>

      <p className="gps-privacy">
        GPS estabilizado: filtra movimientos falsos, conserva el zoom manual y solo vuelve a
        centrar cuando presionas “Seguir camión”.
      </p>
    </div>
  );
}

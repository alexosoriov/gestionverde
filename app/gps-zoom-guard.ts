import * as L from "leaflet";

declare global {
  interface Window {
    __rutaVerdeZoomGuardInstalled?: boolean;
    __rutaVerdeFirstGpsFixPending?: boolean;
    __rutaVerdeManualMapUntil?: number;
  }
}

type WatchSession = {
  nativeId: number | null;
  stopped: boolean;
  restartTimer: number | null;
  lastRawAt: number;
  lastAccepted: GeolocationPosition | null;
  consecutiveErrors: number;
  rejectedReadings: number;
};

const MAX_ACCEPTED_ACCURACY_METERS = 50;
const WATCH_STALE_RESTART_MS = 35_000;
const STATIONARY_SPEED_METERS_PER_SECOND = 0.8;
const MIN_STATIONARY_RADIUS_METERS = 7;
const MAX_STATIONARY_RADIUS_METERS = 18;
const MAX_REALISTIC_SPEED_METERS_PER_SECOND = 45;
const MAX_CONSECUTIVE_ERRORS = 3;
const MANUAL_MAP_CONTROL_MS = 60_000;

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isPlausiblePosition(
  position: GeolocationPosition,
  previous: GeolocationPosition | null,
) {
  if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)) {
    return false;
  }
  if (position.coords.accuracy <= 0 || position.coords.accuracy > MAX_ACCEPTED_ACCURACY_METERS) {
    return false;
  }
  if (!previous) return true;

  const elapsedSeconds = Math.max(0.5, (position.timestamp - previous.timestamp) / 1_000);
  const movement = distanceMeters(previous.coords, position.coords);
  const reportedSpeed = position.coords.speed;
  const calculatedSpeed = movement / elapsedSeconds;
  const uncertainty = previous.coords.accuracy + position.coords.accuracy;

  if (reportedSpeed !== null && reportedSpeed > MAX_REALISTIC_SPEED_METERS_PER_SECOND) {
    return false;
  }

  if (
    calculatedSpeed > MAX_REALISTIC_SPEED_METERS_PER_SECOND &&
    movement > Math.max(80, uncertainty * 2)
  ) {
    return false;
  }

  return true;
}

function stablePosition(
  position: GeolocationPosition,
  previous: GeolocationPosition | null,
): GeolocationPosition {
  if (!previous) return position;

  const speed = position.coords.speed;
  const movement = distanceMeters(previous.coords, position.coords);
  const stationaryRadius = Math.min(
    MAX_STATIONARY_RADIUS_METERS,
    Math.max(MIN_STATIONARY_RADIUS_METERS, position.coords.accuracy * 0.55),
  );
  const likelyStationary =
    (speed === null || speed <= STATIONARY_SPEED_METERS_PER_SECOND) &&
    movement <= stationaryRadius;

  if (!likelyStationary) return position;

  const stableValues = {
    latitude: previous.coords.latitude,
    longitude: previous.coords.longitude,
    accuracy: Math.min(previous.coords.accuracy, position.coords.accuracy),
    altitude: position.coords.altitude,
    altitudeAccuracy: position.coords.altitudeAccuracy,
    heading: previous.coords.heading ?? position.coords.heading,
    speed: 0,
  };

  return {
    timestamp: position.timestamp,
    coords: {
      ...stableValues,
      toJSON: () => ({ ...stableValues }),
    },
  };
}

if (typeof window !== "undefined" && !window.__rutaVerdeZoomGuardInstalled) {
  window.__rutaVerdeZoomGuardInstalled = true;
  window.__rutaVerdeManualMapUntil = 0;

  const geolocation = navigator.geolocation;
  if (geolocation) {
    const prototype = Object.getPrototypeOf(geolocation) as Geolocation;
    const originalWatchPosition = prototype.watchPosition;
    const originalClearWatch = prototype.clearWatch;
    const sessions = new Map<number, WatchSession>();
    let nextVirtualId = 1_000_000;

    prototype.watchPosition = function watchPosition(
      successCallback: PositionCallback,
      errorCallback?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) {
      window.__rutaVerdeFirstGpsFixPending = true;
      const virtualId = nextVirtualId++;
      const session: WatchSession = {
        nativeId: null,
        stopped: false,
        restartTimer: null,
        lastRawAt: Date.now(),
        lastAccepted: null,
        consecutiveErrors: 0,
        rejectedReadings: 0,
      };
      sessions.set(virtualId, session);

      const startNativeWatch = () => {
        if (session.stopped) return;
        if (session.nativeId !== null) originalClearWatch.call(this, session.nativeId);

        session.nativeId = originalWatchPosition.call(
          this,
          (rawPosition) => {
            session.lastRawAt = Date.now();
            session.consecutiveErrors = 0;

            if (!isPlausiblePosition(rawPosition, session.lastAccepted)) {
              session.rejectedReadings += 1;
              return;
            }

            session.rejectedReadings = 0;
            const position = stablePosition(rawPosition, session.lastAccepted);
            session.lastAccepted = position;
            successCallback(position);
          },
          (error) => {
            session.lastRawAt = Date.now();
            session.consecutiveErrors += 1;
            errorCallback?.(error);

            if (session.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              session.consecutiveErrors = 0;
              window.setTimeout(startNativeWatch, 1_500);
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: Math.min(options?.maximumAge ?? 1_000, 1_000),
            timeout: Math.min(options?.timeout ?? 15_000, 15_000),
          },
        );
      };

      startNativeWatch();
      session.restartTimer = window.setInterval(() => {
        if (session.stopped || document.visibilityState === "hidden") return;
        if (Date.now() - session.lastRawAt < WATCH_STALE_RESTART_MS) return;
        session.lastRawAt = Date.now();
        startNativeWatch();
      }, 5_000);

      return virtualId;
    };

    prototype.clearWatch = function clearWatch(watchId: number) {
      const session = sessions.get(watchId);
      if (!session) {
        originalClearWatch.call(this, watchId);
        return;
      }

      session.stopped = true;
      if (session.nativeId !== null) originalClearWatch.call(this, session.nativeId);
      if (session.restartTimer !== null) window.clearInterval(session.restartTimer);
      sessions.delete(watchId);
    };

    const restartVisibleSessions = () => {
      if (document.visibilityState !== "visible") return;
      for (const session of sessions.values()) {
        session.lastRawAt = Math.min(session.lastRawAt, Date.now() - WATCH_STALE_RESTART_MS);
      }
    };

    document.addEventListener("visibilitychange", restartVisibleSessions);
    window.addEventListener("online", restartVisibleSessions);
  }

  const markManualMapControl = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".leaflet-container")) return;
    window.__rutaVerdeManualMapUntil = Date.now() + MANUAL_MAP_CONTROL_MS;
  };

  document.addEventListener("pointerdown", markManualMapControl, true);
  document.addEventListener("touchstart", markManualMapControl, { capture: true, passive: true });
  document.addEventListener("wheel", markManualMapControl, { capture: true, passive: true });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    const text = button?.textContent?.toLowerCase() ?? "";
    if (text.includes("seguir camión") || text.includes("centrar camión")) {
      window.__rutaVerdeManualMapUntil = 0;
    }
  }, true);

  const originalSetView = L.Map.prototype.setView;
  L.Map.prototype.setView = function setView(
    center: L.LatLngExpression,
    zoom?: number,
    options?: L.ZoomPanOptions,
  ) {
    const manualControlActive = Date.now() < (window.__rutaVerdeManualMapUntil ?? 0);
    const firstGpsCenter = window.__rutaVerdeFirstGpsFixPending && options?.animate === false;
    if (firstGpsCenter) {
      window.__rutaVerdeFirstGpsFixPending = false;
      if (manualControlActive) return this;
      const requestedZoom = typeof zoom === "number" ? zoom : 16;
      const safeZoom = Math.min(16, Math.max(15, requestedZoom));
      return originalSetView.call(this, center, safeZoom, options);
    }
    return originalSetView.call(this, center, zoom, options);
  };

  const originalPanTo = L.Map.prototype.panTo;
  L.Map.prototype.panTo = function panTo(
    latlng: L.LatLngExpression,
    options?: L.PanOptions,
  ) {
    const manualControlActive = Date.now() < (window.__rutaVerdeManualMapUntil ?? 0);
    if (manualControlActive) return this;
    return originalPanTo.call(this, latlng, options);
  };
}

export {};

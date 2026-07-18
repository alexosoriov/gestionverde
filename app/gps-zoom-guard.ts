type NavigatorWithNativeBridge = Navigator & {
  gestionVerdeNative?: {
    startLocationUpdates?: () => void;
    stopLocationUpdates?: () => void;
  };
};

declare global {
  interface Window {
    __rutaVerdeZoomGuardInstalled?: boolean;
    __rutaVerdeManualMapUntil?: number;
  }
}

const MAX_ACCEPTED_ACCURACY_METERS = 80;
const MAX_STATIONARY_RADIUS_METERS = 18;
const MIN_STATIONARY_RADIUS_METERS = 5;
const STATIONARY_SPEED_METERS_PER_SECOND = 1.2;

function distanceMeters(
  a: Pick<GeolocationCoordinates, "latitude" | "longitude">,
  b: Pick<GeolocationCoordinates, "latitude" | "longitude">,
) {
  const radius = 6_371_000;
  const latitudeA = (a.latitude * Math.PI) / 180;
  const latitudeB = (b.latitude * Math.PI) / 180;
  const latitudeDelta = ((b.latitude - a.latitude) * Math.PI) / 180;
  const longitudeDelta = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function validPosition(position: GeolocationPosition, previous: GeolocationPosition | null) {
  const { accuracy, latitude, longitude } = position.coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0 ||
    accuracy > MAX_ACCEPTED_ACCURACY_METERS
  ) {
    return false;
  }

  if (!previous) return true;
  const movement = distanceMeters(previous.coords, position.coords);
  const uncertainty = Math.max(previous.coords.accuracy, position.coords.accuracy);
  const elapsedSeconds = Math.max(0.1, (position.timestamp - previous.timestamp) / 1_000);
  const impliedSpeed = movement / elapsedSeconds;

  if (
    elapsedSeconds < 8 &&
    impliedSpeed > 55 &&
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

  const stabilizedValues = {
    latitude: previous.coords.latitude,
    longitude: previous.coords.longitude,
    accuracy: Math.min(previous.coords.accuracy, position.coords.accuracy),
    altitude: position.coords.altitude,
    altitudeAccuracy: position.coords.altitudeAccuracy,
    heading: previous.coords.heading ?? position.coords.heading,
    speed: 0,
  };

  const coords: GeolocationCoordinates = {
    ...stabilizedValues,
    toJSON: () => ({ ...stabilizedValues }),
  };

  return {
    timestamp: position.timestamp,
    coords,
  };
}

if (typeof window !== "undefined" && !window.__rutaVerdeZoomGuardInstalled) {
  window.__rutaVerdeZoomGuardInstalled = true;
  window.__rutaVerdeManualMapUntil = 0;

  const geolocation = navigator.geolocation;
  if (geolocation) {
    const originalGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
    const originalWatchPosition = geolocation.watchPosition.bind(geolocation);
    let previousPosition: GeolocationPosition | null = null;

    const guardedSuccess = (success: PositionCallback): PositionCallback => (position) => {
      if (!validPosition(position, previousPosition)) return;
      const stable = stablePosition(position, previousPosition);
      previousPosition = stable;
      success(stable);
    };

    geolocation.getCurrentPosition = (success, error, options) =>
      originalGetCurrentPosition(guardedSuccess(success), error, options);

    geolocation.watchPosition = (success, error, options) =>
      originalWatchPosition(guardedSuccess(success), error, options);
  }

  const nativeBridge = (navigator as NavigatorWithNativeBridge).gestionVerdeNative;
  nativeBridge?.startLocationUpdates?.();
}

export {};

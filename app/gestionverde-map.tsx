"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "./route-data";
import { getRoadRoute } from "./road-route";
import { applyTruckAppearance, bearingBetween, truckIcon } from "./truck-marker";
import type { PositionSnapshot, StopRecord } from "./gestionverde-storage";

type Props = {
  stops: Stop[];
  records: Record<string, StopRecord>;
  activeStop?: Stop;
  tracking: boolean;
  initialPosition: PositionSnapshot | null;
  onPosition: (position: PositionSnapshot) => void;
  onArrival: (stop: Stop, distanceMeters: number) => void;
};

const ARRIVAL_METERS = 35;
const MAX_ACCURACY_METERS = 80;

export default function GestionVerdeMap({ stops, records, activeStop, tracking, initialPosition, onPosition, onArrival }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const stopLayerRef = useRef<L.LayerGroup | null>(null);
  const truckRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const watchRef = useRef<number | null>(null);
  const previousPointRef = useRef<L.LatLng | null>(null);
  const distanceMetersRef = useRef((initialPosition?.actualKm ?? 0) * 1000);
  const headingRef = useRef(initialPosition?.heading ?? 0);
  const arrivalRef = useRef<string | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const activeStopRef = useRef(activeStop);
  const onPositionRef = useRef(onPosition);
  const onArrivalRef = useRef(onArrival);
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");
  const [gpsLabel, setGpsLabel] = useState("GPS detenido");

  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { activeStopRef.current = activeStop; }, [activeStop]);
  useEffect(() => { onPositionRef.current = onPosition; }, [onPosition]);
  useEffect(() => { onArrivalRef.current = onArrival; }, [onArrival]);

  const tileLayer = useCallback((style: "streets" | "satellite") => {
    if (style === "satellite") {
      return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Imágenes &copy; Esri",
        errorTileUrl: "/offline-map-tile.svg",
      });
    }
    return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
      errorTileUrl: "/offline-map-tile.svg",
    });
  }, []);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, { zoomControl: true, preferCanvas: true });
    baseRef.current = tileLayer("streets").addTo(map);
    stopLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (stops.length) {
      map.fitBounds(L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as [number, number])).pad(0.16));
    }

    const stopFollow = () => setFollow(false);
    map.on("dragstart zoomstart", stopFollow);
    return () => {
      map.off("dragstart zoomstart", stopFollow);
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [stops, tileLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseRef.current?.removeFrom(map);
    baseRef.current = tileLayer(mapStyle).addTo(map).bringToBack();
  }, [mapStyle, tileLayer]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = stopLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    routeRef.current?.removeFrom(map);

    const controller = new AbortController();
    void getRoadRoute(stops, controller.signal).then((points) => {
      if (!points.length || controller.signal.aborted || !mapRef.current) return;
      routeRef.current = L.polyline(points, {
        color: "#1f7aff",
        weight: 7,
        opacity: 0.92,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(mapRef.current).bringToBack();
    }).catch(() => {
      if (!mapRef.current || stops.length < 2) return;
      routeRef.current = L.polyline(stops.map((stop) => [stop.lat, stop.lng] as [number, number]), {
        color: "#1f7aff",
        weight: 6,
        opacity: 0.72,
        dashArray: "12 8",
      }).addTo(mapRef.current).bringToBack();
    });

    stops.forEach((stop, index) => {
      const status = records[stop.id]?.status ?? "pending";
      const active = stop.id === activeStop?.id;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "gv-map-marker-wrap",
          html: `<div class="gv-map-marker ${status} ${active ? "active" : ""}"><span>${active ? "➤" : index + 1}</span></div>`,
          iconSize: active ? [44, 44] : [34, 34],
          iconAnchor: active ? [22, 22] : [17, 17],
        }),
      }).addTo(layer);
      marker.bindTooltip(`${index + 1}. ${stop.address ?? stop.name}`, { direction: "top", offset: [0, -15] });
      marker.on("click", () => {
        setFollow(false);
        map.flyTo([stop.lat, stop.lng], Math.max(17, map.getZoom()));
      });
    });

    return () => controller.abort();
  }, [stops, records, activeStop]);

  useEffect(() => {
    arrivalRef.current = null;
  }, [activeStop?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tracking) return;
    if (!navigator.geolocation) {
      setGpsLabel("GPS no disponible");
      return;
    }

    setGpsLabel("Buscando señal GPS…");
    watchRef.current = navigator.geolocation.watchPosition(({ coords, timestamp }) => {
      if (coords.accuracy > MAX_ACCURACY_METERS) {
        setGpsLabel(`Señal débil · precisión ${Math.round(coords.accuracy)} m`);
        return;
      }
      const point = L.latLng(coords.latitude, coords.longitude);
      const previous = previousPointRef.current;
      const stepMeters = previous ? previous.distanceTo(point) : 0;
      if (previous && stepMeters >= 4 && stepMeters <= 300) distanceMetersRef.current += stepMeters;

      const calculatedHeading = previous && stepMeters >= 5 ? bearingBetween(previous, point) : headingRef.current;
      const heading = Number.isFinite(coords.heading) && coords.heading !== null ? coords.heading : calculatedHeading;
      headingRef.current = heading;
      const speedKmh = Math.max(0, (coords.speed ?? 0) * 3.6);
      const moving = speedKmh >= 2 || stepMeters >= 5;

      if (!truckRef.current) {
        truckRef.current = L.marker(point, { icon: truckIcon(heading, moving), zIndexOffset: 1500 }).addTo(map);
        truckRef.current.bindTooltip("🚛 Camión de GestiónVerde", { direction: "top", offset: [0, -28] });
        accuracyRef.current = L.circle(point, {
          radius: coords.accuracy,
          color: "#1f7aff",
          fillColor: "#1f7aff",
          fillOpacity: 0.08,
          weight: 1,
        }).addTo(map);
      } else {
        headingRef.current = applyTruckAppearance(truckRef.current, heading, moving, headingRef.current);
        truckRef.current.setLatLng(point);
        accuracyRef.current?.setLatLng(point).setRadius(coords.accuracy);
      }

      if (followRef.current) map.flyTo(point, Math.max(17, map.getZoom()), { animate: true, duration: 0.65 });
      previousPointRef.current = point;
      setGpsLabel(`${moving ? "En movimiento" : "Detenido"} · ${speedKmh.toFixed(0)} km/h · ±${Math.round(coords.accuracy)} m`);

      const position: PositionSnapshot = {
        lat: point.lat,
        lng: point.lng,
        accuracy: coords.accuracy,
        speedKmh,
        heading,
        actualKm: Math.round((distanceMetersRef.current / 1000) * 1000) / 1000,
        updatedAt: timestamp,
      };
      onPositionRef.current(position);

      const destination = activeStopRef.current;
      if (destination && arrivalRef.current !== destination.id) {
        const meters = point.distanceTo([destination.lat, destination.lng]);
        if (meters <= ARRIVAL_METERS && speedKmh <= 20) {
          arrivalRef.current = destination.id;
          onArrivalRef.current(destination, Math.round(meters));
        }
      }
    }, () => setGpsLabel("Sin señal GPS · revisa permisos"), {
      enableHighAccuracy: true,
      maximumAge: 3_000,
      timeout: 15_000,
    });

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setGpsLabel("GPS pausado");
    };
  }, [tracking]);

  const recenter = () => {
    setFollow(true);
    const map = mapRef.current;
    const truck = truckRef.current;
    if (map && truck) map.flyTo(truck.getLatLng(), Math.max(17, map.getZoom()));
  };

  return (
    <div className="gv-map-card">
      <div className="gv-map-toolbar">
        <div className="gv-map-segmented">
          <button className={mapStyle === "streets" ? "active" : ""} onClick={() => setMapStyle("streets")}>Calles</button>
          <button className={mapStyle === "satellite" ? "active" : ""} onClick={() => setMapStyle("satellite")}>Satélite</button>
        </div>
        <button className={follow ? "gv-follow active" : "gv-follow"} onClick={recenter}>◎ Seguir camión</button>
      </div>
      <div ref={elementRef} className="gv-map" aria-label="Mapa operativo de GestiónVerde" />
      <div className="gv-map-status"><span className={tracking ? "live" : ""} />{gpsLabel}</div>
    </div>
  );
}

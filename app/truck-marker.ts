import * as L from "leaflet";

export function normalizeHeading(heading: number) {
  return ((heading % 360) + 360) % 360;
}

export function nearestHeading(current: number, next: number) {
  const delta = ((normalizeHeading(next) - normalizeHeading(current) + 540) % 360) - 180;
  return current + delta;
}

export function bearingBetween(from: L.LatLng, to: L.LatLng) {
  const a1 = (from.lat * Math.PI) / 180;
  const a2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(a2);
  const x = Math.cos(a1) * Math.sin(a2) - Math.sin(a1) * Math.cos(a2) * Math.cos(dLng);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function visualHeading(heading: number) {
  // El emoji 🚛 apunta hacia la izquierda de forma nativa. El desfase de 90°
  // hace que el frente del camión coincida con el rumbo real del GPS.
  return heading + 90;
}

export function truckIcon(heading: number, moving: boolean) {
  return L.divIcon({
    className: "truck-marker-wrap",
    html: `<div class="truck-heading ${moving ? "is-moving" : "is-stopped"}" style="--truck-heading:${visualHeading(heading)}deg">
      <span class="truck-motion-ring" style="inset:7px 3px 13px;border-color:rgba(36,134,255,.48)"></span>
      <span
        class="truck-vehicle"
        role="img"
        aria-label="Camión de reciclaje"
        style="inset:7px 3px auto;width:52px;height:52px;display:grid;place-items:center;border:4px solid #fff;border-radius:50%;background:linear-gradient(145deg,#48a8ff,#176fd1);box-shadow:0 7px 18px rgba(14,83,159,.38);font-size:29px;line-height:1"
      >🚛</span>
      <span class="truck-direction" aria-hidden="true" style="top:-5px"></span>
    </div>`,
    iconSize: [58, 72],
    iconAnchor: [29, 40],
  });
}

export function applyTruckAppearance(
  marker: L.Marker,
  heading: number,
  moving: boolean,
  currentHeading: number,
) {
  const renderedHeading = nearestHeading(currentHeading, heading);
  const truck = marker.getElement()?.querySelector<HTMLElement>(".truck-heading");
  if (truck) {
    truck.style.setProperty("--truck-heading", `${visualHeading(renderedHeading)}deg`);
    truck.classList.toggle("is-moving", moving);
    truck.classList.toggle("is-stopped", !moving);
  } else {
    marker.setIcon(truckIcon(renderedHeading, moving));
  }
  marker.setTooltipContent(moving ? "🚛 Camión en movimiento" : "🚛 Camión detenido");
  return renderedHeading;
}

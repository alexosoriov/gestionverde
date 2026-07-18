import type { Stop } from "./route-data";

// Datos de demostración sin información personal ni direcciones reales.
// El recorrido productivo debe cargarse desde una fuente privada (Firestore/API)
// para no publicar información de viviendas en este repositorio público.
const STREET_NAMES = [
  "Los Alerces",
  "Los Pimientos",
  "Nueva Oriente",
  "Manquecura",
  "Chincolef",
  "Huechumán",
  "Painemilla",
  "Curamil",
  "Choshuenco",
  "Lepihue",
  "Arquén",
];

export const ROUTE_STOPS: Stop[] = Array.from({ length: 44 }, (_, index) => {
  const row = Math.floor(index / 11);
  const column = index % 11;
  const wave = Math.sin(index * 0.72) * 0.00022;
  return {
    id: `gv-${String(index + 1).padStart(3, "0")}`,
    name: `Vivienda ${String(index + 1).padStart(2, "0")}`,
    address: `${STREET_NAMES[column]} · punto ${String(index + 1).padStart(2, "0")}`,
    day: "Viernes",
    lat: -41.4597 - row * 0.00105 - column * 0.00008 + wave,
    lng: -72.8971 - column * 0.00064 - row * 0.00018 + Math.cos(index * 0.61) * 0.00018,
    km: Math.round(index * 0.112 * 1000) / 1000,
  };
});

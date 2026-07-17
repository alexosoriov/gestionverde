export type RouteStop = {
  id: string;
  order: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  status: "pending" | "completed" | "absent";
  notes?: string;
  photoUrl?: string;
};

// Fuente temporal limpia. Luego puede reemplazarse por Firestore sin cambiar la UI.
export const ROUTE_STOPS: RouteStop[] = [
  {
    id: "gv-001",
    order: 1,
    name: "Vivienda 1",
    address: "Calle Los Alerces 245",
    lat: -41.4693,
    lng: -72.9424,
    status: "pending",
  },
  {
    id: "gv-002",
    order: 2,
    name: "Vivienda 2",
    address: "Calle Los Olmos 310",
    lat: -41.4701,
    lng: -72.9441,
    status: "pending",
  },
  {
    id: "gv-003",
    order: 3,
    name: "Vivienda 3",
    address: "Calle El Roble 118",
    lat: -41.4682,
    lng: -72.9409,
    status: "pending",
  },
];

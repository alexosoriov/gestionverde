// Puente de compatibilidad: el bloque cifrado real vive en una carpeta separada.
// Mantener este módulo evita modificar el mapa y el flujo del Worker.
export { decryptPrivateRoute } from "./vault/sector-map";

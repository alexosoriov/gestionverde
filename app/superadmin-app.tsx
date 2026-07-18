"use client";

import GestionVerdeApp from "./gestionverde-app";
import GestionVerdeRouteManager from "./gestionverde-route-manager";

export default function SuperadminApp() {
  return (
    <>
      <GestionVerdeRouteManager />
      <GestionVerdeApp role="superadmin" />
    </>
  );
}

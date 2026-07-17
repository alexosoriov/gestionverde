"use client";

import GestionVerdeApp from "./gestionverde-app";
import SuperadminConsole from "./superadmin-console";
import SuperadminRouteManager from "./superadmin-route-manager";

export default function SuperadminApp() {
  return (
    <>
      <SuperadminConsole />
      <SuperadminRouteManager />
      <GestionVerdeApp role="superadmin" />
    </>
  );
}

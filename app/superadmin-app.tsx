"use client";

import RouteApp from "./route-app";
import SuperadminConsole from "./superadmin-console";
import SuperadminRouteManager from "./superadmin-route-manager";

export default function SuperadminApp() {
  return (
    <>
      <SuperadminConsole />
      <SuperadminRouteManager />
      <RouteApp />
    </>
  );
}

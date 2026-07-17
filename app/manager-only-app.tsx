"use client";

import Image from "next/image";
import AppInstall from "./app-install";
import ManagerPanel, { type LocalSummary } from "./manager-panel";
import OfflineSupport from "./offline-support";
import { STOPS } from "./route-data";
import { EMPTY_GPS_METRICS } from "./tracking-types";

const EMPTY_MANAGER_SUMMARY: LocalSummary = {
  total: STOPS.length,
  done: 0,
  absent: 0,
  pending: STOPS.length,
  nextStop: null,
  startedAt: null,
  kilos: 0,
  estimatedMinutes: 0,
  routeKm: 0,
  baselineRouteKm: 0,
  routeSavingsKm: 0,
  plannedDriveMinutes: 0,
  gpsMetrics: EMPTY_GPS_METRICS,
  activity: [],
  presentationMode: false,
};

export default function ManagerOnlyApp() {
  return (
    <main>
      <OfflineSupport />
      <header className="topbar">
        <Image className="brand-mark" src="/icon-192.png" width={45} height={45} alt="Logo Ruta Verde" priority unoptimized />
        <div className="brand-copy"><span>Supervisión protegida</span><strong>Ruta Verde · Jefatura</strong></div>
        <div className="header-actions"><AppInstall /><div className="header-date"><span>Seguimiento en vivo</span><strong>{STOPS.length} casas</strong></div></div>
      </header>

      <nav className="app-tabs" aria-label="Vista autorizada">
        <button className="active" type="button" disabled>Jefatura · seguimiento</button>
      </nav>

      <ManagerPanel localSummary={EMPTY_MANAGER_SUMMARY} />
    </main>
  );
}

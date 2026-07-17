"use client";

import { useEffect, useState } from "react";
import "./map-camera-guard";
import RouteApp from "./route-app";
import StageOneTools from "./stage-one-tools";
import { initializeRouteCorrections } from "./route-corrections";

export default function DriverApp() {
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [routeReady, setRouteReady] = useState(false);
  const [routeVersion, setRouteVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void initializeRouteCorrections().finally(() => {
      if (active) setRouteReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(clock);
    };
  }, []);

  return (
    <>
      <div className="driver-status-bar" role="status" aria-live="polite">
        <div className="driver-brand">
          <span className="driver-truck">🚛</span>
          <span><strong>Ruta Verde</strong><small>Recorrido en terreno · versión 1.0</small></span>
        </div>
        <div className="driver-live-status">
          <span className="status-pill gps-controlled"><i />GPS y navegación</span>
          <span className={`status-pill ${online ? "good" : "warning"}`}><i />{online ? "En línea" : "Modo sin conexión"}</span>
          <span className="driver-time">{new Date(now).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      <style jsx global>{`
        .driver-status-bar {
          position: sticky;
          top: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          background: rgba(9, 31, 24, .96);
          color: #fff;
          box-shadow: 0 8px 26px rgba(0,0,0,.16);
          backdrop-filter: blur(12px);
        }
        .driver-brand, .driver-live-status { display: flex; align-items: center; gap: 10px; }
        .driver-brand span:last-child { display: grid; line-height: 1.05; }
        .driver-brand small { margin-top: 4px; color: rgba(255,255,255,.68); font-size: 11px; }
        .driver-truck { font-size: 25px; filter: drop-shadow(0 4px 6px rgba(0,0,0,.3)); }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 34px;
          padding: 0 11px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          background: rgba(255,255,255,.1);
          white-space: nowrap;
        }
        .status-pill i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px rgba(255,255,255,.08); }
        .status-pill.good { color: #70f0a8; }
        .status-pill.warning { color: #ffd166; }
        .status-pill.gps-controlled { color: #9fd3ff; }
        .driver-time { font-size: 13px; font-weight: 800; color: rgba(255,255,255,.78); }
        .route-preload {
          min-height: 70vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #eef3ef;
          color: #214d3e;
          font-size: 14px;
          font-weight: 900;
          text-align: center;
        }

        .app-tabs button:nth-child(2),
        .hero-actions > button,
        .presentation-bar { display: none !important; }
        .workspace { grid-template-columns: minmax(0, 1fr) 390px; }
        .next-card { position: sticky; top: 70px; border-radius: 22px !important; box-shadow: 0 16px 42px rgba(20, 52, 41, .14) !important; }
        .primary-action, .complete-action, .absent-action, .map-buttons button {
          min-height: 54px !important;
          font-size: 14px !important;
          border-radius: 14px !important;
        }
        .complete-action { font-weight: 900 !important; }
        .street-map { border-radius: 22px !important; overflow: hidden; box-shadow: 0 18px 45px rgba(20, 52, 41, .16); }

        @media (max-width: 900px) {
          .driver-status-bar { align-items: flex-start; padding: 9px 10px; }
          .driver-live-status { gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
          .driver-time { display: none; }
          .status-pill { min-height: 30px; padding: 0 9px; font-size: 10px; }
          .driver-brand small { display: none; }
          .hero, .workflow-strip, .stats-row, .route-list-section, .tools-panel { display: none !important; }
          .workspace { width: 100%; grid-template-columns: 1fr; gap: 10px; padding: 10px; }
          .map-column { order: 2; }
          .next-card { order: 1; position: static; padding: 18px; border-radius: 20px !important; }
          .street-map { height: 58vh; min-height: 390px; }
          .quick-settings, .segment-box, .next-card > div[style*="grid"] { display: none !important; }
          .next-card h2 { font-size: 29px; line-height: 1.05; }
          .next-card p { font-size: 13px; }
        }
      `}</style>

      {routeReady ? (
        <>
          <StageOneTools onRouteChanged={() => setRouteVersion((value) => value + 1)} />
          <RouteApp key={routeVersion} />
        </>
      ) : (
        <div className="route-preload">Aplicando correcciones seguras y preparando Ruta Verde 1.0…</div>
      )}
    </>
  );
}

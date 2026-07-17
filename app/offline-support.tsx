"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export default function OfflineSupport() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, []);

  return <div className={`network-status ${online ? "online" : "offline"}`} role="status">
    <span />{online
      ? (ready ? "En línea · respaldo offline preparado" : "En línea")
      : "Sin internet · viviendas, avance y última ruta disponibles"}
  </div>;
}

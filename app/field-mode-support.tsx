"use client";

import { useEffect, useState } from "react";

const FIELD_STYLE = `
  .network-status{font-size:12px!important;min-height:42px!important;padding:10px 14px!important}
  .map-toolbar strong,.next-card h2,.stop-main strong{font-size:16px!important;line-height:1.25!important}
  .map-toolbar small,.next-card p,.stop-main span,.map-caption,.gps-privacy,.notice{font-size:13px!important;line-height:1.5!important}
  .map-buttons button,.map-style-switch button,.map-style-switch a,.primary-action,.complete-action,.absent-action,.quick-settings button,.quick-settings select,.row-nav,.row-actions button,.filters button,.export-button,.add-stop-form button,.app-tabs button{min-height:48px!important;font-size:13px!important;font-weight:850!important}
  .primary-action,.complete-action,.absent-action{display:flex!important;align-items:center!important;justify-content:center!important}
  .stop-row{min-height:72px!important}
  .status-pill{font-size:12px!important;padding:8px 11px!important}
  .stop-detail label,.add-stop-form label{font-size:12px!important}
  .stop-detail input,.stop-detail select,.stop-detail textarea,.add-stop-form input,.add-stop-form select,.add-stop-form textarea{min-height:48px!important;font-size:15px!important}
  .manager-kpi-grid span,.manager-operational-metrics span,.manager-next span,.activity-row small,.activity-row time{font-size:12px!important}
  .manager-kpi-grid small,.manager-note,.empty-tracking p{font-size:13px!important}
  .activity-row strong{font-size:13px!important}
  .field-status-guide{position:fixed;left:50%;bottom:max(66px,calc(env(safe-area-inset-bottom) + 54px));z-index:2300;transform:translateX(-50%);width:min(680px,calc(100% - 24px));display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-radius:16px;background:#fff7dc;color:#4d3d12;border:1px solid #e6ca69;box-shadow:0 14px 40px rgba(45,38,12,.24);font-size:14px;font-weight:780;line-height:1.4}
  .field-status-guide button{flex:0 0 auto;min-width:44px;min-height:44px;border:0;border-radius:11px;background:#173e33;color:white;font-size:20px;cursor:pointer}
  .field-status-guide.warning{background:#ffe6dd;border-color:#df896c;color:#6d2718}
  .field-status-guide.success{background:#e4f7e9;border-color:#76bd89;color:#174e27}
  @media(max-width:640px){
    .map-toolbar strong,.next-card h2,.stop-main strong{font-size:17px!important}
    .map-toolbar small,.next-card p,.stop-main span,.map-caption,.gps-privacy,.notice{font-size:14px!important}
    .map-buttons button,.map-style-switch button,.map-style-switch a,.primary-action,.complete-action,.absent-action,.quick-settings button,.quick-settings select,.row-nav,.row-actions button,.filters button,.app-tabs button{min-height:54px!important;font-size:15px!important}
    .field-status-guide{align-items:flex-start;font-size:14px}
  }
`;

type GuideTone = "normal" | "warning" | "success";

export default function FieldModeSupport() {
  const [message, setMessage] = useState("Para mantener el GPS estable, deja Ruta Verde visible y desactiva el ahorro de batería durante el recorrido.");
  const [tone, setTone] = useState<GuideTone>("normal");
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.fieldMode = "enabled";
    const initialTimer = window.setTimeout(() => setVisible(false), 12_000);
    void navigator.storage?.persist?.().catch(() => false);

    let hiddenAt: number | null = null;
    let timer: number | null = null;
    const showTemporary = (nextMessage: string, nextTone: GuideTone, duration = 15_000) => {
      setMessage(nextMessage);
      setTone(nextTone);
      setVisible(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), duration);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenAt || Date.now() - hiddenAt < 4_000) return;
      showTemporary("Ruta Verde volvió desde segundo plano. Confirma que el camión o punto GPS siga moviéndose antes de continuar.", "warning");
      hiddenAt = null;
    };

    const handleOffline = () => showTemporary("Sin internet: la jornada seguirá guardándose cifrada en este teléfono y se sincronizará al recuperar señal.", "warning");
    const handleOnline = () => showTemporary("Internet recuperado. Ruta Verde está sincronizando los cambios pendientes.", "success", 10_000);

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearTimeout(initialTimer);
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      delete document.documentElement.dataset.fieldMode;
    };
  }, []);

  useEffect(() => {
    try {
      const mergeNotice = sessionStorage.getItem("ruta-verde-merge-notice");
      if (!mergeNotice) return;
      sessionStorage.removeItem("ruta-verde-merge-notice");
      const timer = window.setTimeout(() => {
        setMessage(mergeNotice);
        setTone("success");
        setVisible(true);
      }, 0);
      const hideTimer = window.setTimeout(() => setVisible(false), 12_000);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(hideTimer);
      };
    } catch {}
  }, []);

  return <>
    <style>{FIELD_STYLE}</style>
    {visible && <div className={`field-status-guide ${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={() => setVisible(false)}>×</button>
    </div>}
  </>;
}

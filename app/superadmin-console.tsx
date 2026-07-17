"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Panel = "stats" | "voice" | "planner" | null;
type Day = "Lunes" | "Martes" | "Miércoles" | "Jueves" | "Viernes";
type Plan = { name: string; driver: string; vehicle: string; startTime: string; notes: string };
type WeeklyPlan = Record<Day, Plan>;

const DAYS: Day[] = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const STORAGE_KEY = "ruta-verde-weekly-plan-safe-v1";

function defaultPlan(): WeeklyPlan {
  return {
    Lunes: { name: "Recorrido lunes", driver: "", vehicle: "Camión", startTime: "09:00", notes: "" },
    Martes: { name: "Recorrido martes", driver: "", vehicle: "Camión", startTime: "09:00", notes: "" },
    Miércoles: { name: "Recorrido miércoles", driver: "", vehicle: "Camión", startTime: "09:00", notes: "" },
    Jueves: { name: "Recorrido jueves", driver: "", vehicle: "Camión", startTime: "09:00", notes: "" },
    Viernes: { name: "Santuario", driver: "", vehicle: "Camión", startTime: "09:00", notes: "" },
  };
}

function speak(text: string) {
  if (!("speechSynthesis" in window) || !text.trim()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-CL";
  utterance.rate = 0.96;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export default function SuperadminConsole() {
  const [panel, setPanel] = useState<Panel>(null);
  const [counts, setCounts] = useState({ done: 0, absent: 0, pending: 0, total: 0 });
  const [nextStop, setNextStop] = useState("Esperando recorrido");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Day>("Viernes");
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(defaultPlan);
  const [saved, setSaved] = useState(false);
  const lastSpokenRef = useRef("");

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as WeeklyPlan | null;
      if (stored) setWeeklyPlan(stored);
    } catch {}
  }, []);

  useEffect(() => {
    const refresh = () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".stop-row"));
      const next = document.querySelector<HTMLElement>(".next-card h2")?.textContent?.trim();
      const nextCounts = {
        done: rows.filter((row) => row.classList.contains("done")).length,
        absent: rows.filter((row) => row.classList.contains("absent")).length,
        pending: rows.filter((row) => row.classList.contains("pending")).length,
        total: rows.length,
      };
      setCounts((current) => JSON.stringify(current) === JSON.stringify(nextCounts) ? current : nextCounts);
      if (next) setNextStop((current) => current === next ? current : next);
    };

    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!voiceEnabled || !nextStop || nextStop === "Esperando recorrido" || lastSpokenRef.current === nextStop) return;
    lastSpokenRef.current = nextStop;
    speak(`La siguiente vivienda es ${nextStop}`);
  }, [nextStop, voiceEnabled]);

  const reviewed = counts.done + counts.absent;
  const progress = Math.round((reviewed / Math.max(1, counts.total)) * 100);

  const statCards = useMemo(() => [
    { label: "Realizadas", value: counts.done },
    { label: "Ausentes", value: counts.absent },
    { label: "Pendientes", value: counts.pending },
    { label: "Avance", value: `${progress}%` },
  ], [counts, progress]);

  const openManager = () => {
    const managerButton = document.querySelectorAll<HTMLButtonElement>(".app-tabs button")[1];
    managerButton?.click();
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 80);
  };

  const savePlan = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weeklyPlan));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2_000);
  };

  const updatePlan = (field: keyof Plan, value: string) => {
    setWeeklyPlan((current) => ({
      ...current,
      [selectedDay]: { ...current[selectedDay], [field]: value },
    }));
  };

  return (
    <section className="superadmin-console" aria-label="Herramientas de administración">
      <div className="superadmin-console-main">
        <div className="superadmin-console-title">
          <span>Centro de control</span>
          <strong>Ruta Verde · Administración</strong>
        </div>
        <div className="superadmin-console-actions">
          <button onClick={() => setPanel(panel === "stats" ? null : "stats")}>📊 Resumen</button>
          <button onClick={openManager}>👨‍💼 Jefatura</button>
          <button onClick={() => setPanel(panel === "voice" ? null : "voice")}>🔊 Voz</button>
          <button onClick={() => setPanel(panel === "planner" ? null : "planner")}>📅 Plan semanal</button>
        </div>
      </div>

      <div className="superadmin-next-line">
        <span>Próxima vivienda</span>
        <strong>{nextStop}</strong>
        <small>{progress}% completado</small>
      </div>

      {panel === "stats" && (
        <div className="superadmin-panel">
          <div className="superadmin-panel-head"><div><small>Recorrido actual</small><h2>Resumen operativo</h2></div><button onClick={() => setPanel(null)}>×</button></div>
          <div className="superadmin-stat-grid">{statCards.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
          <div className="superadmin-progress"><i style={{ width: `${progress}%` }} /></div>
          <p>{reviewed} de {counts.total || 0} viviendas revisadas. Estos datos se leen desde el recorrido actual sin modificar el GPS ni las paradas.</p>
        </div>
      )}

      {panel === "voice" && (
        <div className="superadmin-panel">
          <div className="superadmin-panel-head"><div><small>Asistente seguro</small><h2>Avisos por voz</h2></div><button onClick={() => setPanel(null)}>×</button></div>
          <div className="superadmin-voice-card"><span>Siguiente dirección</span><strong>{nextStop}</strong><p>La voz anuncia la próxima vivienda cuando cambia. No interviene el GPS ni mueve el mapa.</p></div>
          <div className="superadmin-panel-buttons"><button className={voiceEnabled ? "active" : ""} onClick={() => { setVoiceEnabled((value) => !value); if (!voiceEnabled) speak(`Voz activada. La siguiente vivienda es ${nextStop}`); }}>{voiceEnabled ? "Desactivar voz" : "Activar voz"}</button><button onClick={() => speak(`La siguiente vivienda es ${nextStop}`)}>Repetir dirección</button></div>
        </div>
      )}

      {panel === "planner" && (
        <div className="superadmin-panel">
          <div className="superadmin-panel-head"><div><small>Organización</small><h2>Plan semanal</h2></div><button onClick={() => setPanel(null)}>×</button></div>
          <div className="superadmin-day-tabs">{DAYS.map((day) => <button key={day} className={selectedDay === day ? "active" : ""} onClick={() => setSelectedDay(day)}>{day.slice(0, 3)}</button>)}</div>
          <div className="superadmin-form">
            <label>Nombre del recorrido<input value={weeklyPlan[selectedDay].name} onChange={(event) => updatePlan("name", event.target.value)} /></label>
            <label>Conductor<input value={weeklyPlan[selectedDay].driver} onChange={(event) => updatePlan("driver", event.target.value)} placeholder="Nombre del responsable" /></label>
            <label>Vehículo<select value={weeklyPlan[selectedDay].vehicle} onChange={(event) => updatePlan("vehicle", event.target.value)}><option>Camión</option><option>Camioneta</option><option>Auto</option><option>Bicicleta</option></select></label>
            <label>Hora de salida<input type="time" value={weeklyPlan[selectedDay].startTime} onChange={(event) => updatePlan("startTime", event.target.value)} /></label>
            <label className="wide">Observaciones<input value={weeklyPlan[selectedDay].notes} onChange={(event) => updatePlan("notes", event.target.value)} placeholder="Sector, restricciones, reemplazos…" /></label>
          </div>
          <button className="superadmin-save" onClick={savePlan}>{saved ? "✓ Plan guardado" : "Guardar planificación"}</button>
          <p>Este plan solo organiza la semana. No cambia las viviendas ni el recorrido activo hasta que esa función sea probada por separado.</p>
        </div>
      )}

      <style jsx global>{`
        .superadmin-console{position:sticky;top:40px;z-index:9200;background:#edf4ef;border-bottom:1px solid #d1ddd5;box-shadow:0 8px 22px rgba(19,59,45,.11)}
        .superadmin-console-main{max-width:1500px;margin:auto;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px}.superadmin-console-title{display:grid}.superadmin-console-title span{font-size:10px;font-weight:900;text-transform:uppercase;color:#647a71}.superadmin-console-title strong{font-size:15px;color:#173f33}.superadmin-console-actions{display:flex;gap:7px;flex-wrap:wrap}.superadmin-console-actions button,.superadmin-panel-buttons button,.superadmin-day-tabs button{border:1px solid #cad8cf;background:#fff;color:#285044;border-radius:11px;min-height:38px;padding:0 12px;font-weight:850;font-size:12px}.superadmin-console-actions button:hover{background:#f8fbf9}.superadmin-next-line{max-width:1500px;margin:auto;padding:8px 16px 10px;border-top:1px solid #d9e3dc;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.superadmin-next-line span,.superadmin-next-line small{font-size:10px;font-weight:850;color:#647970}.superadmin-next-line strong{font-size:13px;color:#173f33;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.superadmin-next-line small{background:#fff;border-radius:999px;padding:6px 9px}.superadmin-panel{max-width:1100px;margin:0 auto 12px;padding:18px;background:#fff;border:1px solid #d1ddd5;border-radius:17px;box-shadow:0 18px 50px rgba(18,57,43,.17)}.superadmin-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.superadmin-panel-head small{font-size:10px;font-weight:900;text-transform:uppercase;color:#6b8077}.superadmin-panel-head h2{margin:2px 0 0;color:#173f33;font-size:22px}.superadmin-panel-head>button{width:34px;height:34px;border:0;border-radius:50%;background:#eaf0ec;color:#35584c;font-size:22px}.superadmin-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.superadmin-stat-grid article{padding:14px;border:1px solid #dbe5df;border-radius:13px;background:#f8faf8;display:grid;gap:4px}.superadmin-stat-grid span{font-size:10px;text-transform:uppercase;font-weight:850;color:#6a7c75}.superadmin-stat-grid strong{font-size:25px;color:#173f33}.superadmin-progress{height:9px;margin:13px 0;border-radius:999px;background:#e5ede8;overflow:hidden}.superadmin-progress i{display:block;height:100%;background:#2f8a66;border-radius:inherit}.superadmin-panel p{margin:8px 0 0;color:#60746c;font-size:12px}.superadmin-voice-card{padding:17px;border-radius:14px;background:#173f33;color:#fff;display:grid;gap:5px}.superadmin-voice-card span{font-size:10px;text-transform:uppercase;color:#a7d8c4}.superadmin-voice-card strong{font-size:24px}.superadmin-voice-card p{color:#d7e8e1}.superadmin-panel-buttons{display:flex;gap:8px;margin-top:11px}.superadmin-panel-buttons button{flex:1}.superadmin-panel-buttons button.active{background:#173f33;color:#fff}.superadmin-day-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.superadmin-day-tabs button.active{background:#173f33;color:#fff}.superadmin-form{display:grid;grid-template-columns:1.4fr 1.1fr .8fr .7fr;gap:9px;margin-top:12px}.superadmin-form label{display:grid;gap:4px;font-size:10px;text-transform:uppercase;font-weight:850;color:#60766d}.superadmin-form label.wide{grid-column:1/-1}.superadmin-form input,.superadmin-form select{min-height:42px;border:1px solid #ccd9d1;border-radius:10px;padding:0 10px;background:#fff;color:#173f33}.superadmin-save{width:100%;min-height:46px;margin-top:11px;border:0;border-radius:11px;background:#1f7657;color:#fff;font-weight:900}
        @media(max-width:900px){.superadmin-console{top:40px}.superadmin-console-main{align-items:flex-start;padding:9px 10px}.superadmin-console-title strong{font-size:13px}.superadmin-console-actions{justify-content:flex-end}.superadmin-console-actions button{min-height:34px;padding:0 9px;font-size:10px}.superadmin-next-line{padding:7px 10px 9px}.superadmin-panel{margin:0 8px 10px;padding:15px}.superadmin-stat-grid{grid-template-columns:repeat(2,1fr)}.superadmin-form{grid-template-columns:1fr 1fr}.superadmin-form label.wide{grid-column:1/-1}.superadmin-panel-buttons{flex-direction:column}}
      `}</style>
    </section>
  );
}

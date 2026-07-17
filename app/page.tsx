"use client";

import { useCallback, useEffect, useState, type ComponentType, type FormEvent } from "react";
import Image from "next/image";
import { clearRouteData, installRouteData } from "./route-data";
import { ROUTE_STOPS } from "./route-stops";
import { migrateLegacyBrowserStorage } from "./local-security-migration";

type Phase = "checking" | "login" | "loading" | "ready" | "error";
type UserRole = "driver" | "manager" | "superadmin";

const ROLE_LABELS: Record<UserRole, string> = {
  driver: "Conductor",
  manager: "Jefatura",
  superadmin: "Superadministrador",
};

function normalizeRole(value: unknown): UserRole | null {
  return value === "driver" || value === "manager" || value === "superadmin" ? value : null;
}

function connectionError(fallback: string) {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "No hay conexión. Conéctate a internet para validar la sesión y luego podrás continuar aunque la señal se interrumpa."
    : fallback;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [ProtectedApp, setProtectedApp] = useState<ComponentType | null>(null);

  const loadApp = useCallback(async (nextRole: UserRole) => {
    setPhase("loading");
    setMessage("");

    // GestiónVerde ya no depende de AES, worker/vault ni ROUTE_DATA_KEY.
    // La UI recibe una fuente de datos limpia que luego podrá venir desde Firestore.
    installRouteData(ROUTE_STOPS);

    const protectedModule = nextRole === "manager"
      ? await import("./manager-only-app")
      : nextRole === "driver"
        ? await import("./driver-app")
        : await import("./superadmin-app");

    setRole(nextRole);
    setProtectedApp(() => protectedModule.default);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let active = true;
    void migrateLegacyBrowserStorage();
    void fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 503) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error || "La seguridad no está configurada.");
        }
        const body = await response.json() as { authenticated?: boolean; role?: unknown };
        const sessionRole = normalizeRole(body.role);
        if (body.authenticated && sessionRole) await loadApp(sessionRole);
        else setPhase("login");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const fallback = error instanceof Error ? error.message : "No fue posible comprobar la sesión.";
        setMessage(connectionError(fallback));
        setPhase("error");
      });
    return () => { active = false; };
  }, [loadApp]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPhase("loading");
    setMessage("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; role?: unknown; retryAfter?: number };
      if (!response.ok) {
        const retry = body.retryAfter ? ` Intenta nuevamente en ${Math.ceil(body.retryAfter / 60)} min.` : "";
        throw new Error((body.error || "No fue posible iniciar sesión.") + retry);
      }
      const nextRole = normalizeRole(body.role);
      if (!nextRole) throw new Error("La cuenta no tiene un rol válido configurado.");
      setPassword("");
      await loadApp(nextRole);
    } catch (error) {
      const fallback = error instanceof Error ? error.message : "No fue posible iniciar sesión.";
      setMessage(connectionError(fallback));
      setPhase("login");
    }
  };

  const logout = async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    clearRouteData();
    setProtectedApp(null);
    setRole(null);
    setUsername("");
    setPassword("");
    setPhase("login");
  };

  if (phase === "ready" && ProtectedApp && role) {
    return (
      <>
        <div className="session-dock" aria-label={`Sesión de ${ROLE_LABELS[role]}`}>
          <span className="session-role">Sesión: {ROLE_LABELS[role]}</span>
          <button className="logout-button" type="button" onClick={logout} aria-label="Cerrar sesión de GestiónVerde">
            Cerrar sesión
          </button>
        </div>
        <ProtectedApp />
      </>
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <Image src="/icon-192.png" width={58} height={58} alt="GestiónVerde" priority unoptimized />
          <div><span className="auth-kicker">Acceso por rol</span><strong className="auth-title" id="auth-title">GestiónVerde</strong></div>
        </div>

        {phase === "checking" || phase === "loading" ? (
          <div className="auth-status" role="status" aria-live="polite">Preparando el recorrido…</div>
        ) : phase === "error" ? (
          <div>
            <p className="auth-error" role="alert">{message}</p>
            <button className="auth-submit" type="button" onClick={() => window.location.reload()}>Reintentar</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={login} autoComplete="on">
            <p className="auth-description">Conductor, Jefatura y Superadministrador ingresan con cuentas distintas. El recorrido se carga desde una fuente limpia y preparada para sincronización en tiempo real.</p>
            <label className="auth-field">Usuario
              <input className="auth-input" autoComplete="username" autoCapitalize="none" spellCheck={false} enterKeyHint="next" value={username} onChange={(event) => setUsername(event.target.value)} required />
            </label>
            <label className="auth-field">Contraseña
              <input className="auth-input" type="password" autoComplete="current-password" enterKeyHint="go" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            {message && <p className="auth-alert" role="alert" aria-live="assertive">{message}</p>}
            <button className="auth-submit" type="submit">Entrar a GestiónVerde</button>
          </form>
        )}
      </section>
    </main>
  );
}

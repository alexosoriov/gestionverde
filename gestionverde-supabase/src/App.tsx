import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCurrentProfile, supabase, type Profile } from "./supabase";

type AuthMode = "login" | "register";

type DashboardStats = {
  rutas: number;
  solicitudes: number;
  noticias: number;
};

const EMPTY_STATS: DashboardStats = { rutas: 0, solicitudes: 0, noticias: 0 };

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Error desconocido");
  if (message.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (message.includes("Email not confirmed")) return "Debes confirmar tu correo antes de ingresar.";
  if (message.includes("User already registered")) return "Ese correo ya está registrado.";
  if (message.includes("Password should be")) return "La contraseña debe tener al menos 8 caracteres.";
  return message;
}

function roleLabel(profile: Profile) {
  const labels: Record<Profile["rol"], string> = {
    administrador: "Administración",
    jefatura: "Jefatura",
    supervisor: "Supervisión",
    chofer: "Conductor M-73",
    recolector: "Equipo recolector",
    vecino: "Portal vecinal",
  };
  return labels[profile.rol];
}

async function loadStats(profile: Profile): Promise<DashboardStats> {
  const routesQuery = supabase.from("rutas").select("id", { count: "exact", head: true });
  const requestsQuery = supabase.from("solicitudes_retiro").select("id", { count: "exact", head: true });
  const newsQuery = supabase.from("noticias").select("id", { count: "exact", head: true }).eq("publicada", true);

  const [routes, requests, news] = await Promise.all([routesQuery, requestsQuery, newsQuery]);

  return {
    rutas: routes.count ?? 0,
    solicitudes: requests.count ?? 0,
    noticias: news.count ?? 0,
  };
}

export default function App() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    const nextProfile = await getCurrentProfile();
    setProfile(nextProfile);
    if (nextProfile) setStats(await loadStats(nextProfile));
    else setStats(EMPTY_STATS);
  };

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (error) throw error;
        if (!mounted) return;
        setSession(data.session);
        if (data.session) await refreshProfile();
      })
      .catch((error) => mounted && setMessage(friendlyError(error)))
      .finally(() => mounted && setLoading(false));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setStats(EMPTY_STATS);
        return;
      }
      window.setTimeout(() => {
        void refreshProfile().catch((error) => setMessage(friendlyError(error)));
      }, 0);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "register") {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { nombre: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setMessage("Cuenta creada. Revisa tu correo; después Jefatura deberá aprobar tu acceso vecinal.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setMessage(friendlyError(error));
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(friendlyError(error));
    setLoading(false);
  };

  if (loading && !session) {
    return <main className="loading-screen"><div className="spinner" /><p>Preparando GestiónVerde…</p></main>;
  }

  if (!session) {
    return (
      <main className="auth-layout">
        <section className="auth-brand">
          <span className="brand-mark">GV</span>
          <p className="eyebrow">Municipalidad de Puerto Montt</p>
          <h1>Gestión ambiental con información clara y operación segura.</h1>
          <p className="brand-copy">Plataforma para coordinar recorridos, solicitudes vecinales, incidencias y evidencia del programa de recolección selectiva.</p>
          <div className="brand-facts">
            <article><strong>M-73</strong><span>Vehículo operativo</span></article>
            <article><strong>44</strong><span>Viviendas registradas</span></article>
            <article><strong>08:00</strong><span>Inicio de jornada</span></article>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-card">
            <div className="auth-heading">
              <span>{mode === "login" ? "Acceso seguro" : "Portal vecinal"}</span>
              <h2>{mode === "login" ? "Iniciar sesión" : "Crear solicitud de cuenta"}</h2>
              <p>{mode === "login" ? "Ingresa con una cuenta autorizada." : "La cuenta quedará pendiente de aprobación por Jefatura."}</p>
            </div>

            <div className="mode-switch" aria-label="Cambiar formulario">
              <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }} type="button">Ingresar</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }} type="button">Registro vecinal</button>
            </div>

            <form onSubmit={submit}>
              {mode === "register" && (
                <label>Nombre completo
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
                </label>
              )}
              <label>Correo electrónico
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <label>Contraseña
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required />
              </label>
              {message && <div className="form-message" role="alert">{message}</div>}
              <button className="primary-button" disabled={loading} type="submit">{loading ? "Procesando…" : mode === "login" ? "Entrar a GestiónVerde" : "Crear cuenta vecinal"}</button>
            </form>

            <div className="divider"><span>o continúa con</span></div>
            <button className="google-button" onClick={loginWithGoogle} disabled={loading} type="button">Google</button>
            <p className="security-note">La clave pública de Supabase puede estar en el navegador porque el acceso real se controla con políticas RLS. La service role nunca debe publicarse.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="status-screen">
        <section>
          <span className="status-icon">!</span>
          <h1>Falta el perfil de acceso</h1>
          <p>La sesión existe, pero no se encontró una fila en <code>profiles</code>. Revisa el trigger <code>on_auth_user_created</code>.</p>
          {message && <div className="form-message">{message}</div>}
          <button className="primary-button" onClick={() => void refreshProfile()} type="button">Volver a comprobar</button>
          <button className="text-button" onClick={logout} type="button">Cerrar sesión</button>
        </section>
      </main>
    );
  }

  if (!profile.activo || profile.estado !== "aprobado") {
    return (
      <main className="status-screen">
        <section>
          <span className="status-icon pending">…</span>
          <p className="eyebrow">Cuenta {profile.estado}</p>
          <h1>{profile.estado === "pendiente" ? "Tu acceso espera aprobación" : "Tu acceso fue revocado"}</h1>
          <p>{profile.estado === "pendiente" ? "Jefatura debe revisar y aprobar tu perfil antes de abrir el portal." : "Comunícate con Jefatura para revisar el estado de tu cuenta."}</p>
          <dl><div><dt>Nombre</dt><dd>{profile.nombre || profile.email}</dd></div><div><dt>Rol solicitado</dt><dd>{roleLabel(profile)}</dd></div></dl>
          <button className="primary-button" onClick={() => void refreshProfile()} type="button">Comprobar aprobación</button>
          <button className="text-button" onClick={logout} type="button">Cerrar sesión</button>
        </section>
      </main>
    );
  }

  const municipal = profile.rol !== "vecino";

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span>GV</span><div><strong>GestiónVerde</strong><small>Puerto Montt</small></div></div>
        <nav>
          <button className="active" type="button">Resumen</button>
          {municipal ? <><button type="button">Recorrido M-73</button><button type="button">Viviendas</button><button type="button">Solicitudes</button><button type="button">Informes</button></> : <><button type="button">Solicitar retiro</button><button type="button">Mi historial</button><button type="button">Noticias</button></>}
        </nav>
        <div className="profile-mini"><strong>{profile.nombre || profile.email}</strong><span>{roleLabel(profile)}</span><button onClick={logout} type="button">Cerrar sesión</button></div>
      </aside>

      <section className="dashboard-main">
        <header><div><p className="eyebrow">Centro de operación</p><h1>Hola, {profile.nombre?.split(" ")[0] || "usuario"}</h1><p>{municipal ? "Estado general del programa y recorrido selectivo." : "Revisa el recorrido y gestiona tus solicitudes."}</p></div><span className="online-pill">Supabase conectado</span></header>

        <div className="metric-grid">
          <article><span>Rutas visibles</span><strong>{stats.rutas}</strong><small>Según tu nivel de acceso</small></article>
          <article><span>Solicitudes</span><strong>{stats.solicitudes}</strong><small>{municipal ? "Pendientes y gestionadas" : "Asociadas a tu cuenta"}</small></article>
          <article><span>Noticias</span><strong>{stats.noticias}</strong><small>Publicadas para la comunidad</small></article>
          <article className="truck-card"><span>Vehículo</span><strong>M-73</strong><small>Preparado para operación</small></article>
        </div>

        <div className="dashboard-grid">
          <article className="route-card"><div><p className="eyebrow">Recorrido de hoy</p><h2>Villa Los Héroes / Laguna Santuario</h2><p>Inicio programado a las 08:00. El estado real se obtiene desde la tabla <code>rutas</code>.</p></div><button className="primary-button" type="button">Abrir recorrido</button></article>
          <article className="checklist-card"><p className="eyebrow">Base Supabase</p><h2>Configuración inicial</h2><ul><li>Autenticación por correo y Google</li><li>Perfiles y roles municipales</li><li>Aprobación de vecinos</li><li>RLS en todas las tablas sensibles</li><li>Storage privado para evidencias</li></ul></article>
        </div>
      </section>
    </main>
  );
}

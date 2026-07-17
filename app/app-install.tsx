"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLocaleLowerCase("en-US");
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/u.test(userAgent) || touchMac) return "ios";
  if (/android/u.test(userAgent)) return "android";
  return "other";
}

export default function AppInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const timer = window.setTimeout(() => {
      setInstalled(standalone);
      setPlatform(detectPlatform());
    }, 0);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setOpen(false); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const install = async () => {
    if (!prompt) {
      setOpen(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };

  const instructions = useMemo(() => {
    if (platform === "ios") {
      return {
        title: "iPhone · Safari",
        steps: ["Toca el botón Compartir □↑ de Safari", "Selecciona “Agregar a inicio”", "Activa “Abrir como app” y confirma"],
      };
    }
    if (platform === "android") {
      return {
        title: "Android · Chrome",
        steps: ["Toca el menú ⋮ de Chrome", "Selecciona “Instalar aplicación”", "Confirma para agregar Ruta Verde"],
      };
    }
    return {
      title: "Instalación en teléfono",
      steps: ["Abre el menú del navegador", "Busca “Instalar” o “Agregar a inicio”", "Confirma para abrirla sin la barra del navegador"],
    };
  }, [platform]);

  if (installed) return <span className="installed-badge" aria-label="Ruta Verde instalada">✓ App instalada</span>;

  return <>
    <button className="install-button" type="button" onClick={install} aria-label="Instalar Ruta Verde como aplicación"><span>↓</span> Instalar app</button>
    {open && <div className="install-backdrop" role="dialog" aria-modal="true" aria-labelledby="install-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="install-card">
        <button className="install-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar instrucciones de instalación">×</button>
        <Image src="/logo-ruta-verde.png" width={74} height={74} alt="Logo Ruta Verde" unoptimized />
        <p>Ruta Verde en tu teléfono</p>
        <h2 id="install-title">Instálala como una app</h2>
        <div className="install-steps">
          <div className="install-platform"><b>{instructions.title}</b>{instructions.steps.map((step, index) => <span key={step}>{index + 1}. {step}</span>)}</div>
        </div>
        <small className="install-note">Inicia sesión con internet antes del recorrido. Si después se corta la señal, el avance queda cifrado en el teléfono y se sincroniza al volver la conexión.</small>
        <button type="button" onClick={() => setOpen(false)}>Entendido</button>
      </div>
    </div>}
  </>;
}

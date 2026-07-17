"use client";

import { useEffect } from "react";

const DEVICE_KEY = "ruta-verde-device-id";
const APP_VERSION = "ruta-verde-2026.07";
const sentRecently = new Map<string, number>();

function deviceId() {
  try {
    return localStorage.getItem(DEVICE_KEY) || "unknown-device";
  } catch {
    return "unknown-device";
  }
}

function safeMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return "Error desconocido"; }
}

function safeStack(value: unknown) {
  return value instanceof Error && typeof value.stack === "string" ? value.stack : "";
}

function report(payload: Record<string, unknown>) {
  const fingerprint = `${payload.type}:${payload.message}:${payload.path}`.slice(0, 800);
  const lastSent = sentRecently.get(fingerprint) ?? 0;
  if (Date.now() - lastSent < 30_000) return;
  sentRecently.set(fingerprint, Date.now());
  if (sentRecently.size > 40) sentRecently.clear();

  void fetch("/api/diagnostics", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      path: `${location.pathname}${location.search}`.slice(0, 300),
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      deviceId: deviceId(),
      appVersion: APP_VERSION,
      occurredAt: Date.now(),
    }),
  }).catch(() => undefined);
}

export default function ErrorReporter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      report({
        type: "error",
        message: event.message || safeMessage(event.error),
        stack: safeStack(event.error),
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      report({
        type: "unhandled-rejection",
        message: safeMessage(event.reason),
        stack: safeStack(event.reason),
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}

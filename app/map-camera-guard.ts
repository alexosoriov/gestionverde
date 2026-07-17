import * as L from "leaflet";

declare global {
  interface Window {
    __rutaVerdeCameraGuardInstalled?: boolean;
    __rutaVerdeAllowNextProgrammaticPan?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__rutaVerdeCameraGuardInstalled) {
  window.__rutaVerdeCameraGuardInstalled = true;
  window.__rutaVerdeAllowNextProgrammaticPan = false;

  const originalPanTo = L.Map.prototype.panTo;

  L.Map.prototype.panTo = function guardedPanTo(
    center: L.LatLngExpression,
    options?: L.PanOptions,
  ) {
    if (window.__rutaVerdeAllowNextProgrammaticPan) {
      window.__rutaVerdeAllowNextProgrammaticPan = false;
      return originalPanTo.call(this, center, options);
    }

    return this;
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    const label = button?.textContent?.toLowerCase() ?? "";

    if (label.includes("seguir camión") || label.includes("centrar camión")) {
      window.__rutaVerdeAllowNextProgrammaticPan = true;
    }
  }, true);
}

export {};

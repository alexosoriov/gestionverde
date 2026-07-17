"use client";

import { useEffect } from "react";

/**
 * Leaflet's zoom controls stop pointer events before they reach the map
 * container. LiveMap uses a container listener to disable truck-follow mode,
 * so those stopped events could leave follow mode active and the next GPS fix
 * would move the camera again. This bridge forwards every real manual map
 * gesture to the container before Leaflet can stop propagation.
 */
export default function GpsCameraGuard() {
  useEffect(() => {
    const forwardManualInteraction = (event: Event) => {
      if (!event.isTrusted) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const mapContainer = target.closest<HTMLElement>(".leaflet-container");
      if (!mapContainer) return;

      // LiveMap already listens for pointerdown on the container and changes
      // to free-view mode synchronously through followRef.current = false.
      mapContainer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: false,
          cancelable: false,
          pointerType: event.type.startsWith("touch") ? "touch" : "mouse",
        }),
      );
    };

    document.addEventListener("pointerdown", forwardManualInteraction, true);
    document.addEventListener("touchstart", forwardManualInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener("wheel", forwardManualInteraction, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("pointerdown", forwardManualInteraction, true);
      document.removeEventListener("touchstart", forwardManualInteraction, true);
      document.removeEventListener("wheel", forwardManualInteraction, true);
    };
  }, []);

  return null;
}

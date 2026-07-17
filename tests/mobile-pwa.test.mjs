import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("iPhone usa viewport completo, modo standalone y zonas seguras", async () => {
  const [layout, mobile] = await Promise.all([
    read("app/layout.tsx"),
    read("app/mobile.css"),
  ]);

  assert.match(layout, /viewportFit:\s*"cover"/u);
  assert.match(layout, /appleWebApp/u);
  assert.match(layout, /statusBarStyle:\s*"black-translucent"/u);
  assert.match(mobile, /safe-area-inset-top/u);
  assert.match(mobile, /safe-area-inset-bottom/u);
  assert.match(mobile, /100dvh/u);
});

test("los controles móviles tienen blancos táctiles amplios y no se superponen", async () => {
  const [page, mobile] = await Promise.all([
    read("app/page.tsx"),
    read("app/mobile.css"),
  ]);

  assert.match(page, /session-dock/u);
  assert.match(page, /logout-button/u);
  assert.match(page, /retryAfter/u);
  assert.match(mobile, /min-height:\s*48px/u);
  assert.match(mobile, /network-status[\s\S]*bottom:\s*calc\(76px/u);
  assert.match(mobile, /font-size:\s*16px\s*!important/u);
  assert.match(mobile, /\.row-actions button[\s\S]*height:\s*48px/u);
  assert.match(mobile, /grid-template-columns:\s*repeat\(3/u);
  assert.match(mobile, /\.row-nav[\s\S]*grid-column:\s*1 \/ -1/u);
  assert.match(mobile, /prefers-reduced-motion/u);
});

test("el manifiesto cumple la instalación PWA en Android", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));

  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "es-CL");
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose.includes("maskable")));
});

test("la instalación explica Android e iPhone y el respaldo offline se actualiza", async () => {
  const [install, worker] = await Promise.all([
    read("app/app-install.tsx"),
    read("public/sw.js"),
  ]);

  assert.match(install, /iPhone · Safari/u);
  assert.match(install, /Android · Chrome/u);
  assert.match(install, /Agregar a inicio/u);
  assert.match(install, /Instalar aplicación/u);
  assert.match(worker, /santuario-route-v16/u);
  assert.match(worker, /logo-ruta-verde\.png/u);
  assert.match(worker, /offline-map-tile\.svg/u);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*\/api\//u);
});

import assert from "node:assert/strict";
import test from "node:test";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM auth_rate_limit")) return null;
    return null;
  }

  async all() {
    if (this.sql.includes("FROM gestionverde_diagnostics")) {
      return {
        results: [...this.database.diagnostics.values()].sort((a, b) => b.created_at - a.created_at),
        success: true,
        meta: {},
      };
    }
    return { results: [], success: true, meta: {} };
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO gestionverde_diagnostics")) {
      const [id, payload, createdAt] = this.values;
      this.database.diagnostics.set(id, { id, payload, created_at: createdAt });
    } else if (this.sql === "DELETE FROM gestionverde_diagnostics") {
      this.database.diagnostics.clear();
    } else if (this.sql.startsWith("INSERT INTO auth_rate_limit")) {
      this.database.rateLimits.set(this.values[0], {
        attempts: this.values[1],
        window_started: this.values[2],
        blocked_until: this.values[3],
        updated_at: this.values[4],
      });
    } else if (this.sql.startsWith("DELETE FROM auth_rate_limit")) {
      this.database.rateLimits.delete(this.values[0]);
    }
    return { success: true, meta: {} };
  }
}

class FakeD1 {
  constructor() {
    this.diagnostics = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("hardening-clean-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

function environment(database) {
  return {
    DB: database,
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ROUTE_USERNAME: "driver-user",
    ROUTE_PASSWORD: "driver-password",
    JEFATURA_USERNAME: "manager-user",
    JEFATURA_PASSWORD: "manager-password",
    SUPERADMIN_USERNAME: "admin-user",
    SUPERADMIN_PASSWORD: "admin-password",
    ROUTE_SESSION_SECRET: "test-session-secret-with-enough-entropy",
    OPENROUTESERVICE_API_KEY: "test-ors-key",
    VEHICLE_TYPE: "delivery",
    VEHICLE_LENGTH_METERS: "6.4",
    VEHICLE_WIDTH_METERS: "2.25",
    VEHICLE_HEIGHT_METERS: "3.1",
    VEHICLE_AXLELOAD_TONS: "4.8",
    VEHICLE_WEIGHT_TONS: "8.5",
    VEHICLE_HAZMAT: "false",
  };
}

const context = { waitUntil() {}, passThroughOnException() {} };

async function loginCookie(worker, env, username, password, ip = "127.0.0.1") {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ username, password }),
  }), env, context);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

function authorizedRequest(url, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return new Request(url, { ...init, headers });
}

test("diagnósticos JSON solo pueden ser leídos por Jefatura", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD, "192.0.2.11");
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD, "192.0.2.12");

  const payload = {
    type: "error",
    message: "Fallo técnico sintético",
    stack: "Error: Fallo técnico sintético",
    path: "/ruta",
    online: false,
    deviceId: "phone-a",
    occurredAt: 1_000,
  };
  const post = await worker.fetch(authorizedRequest("http://localhost/api/diagnostics", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), env, context);
  assert.equal(post.status, 200);
  assert.equal(database.diagnostics.size, 1);
  const stored = [...database.diagnostics.values()][0];
  assert.match(stored.payload, /Fallo técnico sintético/u);
  assert.match(stored.payload, /phone-a/u);
  assert.doesNotMatch(stored.payload, /secure_payload|AES-GCM|"v":2/u);

  const driverRead = await worker.fetch(
    authorizedRequest("http://localhost/api/diagnostics", driverCookie),
    env,
    context,
  );
  assert.equal(driverRead.status, 403);

  const managerRead = await worker.fetch(
    authorizedRequest("http://localhost/api/diagnostics", managerCookie),
    env,
    context,
  );
  assert.equal(managerRead.status, 200);
  const data = await managerRead.json();
  assert.equal(data.diagnostics[0].data.message, "Fallo técnico sintético");
  assert.equal(data.diagnostics[0].data.deviceId, "phone-a");
});

test("HGV routing envía las dimensiones configuradas del vehículo", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD);
  const originalFetch = globalThis.fetch;
  let providerBody = null;

  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /openrouteservice\.org\/v2\/directions\/driving-hgv/u);
    providerBody = JSON.parse(init.body);
    return Response.json({
      features: [{
        properties: { summary: { distance: 1_200, duration: 320 }, warnings: [] },
        geometry: { coordinates: [[-72.9, -41.4], [-72.89, -41.39]] },
      }],
    });
  };

  try {
    const response = await worker.fetch(authorizedRequest("http://localhost/api/road-route", driverCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[-72.9, -41.4], [-72.89, -41.39]] }),
    }), env, context);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.provider, "openrouteservice-hgv");
    assert.equal(data.truckConstrained, true);
    assert.equal(providerBody.options.vehicle_type, "delivery");
    assert.deepEqual(providerBody.options.profile_params.restrictions, {
      length: 6.4,
      width: 2.25,
      height: 3.1,
      axleload: 4.8,
      weight: 8.5,
      hazmat: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

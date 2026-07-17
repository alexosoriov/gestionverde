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
    if (this.sql.includes("FROM client_diagnostics")) {
      return { results: [...this.database.diagnostics.values()].sort((a, b) => b.created_at - a.created_at) };
    }
    if (this.sql.startsWith("PRAGMA table_info")) return { results: [] };
    return { results: [] };
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO client_diagnostics")) {
      const [id, severity, createdAt, securePayload] = this.values;
      this.database.diagnostics.set(id, {
        id,
        severity,
        created_at: createdAt,
        secure_payload: securePayload,
      });
    }
    if (this.sql.startsWith("DELETE FROM client_diagnostics")) {
      for (const [id, row] of this.database.diagnostics) {
        if (row.created_at < this.values[0]) this.database.diagnostics.delete(id);
      }
    }
    return { success: true };
  }
}

class FakeD1 {
  constructor() {
    this.diagnostics = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("hardening-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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
    ROUTE_DATA_KEY: Buffer.alloc(32, 11).toString("base64"),
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

async function loginCookie(worker, env, username, password) {
  const response = await worker.fetch(new Request("http://localhost/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
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

test("client diagnostics remain encrypted and only management can read them", async () => {
  const worker = await loadWorker();
  const database = new FakeD1();
  const env = environment(database);
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD);
  const managerCookie = await loginCookie(worker, env, env.JEFATURA_USERNAME, env.JEFATURA_PASSWORD);

  const post = await worker.fetch(authorizedRequest("http://localhost/api/diagnostics", driverCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "error",
      message: "Fallo técnico privado",
      stack: "Error: Fallo técnico privado",
      path: "/ruta",
      online: false,
      deviceId: "phone-a",
      occurredAt: 1_000,
    }),
  }), env, context);
  assert.equal(post.status, 201);
  assert.equal(database.diagnostics.size, 1);
  const stored = [...database.diagnostics.values()][0];
  assert.match(stored.secure_payload, /"v":2/);
  assert.doesNotMatch(stored.secure_payload, /Fallo técnico privado|phone-a/);

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
  assert.equal(data.diagnostics[0].message, "Fallo técnico privado");
  assert.equal(data.diagnostics[0].deviceId, "phone-a");
});

test("HGV routing sends the configured vehicle dimensions", async () => {
  const worker = await loadWorker();
  const env = environment(new FakeD1());
  const driverCookie = await loginCookie(worker, env, env.ROUTE_USERNAME, env.ROUTE_PASSWORD);
  const originalFetch = globalThis.fetch;
  let providerBody = null;

  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /openrouteservice\.org\/v2\/directions\/driving-hgv/);
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

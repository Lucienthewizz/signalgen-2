const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ts = require("typescript");

function client(reply) {
  const calls = [],
    events = [],
    tokens = new Map(),
    installations = new Map();
  const source = fs
    .readFileSync(path.join(__dirname, "../src/api/client.ts"), "utf8")
    .replace("import.meta.env.VITE_API_ORIGIN", '"https://api.example.test/"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Headers,
    Event,
    AbortController,
    clearTimeout,
    URL,
    crypto: webcrypto,
    navigator: { userAgent: "TestBrowser/1.0", platform: "Test OS" },
    sessionStorage: {
      getItem: (key) => tokens.get(key) ?? null,
      setItem: (key, value) => tokens.set(key, value),
      removeItem: (key) => tokens.delete(key),
    },
    localStorage: {
      getItem: (key) => installations.get(key) ?? null,
      setItem: (key, value) => installations.set(key, value),
    },
    window: {
      setTimeout,
      dispatchEvent: (event) => events.push(event.type),
      location: { origin: "https://web.example.test" },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return reply(url, init);
    },
  });
  return { ...exports, calls, events };
}
const response = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status });

test("login sends the authorization-branch contract", async () => {
  const c = client(() =>
    response({
      access_token: "test-token",
      token_type: "bearer",
      expires_in: 3600,
      user: { id: "test-user", email: "demo@example.test" },
    }),
  );
  const result = await c.api.login("demo@example.test", "test-password");
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/login");
  assert.equal(c.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    email: "demo@example.test",
    password: "test-password",
  });
  assert.equal(result.access_token, "test-token");
});

test("registration preserves email-confirmation response", async () => {
  const c = client(() =>
    response({
      requires_email_confirmation: true,
      access_token: null,
      user: { id: "test-user" },
    }),
  );
  const result = await c.api.register(
    "Demo User",
    "demo@example.test",
    "test-password",
  );
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/register");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    full_name: "Demo User",
    email: "demo@example.test",
    password: "test-password",
  });
  assert.equal(result.requires_email_confirmation, true);
  assert.equal(result.access_token, null);
  assert.equal(c.session.getToken(), null);
});

test("profile sends bearer token and clears an expired session", async () => {
  const c = client(() =>
    response({ detail: "Invalid authentication credentials" }, 401),
  );
  c.session.setToken("expired-test-token");
  await assert.rejects(c.api.me(), (error) => error.status === 401);
  assert.equal(
    c.calls[0].init.headers.get("Authorization"),
    "Bearer expired-test-token",
  );
  assert.equal(c.session.getToken(), null);
  assert.deepEqual(c.events, ["signalgen:unauthorized"]);
});

test("validation arrays become readable errors", async () => {
  const c = client(() =>
    response(
      { detail: [{ loc: ["body", "full_name"], msg: "String too short" }] },
      422,
    ),
  );
  await assert.rejects(
    c.api.register(" ", "demo@example.test", "test-password"),
    (error) =>
      error.status === 422 &&
      typeof error.message === "string" &&
      !error.message.includes("[object Object]"),
  );
});

test("offline profile request preserves the session for retry", async () => {
  const c = client(() => {
    throw new TypeError("Network unavailable");
  });
  c.session.setToken("test-token");
  await assert.rejects(c.api.me(), (error) => error.status === 0);
  assert.equal(c.session.getToken(), "test-token");
});

test("invalid login has a useful error without profile reset", async () => {
  const c = client(() =>
    response({ detail: "Invalid email or password" }, 401),
  );
  await assert.rejects(c.api.login("demo@example.test", "wrong"), (error) =>
    error.message.includes("email or password"),
  );
  assert.deepEqual(c.events, []);
});

test("password reset request uses the backend authorization contract", async () => {
  const c = client(() => response({ message: "sent" }));
  await c.api.requestPasswordReset("demo@example.test");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/auth/password/reset-request",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    email: "demo@example.test",
  });
});

test("password reset confirmation forwards recovery tokens only to backend", async () => {
  const c = client(() => response({ message: "updated" }));
  await c.api.resetPassword("access", "refresh", "new-secret-123");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/auth/password/reset",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    access_token: "access",
    refresh_token: "refresh",
    password: "new-secret-123",
  });
});

test("app session registers one persistent installation and is sent on private calls", async () => {
  const c = client((url) =>
    url.endsWith("/api/v1/sessions")
      ? response({ session: { id: "ses_1" }, session_token: "sgs_secret" }, 201)
      : response({ id: "default-scalping-v1" }),
  );
  c.session.setToken("access-token");
  await c.api.ensureAppSession();
  await c.api.getRule("default-scalping-v1");
  const body = JSON.parse(c.calls[0].init.body);
  assert.equal(
    c.calls[0].init.headers.get("Authorization"),
    "Bearer access-token",
  );
  assert.ok(body.installation_id);
  assert.equal(c.calls[1].init.headers.get("X-App-Session"), "sgs_secret");
});

test("hybrid screener calls use the implemented Go API contract", async () => {
  const c = client((url) => {
    if (url.endsWith("/datasets/prepare"))
      return response({ dataset_id: "fixture-1" });
    if (url.endsWith("/compute-grants")) return response({ id: "cgr_1" }, 201);
    return response(
      { ticket: "wst_1", websocket_path: "/api/v1/screener/ws" },
      201,
    );
  });
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_secret");
  const manifest = {
    dataset_id: "fixture-1",
    version: "v1",
    checksum: "sha256:data",
  };
  const rule = {
    id: "default-scalping-v1",
    definition_hash: "sha256:rule",
    engine_version: "core-0.2.0",
    schema_version: "signal-baseline-1",
  };
  await c.api.prepareDataset();
  await c.api.createComputeGrant(manifest, rule);
  await c.api.createScreenerSocketTicket("cgr_1");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/datasets/prepare",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body).symbols, ["BBCA.JK"]);
  assert.equal(
    JSON.parse(c.calls[1].init.body).dataset_checksum,
    "sha256:data",
  );
  assert.deepEqual(JSON.parse(c.calls[2].init.body), {
    compute_grant_id: "cgr_1",
    protocol: "screener-private-1",
  });
});

test("websocket URL upgrades HTTPS and keeps credentials out of the query", () => {
  const c = client(() => response({}));
  assert.equal(
    c.websocketURL("/api/v1/screener/ws", "wst_once"),
    "wss://api.example.test/api/v1/screener/ws?ticket=wst_once",
  );
});

test("Go error envelopes produce a readable entitlement message", async () => {
  const c = client(() =>
    response(
      { error: { code: "ENTITLEMENT_REQUIRED", message: "denied" } },
      403,
    ),
  );
  await assert.rejects(
    c.api.prepareDataset(),
    (error) =>
      error.status === 403 && error.message.includes("akses fitur screener"),
  );
});

test("logout revokes the current app session before local cleanup", async () => {
  const c = client(() => new Response(null, { status: 204 }));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_secret");
  await c.api.revokeCurrentAppSession();
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/sessions/current",
  );
  assert.equal(c.calls[0].init.method, "DELETE");
  assert.equal(c.calls[0].init.headers.get("X-App-Session"), "sgs_secret");
});

test("access page reads owner-scoped account and devices", async () => {
  const c = client((url) =>
    response(
      url.endsWith("/devices") ? { items: [] } : { features: ["screener"] },
    ),
  );
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_secret");
  const [account, devices] = await Promise.all([
    c.api.account(),
    c.api.listDevices(),
  ]);
  assert.deepEqual(account.features, ["screener"]);
  assert.deepEqual(devices.items, []);
  assert.equal(c.calls[0].init.headers.get("X-App-Session"), "sgs_secret");
  assert.ok(c.calls.some((call) => call.url.endsWith("/api/v1/account/me")));
  assert.ok(
    c.calls.some((call) => call.url.endsWith("/api/v1/account/devices")),
  );
});

test("device rename and revoke send exactly one supported action", async () => {
  const c = client(() => new Response(null, { status: 204 }));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_secret");
  await c.api.renameDevice("browser/mac", "Safari on Mac");
  await c.api.revokeDevice("browser/mac");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/account/devices/browser%2Fmac",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    label: "Safari on Mac",
  });
  assert.deepEqual(JSON.parse(c.calls[1].init.body), { status: "revoked" });
});

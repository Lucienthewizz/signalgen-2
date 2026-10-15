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

test("proactive token refresh is coalesced and does not change installation sessions", async () => {
  const c = client((url) =>
    response(
      url.endsWith("/refresh")
        ? { access_token: "new", refresh_token: "rotated", expires_in: 3600 }
        : { id: "user" },
    ),
  );
  c.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 1,
  });
  c.session.setAppSession("workspace");
  await Promise.all([c.api.me(), c.api.listRules(), c.api.ensureAppSession()]);
  assert.equal(
    c.calls.filter((call) => call.url.endsWith("/refresh")).length,
    1,
  );
  assert.equal(c.session.getToken(), "new");
  assert.equal(c.session.getAppSession(), "workspace");
});
test("401 refreshes once and retries the request with the rotated bearer", async () => {
  const c = client((url, init) =>
    response(
      url.endsWith("/refresh")
        ? { access_token: "new", refresh_token: "rotated", expires_in: 3600 }
        : init.headers.get("Authorization") === "Bearer new"
          ? { id: "u" }
          : { detail: "expired" },
      url.endsWith("/refresh") ||
        init.headers.get("Authorization") === "Bearer new"
        ? 200
        : 401,
    ),
  );
  c.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 3600,
  });
  await c.api.me();
  assert.equal(c.calls.length, 3);
  assert.equal(c.events.length, 0);
});
test("invalid refresh signs out while a network failure preserves credentials", async () => {
  const c = client(() => response({ detail: "invalid" }, 401));
  c.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 1,
  });
  await assert.rejects(c.api.me());
  assert.equal(c.session.getToken(), null);
  const offline = client(() => {
    throw Error("offline");
  });
  offline.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 1,
  });
  await assert.rejects(offline.api.me());
  assert.equal(offline.session.getToken(), "old");
});
test("a revoked device session cannot silently recreate itself", async () => {
  const c = client(() => response({ error: { code: "SESSION_REVOKED" } }, 403));
  c.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 3600,
  });
  await assert.rejects(c.api.listRules());
  assert.equal(c.calls.length, 1);
  assert.equal(c.session.getToken(), null);
});
test("logging out during refresh cannot resurrect a session", async () => {
  let done;
  const c = client(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  c.session.setAuth({
    access_token: "old",
    refresh_token: "refresh",
    expires_in: 1,
  });
  const pending = c.api.me();
  c.session.clear();
  done(
    response({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
    }),
  );
  await assert.rejects(pending);
  assert.equal(c.session.getToken(), null);
});

test("simultaneous GETs share a request without caching later reads", async () => {
  const c = client(() => response({ items: [] }));
  await Promise.all([c.api.listRules(), c.api.listRules(), c.api.listRules()]);
  assert.equal(c.calls.length, 1);
  await c.api.listRules();
  assert.equal(c.calls.length, 2);
});

test("read coalescing is scoped to authorization identity", async () => {
  const c = client(() => response({ items: [] }));
  c.session.setToken("account-a");
  const a = c.api.listRules();
  c.session.setToken("account-b");
  await Promise.all([assert.rejects(a, /Akun berubah/), c.api.listRules()]);
  assert.equal(c.calls.length, 2);
});

test("simultaneous app-session setup creates only one session", async () => {
  const c = client(() => response({ session_token: "workspace-token" }));
  c.session.setToken("identity");
  await Promise.all([c.api.ensureAppSession(), c.api.ensureAppSession()]);
  assert.equal(c.calls.length, 1);
});

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
      {
        ticket: "sgt_1",
        websocket_path: "/api/v1/screener/ws",
        protocol: "screener-private-1",
        feature_schema_version: "screener-features-1",
        max_candidates: 1000,
      },
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
    engine_version: "core-0.3.0",
    schema_version: "signal-baseline-1",
  };
  await c.api.prepareDataset("default-scalping-v1", "universe-bank");
  await c.api.createComputeGrant(manifest, rule);
  await c.api.createScreenerSocketTicket("cgr_1");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/datasets/prepare",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    purpose: "screen",
    rule_id: "default-scalping-v1",
    universe_id: "universe-bank",
  });
  assert.equal(
    JSON.parse(c.calls[1].init.body).dataset_checksum,
    "sha256:data",
  );
  assert.deepEqual(JSON.parse(c.calls[2].init.body), {
    compute_grant_id: "cgr_1",
    protocol: "screener-private-1",
  });
});

test("websocket URL upgrades HTTPS and only carries the one-use ticket", () => {
  const c = client(() => response({}));
  assert.equal(
    c.websocketURL("/api/v1/screener/ws", "wst_once"),
    "wss://api.example.test/api/v1/screener/ws?ticket=wst_once",
  );
});

test("worker and socket orchestration use the current private-screener contract", () => {
  const worker = fs.readFileSync(
    path.join(__dirname, "../src/workers/screener.worker.ts"),
    "utf8",
  );
  const orchestration = fs.readFileSync(
    path.join(__dirname, "../src/analysis/screener-socket.ts"),
    "utf8",
  );
  assert.match(worker, /worker-2/);
  assert.match(worker, /signalgenComputeFeatures/);
  assert.doesNotMatch(worker, /signalgenExtractLatestFeatures/);
  assert.match(orchestration, /screener-private-1/);
  assert.match(orchestration, /feature_schema_version/);
  assert.match(orchestration, /candidates: featureResult\.candidates/);
});

test("Go error envelopes produce a readable entitlement message", async () => {
  const c = client(() =>
    response(
      { error: { code: "ENTITLEMENT_REQUIRED", message: "denied" } },
      403,
    ),
  );
  await assert.rejects(
    c.api.prepareDataset("default-scalping-v1", "universe-bank"),
    (error) =>
      error.status === 403 && error.message.includes("akses fitur screener"),
  );
});

test("an expired app session is renewed once before retrying a private call", async () => {
  let accountAttempts = 0;
  const c = client((url) => {
    if (url.endsWith("/api/v1/sessions"))
      return response(
        { session: { id: "ses_2" }, session_token: "sgs_fresh" },
        201,
      );
    if (url.endsWith("/api/v1/account/me") && accountAttempts++ === 0)
      return response(
        {
          error: {
            code: "SESSION_EXPIRED",
            message: "expired",
            request_id: "req_expired",
          },
        },
        403,
      );
    return response({ features: ["screener"] });
  });
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_stale");

  const account = await c.api.account();

  assert.deepEqual(account.features, ["screener"]);
  assert.equal(c.calls.length, 3);
  assert.equal(c.calls[0].init.headers.get("X-App-Session"), "sgs_stale");
  assert.equal(c.calls[2].init.headers.get("X-App-Session"), "sgs_fresh");
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

test("admin mutations carry the target, reason and authenticated session", async () => {
  const c = client(() => response({}));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_operator");
  const until = "2026-11-06T00:00:00Z";
  await c.api.grantFeature("target-user", "screener", until, "Approved trial");
  await c.api.revokeFeature("target-user", "screener", "Trial ended");
  await c.api.activateSubscription(
    "target-user",
    "analyst",
    until,
    "Approved plan",
  );
  await c.api.changeAccountRole("target-user", "operator", "Approved operator");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    user_id: "target-user",
    feature: "screener",
    valid_until: until,
    reason: "Approved trial",
  });
  assert.equal(c.calls[1].init.method, "DELETE");
  assert.deepEqual(JSON.parse(c.calls[1].init.body), { reason: "Trial ended" });
  assert.deepEqual(JSON.parse(c.calls[2].init.body), {
    user_id: "target-user",
    plan_code: "analyst",
    current_period_end: until,
    reason: "Approved plan",
  });
  assert.equal(c.calls[3].init.method, "PATCH");
  assert.deepEqual(JSON.parse(c.calls[3].init.body), {
    role: "operator",
    reason: "Approved operator",
  });
  for (const call of c.calls) {
    assert.equal(call.init.headers.get("Authorization"), "Bearer access-token");
    assert.equal(call.init.headers.get("X-App-Session"), "sgs_operator");
    assert.ok(call.url.includes("/api/v1/operator/"));
  }
});

test("admin readiness uses the public readiness endpoint", async () => {
  const c = client(() => response({ status: "ready" }));
  assert.equal((await c.api.readiness()).status, "ready");
  assert.equal(c.calls[0].url, "https://api.example.test/ready");
});

test("concurrent workspace bootstrap creates only one app session", async () => {
  let finish;
  const c = client(() => new Promise((resolve) => (finish = resolve)));
  c.session.setToken("access-token");
  const requests = Array.from({ length: 4 }, () => c.api.ensureAppSession());
  assert.equal(c.calls.length, 1);
  finish(response({ session_token: "sgs_shared" }, 201));
  assert.deepEqual(await Promise.all(requests), Array(4).fill("sgs_shared"));
  assert.equal(c.session.getAppSession(), "sgs_shared");
});

test("a late expired response does not clear a freshly renewed session", async () => {
  let finishLateRead;
  let reads = 0;
  let creations = 0;
  const expired = () => response({ error: { code: "SESSION_EXPIRED" } }, 403);
  const c = client((url) => {
    if (url.endsWith("/api/v1/sessions")) {
      creations++;
      return response({ session_token: "sgs_fresh" }, 201);
    }
    if (reads++ === 0) return expired();
    if (reads === 2)
      return new Promise((resolve) => (finishLateRead = resolve));
    return response({ features: ["screener"] });
  });
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_old");
  const first = c.api.account();
  // Use a different read endpoint so request coalescing does not intentionally
  // turn both calls into the same network request.
  const late = c.api.listDevices();
  await first;
  finishLateRead(expired());
  await late;
  assert.equal(creations, 1);
  assert.equal(c.session.getAppSession(), "sgs_fresh");
});

test("a revoked workspace requires login and never creates a replacement", async () => {
  const c = client(() => response({ error: { code: "SESSION_REVOKED" } }, 403));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_revoked");
  await assert.rejects(
    c.api.account(),
    (error) => error.code === "SESSION_REVOKED",
  );
  assert.equal(c.calls.length, 1);
  assert.equal(c.session.getAppSession(), null);
  assert.equal(c.session.getToken(), null);
  assert.deepEqual(c.events, ["signalgen:unauthorized"]);
});

test("an expired mutation is not replayed or silently renewed", async () => {
  const c = client(() => response({ error: { code: "SESSION_EXPIRED" } }, 403));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_expired");
  await assert.rejects(
    c.api.createStockUniverse("Fixture", ["BBCA.JK"]),
    (error) => error.code === "SESSION_EXPIRED",
  );
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].init.method, "POST");
  assert.equal(c.session.getAppSession(), null);
  assert.equal(c.session.getToken(), "access-token");
});

test("failed bootstrap releases the pending request for an explicit retry", async () => {
  let attempts = 0;
  const c = client(() =>
    attempts++ === 0
      ? response({ error: { code: "SERVICE_UNAVAILABLE" } }, 503)
      : response({ session_token: "sgs_retry" }, 201),
  );
  c.session.setToken("access-token");
  await assert.rejects(
    c.api.ensureAppSession(),
    (error) => error.status === 503,
  );
  assert.equal(c.session.getToken(), "access-token");
  assert.equal(await c.api.ensureAppSession(), "sgs_retry");
  assert.equal(c.calls.length, 2);
});

test("late bootstrap cannot restore a secret after logout", async () => {
  let finish;
  const c = client(() => new Promise((resolve) => (finish = resolve)));
  c.session.setToken("access-token");
  const pending = c.api.ensureAppSession();
  c.session.clear();
  finish(response({ session_token: "sgs_too_late" }, 201));
  await assert.rejects(pending, (error) => error.status === 0);
  assert.equal(c.session.getToken(), null);
  assert.equal(c.session.getAppSession(), null);
});

test("account switching clears the old secret and isolates pending bootstrap", async () => {
  let finishOld;
  let attempts = 0;
  const c = client(() =>
    attempts++ === 0
      ? new Promise((resolve) => (finishOld = resolve))
      : response({ session_token: "sgs_new_account" }, 201),
  );
  c.session.setToken("old-account-token");
  const old = c.api.ensureAppSession();
  c.session.setAppSession("sgs_old_account");
  c.session.setToken("new-account-token");
  assert.equal(c.session.getAppSession(), null);
  await c.api.ensureAppSession();
  finishOld(response({ session_token: "sgs_old_late" }, 201));
  await assert.rejects(old, (error) => error.status === 0);
  assert.equal(c.session.getAppSession(), "sgs_new_account");
  assert.equal(c.session.getToken(), "new-account-token");
});

test("a stale identity denial cannot log out a newer account", async () => {
  let finish;
  const c = client(() => new Promise((resolve) => (finish = resolve)));
  c.session.setToken("old-account-token");
  const read = c.api.me();
  c.session.setToken("new-account-token");
  c.session.setAppSession("sgs_new_account");
  finish(response({ error: { code: "AUTH_INVALID" } }, 401));
  await assert.rejects(read, (error) => error.status === 401);
  assert.equal(c.session.getToken(), "new-account-token");
  assert.equal(c.session.getAppSession(), "sgs_new_account");
  assert.deepEqual(c.events, []);
});

test("invalid public recovery credentials do not clear a logged-in identity", async () => {
  const c = client(() => response({ error: { code: "AUTH_INVALID" } }, 401));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_valid");
  await assert.rejects(
    c.api.resetPassword(
      "invalid-access",
      "invalid-refresh",
      "fixture-only-password",
    ),
    (error) => error.status === 401,
  );
  assert.equal(c.session.getToken(), "access-token");
  assert.equal(c.session.getAppSession(), "sgs_valid");
  assert.deepEqual(c.events, []);
});

test("a late revocation response cannot clear a newer app-session secret", async () => {
  let finish;
  const c = client(() => new Promise((resolve) => (finish = resolve)));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_old");
  const read = c.api.account();
  c.session.setAppSession("sgs_new");
  finish(response({ error: { code: "SESSION_REVOKED" } }, 403));
  await assert.rejects(read, (error) => error.code === "SESSION_REVOKED");
  assert.equal(c.session.getToken(), "access-token");
  assert.equal(c.session.getAppSession(), "sgs_new");
  assert.deepEqual(c.events, []);
  assert.equal(c.calls.length, 1);
});

test("editable profile reads the owner-scoped server endpoint", async () => {
  const profile = {
    user_id: "test-user",
    display_name: "Demo",
    bio: "Existing bio",
    version: 4,
    updated_at: "2026-10-06T00:00:00Z",
  };
  const c = client(() => response(profile));
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_valid");
  assert.deepEqual(await c.api.getProfile(), profile);
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/account/profile",
  );
  assert.equal(
    c.calls[0].init.headers.get("Authorization"),
    "Bearer access-token",
  );
  assert.equal(c.calls[0].init.headers.get("X-App-Session"), "sgs_valid");
});

test("profile save sends the expected version and only the display field", async () => {
  const c = client(() =>
    response({
      user_id: "test-user",
      display_name: "Updated",
      bio: "Retained",
      version: 5,
    }),
  );
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_valid");
  const saved = await c.api.updateProfile(4, "Updated");
  assert.equal(saved.version, 5);
  assert.equal(c.calls[0].init.method, "PATCH");
  assert.equal(
    c.calls[0].url,
    "https://api.example.test/api/v1/account/profile",
  );
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    version: 4,
    display_name: "Updated",
  });
});

test("stale profile writes fail without retry or session cleanup", async () => {
  const c = client(() =>
    response({ error: { code: "PROFILE_CONFLICT" } }, 409),
  );
  c.session.setToken("access-token");
  c.session.setAppSession("sgs_valid");
  await assert.rejects(
    c.api.updateProfile(3, "Draft"),
    (error) => error.status === 409,
  );
  assert.equal(c.calls.length, 1);
  assert.equal(c.session.getToken(), "access-token");
  assert.equal(c.session.getAppSession(), "sgs_valid");
});

test("logout and a same-token login cannot inherit an older pending secret", async () => {
  let finishOld;
  let attempts = 0;
  const c = client(() =>
    attempts++ === 0
      ? new Promise((resolve) => (finishOld = resolve))
      : response({ session_token: "sgs_new_login" }, 201),
  );
  c.session.setToken("same-provider-token");
  const old = c.api.ensureAppSession();
  c.session.clear();
  c.session.setToken("same-provider-token");
  await c.api.ensureAppSession();
  finishOld(response({ session_token: "sgs_old_login" }, 201));
  await assert.rejects(old, (error) => error.status === 0);
  assert.equal(c.session.getAppSession(), "sgs_new_login");
  assert.equal(c.calls.length, 2);
});

test("same-token re-login is not cleared by an older unauthorized response", async () => {
  let finish;
  const c = client(() => new Promise((resolve) => (finish = resolve)));
  c.session.setToken("same-provider-token");
  const read = c.api.me();
  c.session.clear();
  c.session.setToken("same-provider-token");
  c.session.setAppSession("sgs_new_login");
  finish(response({ error: { code: "AUTH_INVALID" } }, 401));
  await assert.rejects(read, (error) => error.status === 401);
  assert.equal(c.session.getToken(), "same-provider-token");
  assert.equal(c.session.getAppSession(), "sgs_new_login");
  assert.deepEqual(c.events, []);
});

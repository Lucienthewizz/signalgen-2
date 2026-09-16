const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function client(reply) {
  const calls = [], events = [], tokens = new Map();
  const source = fs.readFileSync(path.join(__dirname, "../src/api/client.ts"), "utf8")
    .replace("import.meta.env.VITE_API_ORIGIN", '"https://api.example.test/"');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Headers, Event, AbortController, clearTimeout,
    sessionStorage: { getItem: (key) => tokens.get(key) ?? null, setItem: (key, value) => tokens.set(key, value), removeItem: (key) => tokens.delete(key) },
    window: { setTimeout, dispatchEvent: (event) => events.push(event.type) },
    fetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); },
  });
  return { ...exports, calls, events };
}
const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

test("login sends the authorization-branch contract", async () => {
  const c = client(() => response({ access_token: "test-token", token_type: "bearer", expires_in: 3600, user: { id: "test-user", email: "demo@example.test" } }));
  const result = await c.api.login("demo@example.test", "test-password");
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/login");
  assert.equal(c.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), { email: "demo@example.test", password: "test-password" });
  assert.equal(result.access_token, "test-token");
});

test("registration preserves email-confirmation response", async () => {
  const c = client(() => response({ requires_email_confirmation: true, access_token: null, user: { id: "test-user" } }));
  const result = await c.api.register("Demo User", "demo@example.test", "test-password");
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/register");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), { full_name: "Demo User", email: "demo@example.test", password: "test-password" });
  assert.equal(result.requires_email_confirmation, true);
  assert.equal(result.access_token, null);
  assert.equal(c.session.getToken(), null);
});

test("profile sends bearer token and clears an expired session", async () => {
  const c = client(() => response({ detail: "Invalid authentication credentials" }, 401));
  c.session.setToken("expired-test-token");
  await assert.rejects(c.api.me(), (error) => error.status === 401);
  assert.equal(c.calls[0].init.headers.get("Authorization"), "Bearer expired-test-token");
  assert.equal(c.session.getToken(), null);
  assert.deepEqual(c.events, ["signalgen:unauthorized"]);
});

test("validation arrays become readable errors", async () => {
  const c = client(() => response({ detail: [{ loc: ["body", "full_name"], msg: "String too short" }] }, 422));
  await assert.rejects(c.api.register(" ", "demo@example.test", "test-password"), (error) => error.status === 422 && typeof error.message === "string" && !error.message.includes("[object Object]"));
});

test("offline profile request preserves the session for retry", async () => {
  const c = client(() => { throw new TypeError("Network unavailable"); });
  c.session.setToken("test-token");
  await assert.rejects(c.api.me(), (error) => error.status === 0);
  assert.equal(c.session.getToken(), "test-token");
});

test("invalid login has a useful error without profile reset", async () => {
  const c = client(() => response({ detail: "Invalid email or password" }, 401));
  await assert.rejects(c.api.login("demo@example.test", "wrong"), (error) => error.message.includes("Email atau password"));
  assert.deepEqual(c.events, []);
});

test("password reset request uses the backend authorization contract", async () => {
  const c = client(() => response({ message: "sent" }));
  await c.api.requestPasswordReset("demo@example.test");
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/password/reset-request");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), { email: "demo@example.test" });
});

test("password reset confirmation forwards recovery tokens only to backend", async () => {
  const c = client(() => response({ message: "updated" }));
  await c.api.resetPassword("access", "refresh", "new-secret-123");
  assert.equal(c.calls[0].url, "https://api.example.test/api/auth/password/reset");
  assert.deepEqual(JSON.parse(c.calls[0].init.body), {
    access_token: "access",
    refresh_token: "refresh",
    password: "new-secret-123",
  });
});

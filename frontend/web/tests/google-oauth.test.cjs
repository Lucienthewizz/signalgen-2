const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto").webcrypto;
const lib = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/api/google-oauth.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: lib, crypto, TextEncoder, Uint8Array, btoa, URL, Date, Number },
);
const origin = "http://localhost:5174";
function storage() {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    data,
  };
}
test("PKCE uses random per-tab verifier, S256 challenge and one-time consumption", async () => {
  const s = storage(),
    proof = await lib.createGoogleProof(s, origin);
  assert.equal(proof.redirect_to, origin + "/auth/google/callback");
  const input = lib.consumeGoogleCallback(
    s,
    proof.redirect_to + "?code=one-time",
  );
  assert.equal(input.code, "one-time");
  assert.match(input.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(input.code_verifier),
      ),
    ).toString("base64url"),
    proof.code_challenge,
  );
  assert.throws(
    () => lib.consumeGoogleCallback(s, proof.redirect_to + "?code=one-time"),
    /expired/,
  );
  const next = await lib.createGoogleProof(s, origin);
  assert.notEqual(next.code_challenge, proof.code_challenge);
});
test("missing/foreign/expired/cancelled callbacks fail closed and clear proof", async () => {
  for (const mode of [
    "foreign",
    "expired",
    "future",
    "malformed",
    "cancelled",
    "missing-code",
    "wrong-path",
  ]) {
    const s = storage(),
      proof = await lib.createGoogleProof(s, origin),
      key = [...s.data.keys()][0];
    let callback = proof.redirect_to + "?code=test";
    if (mode === "foreign")
      callback = callback.replace("localhost", "127.0.0.1");
    if (mode === "wrong-path")
      callback = callback.replace("/auth/google/callback", "/other");
    if (mode === "cancelled")
      callback =
        proof.redirect_to +
        "?error=access_denied&error_description=private-text";
    if (mode === "missing-code") callback = proof.redirect_to;
    if (mode === "malformed") s.setItem(key, "broken");
    if (["expired", "future"].includes(mode)) {
      const flow = JSON.parse(s.getItem(key));
      flow.createdAt = Date.now() + (mode === "future" ? 60000 : -660000);
      s.setItem(key, JSON.stringify(flow));
    }
    assert.throws(() => lib.consumeGoogleCallback(s, callback));
    assert.equal(s.data.size, 0);
  }
});
test("leaving login before proof generation finishes cannot persist a pending flow", async () => {
  const s = storage(),
    c = new AbortController();
  c.abort();
  await assert.rejects(lib.createGoogleProof(s, origin, c.signal));
  assert.equal(s.data.size, 0);
});
test("Google return destinations are allowlisted and captured only in this tab's proof", async () => {
  const s = storage();
  const proof = await lib.createGoogleProof(
    s,
    origin,
    undefined,
    "app/journal",
  );
  assert.equal(
    lib.consumeGoogleCallback(s, proof.redirect_to + "?code=test").destination,
    "app/journal",
  );
  for (const invalid of [
    "https://evil.test",
    "//evil.test",
    "#app/journal",
    "app/operator?token=secret",
    "javascript:alert(1)",
    null,
  ])
    assert.equal(lib.safeGoogleDestination(invalid), "app/overview");
});

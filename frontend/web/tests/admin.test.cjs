const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/admin.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: exportsForTest },
);
const { validateAdminChange } = exportsForTest;
const uuid = "11111111-2222-3333-4444-555555555555";
const now = Date.parse("2026-10-06T00:00:00Z");

test("admin changes require a UUID target and an audit reason", () => {
  assert.match(
    validateAdminChange("email@example.test", "Approved", "role", "", now),
    /User ID/,
  );
  assert.match(validateAdminChange(uuid, "  ", "revoke", "", now), /reason/);
  assert.match(
    validateAdminChange(uuid, "a".repeat(501), "role", "", now),
    /500/,
  );
  assert.equal(
    validateAdminChange(` ${uuid} `, "Approved", "role", "", now),
    null,
  );
});

test("grants and subscriptions reject invalid, past and immediate expiry", () => {
  for (const action of ["grant", "subscription"]) {
    for (const expiry of [
      "",
      "invalid",
      "2026-10-05T00:00:00Z",
      "2026-10-06T00:00:00Z",
    ]) {
      assert.match(
        validateAdminChange(uuid, "Approved", action, expiry, now),
        /future/,
      );
    }
    assert.equal(
      validateAdminChange(
        uuid,
        "Approved",
        action,
        "2026-10-07T00:00:00Z",
        now,
      ),
      null,
    );
  }
});

test("revocation and role changes do not require an expiry", () => {
  assert.equal(validateAdminChange(uuid, "End trial", "revoke", "", now), null);
  assert.equal(
    validateAdminChange(uuid, "Approved operator", "role", "", now),
    null,
  );
});

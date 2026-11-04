const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const calendar = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/calendar.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: calendar },
);
test("calendar dates reject rollover and retain their trading session day", () => {
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-2-1",
    "bad",
  ])
    assert.equal(calendar.parseCalendarDate(value), undefined);
  for (const value of ["2024-02-29", "2026-11-04", "0099-01-01"])
    assert.equal(
      calendar.calendarDateValue(calendar.parseCalendarDate(value)),
      value,
    );
});
test("Singapore display crosses midnight at UTC 16:00 regardless of browser timezone", () => {
  assert.equal(
    calendar.singaporeDateTime(new Date("2026-11-03T15:59:00Z")),
    "2026-11-03T23:59",
  );
  assert.equal(
    calendar.singaporeDateTime(new Date("2026-11-03T16:00:00Z")),
    "2026-11-04T00:00",
  );
  assert.equal(
    calendar.singaporeDateTime(new Date("2026-12-31T17:15:00Z")),
    "2027-01-01T01:15",
  );
});
test("Singapore date-time input is converted to canonical UTC without host timezone assumptions", () => {
  assert.equal(
    calendar.singaporeToUTC("2026-11-04T00:00"),
    "2026-11-03T16:00:00.000Z",
  );
  assert.equal(
    calendar.singaporeToUTC("2026-11-04T12:30"),
    "2026-11-04T04:30:00.000Z",
  );
  for (const value of [
    "2026-02-30T12:30",
    "2026-11-04T24:00",
    "",
    "2026-11-04",
  ])
    assert.equal(calendar.singaporeToUTC(value), "");
});
test("calendar validation preserves optional clearing, required form checks, and min/max limits", () => {
  assert.equal(calendar.calendarValueError(""), "");
  assert.equal(
    calendar.calendarValueError(
      "2024-02-29",
      false,
      "2024-02-29",
      "2024-02-29",
    ),
    "",
  );
  assert.match(
    calendar.calendarValueError("2026-11-03", false, "2026-11-04"),
    /later/,
  );
  assert.match(
    calendar.calendarValueError("2026-11-05", false, undefined, "2026-11-04"),
    /earlier/,
  );
  assert.match(calendar.calendarValueError("2026-02-30"), /valid date/);
  assert.equal(calendar.calendarValueError("2026-11-04T09:00", true), "");
});

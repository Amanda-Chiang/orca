import { test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarEvent } from "../../src/lib/data.ts";
import { activeFilters, filterEntries, monthDays, NO_FILTER, readFilter, shiftAnchor, toggle, weekDays, writeFilter } from "../../src/lib/course/calendar-view.ts";

const ev = (id: string, kind: CalendarEvent["kind"], courseId?: string): CalendarEvent => ({ id, date: "2026-11-10", kind, title: id, courseId });
const events = [ev("ds-exam", "exam", "ds"), ev("ds-rev", "rev", "ds"), ev("cs-hw", "hw", "cs"), ev("cs-lab", "lab", "cs"), ev("cs-dive", "dive", "cs"), ev("loose", "hw")];

test("course and type filters combine; lab counts as homework; no filter shows everything", () => {
  const ids = (f: Parameters<typeof filterEntries>[1]) => filterEntries(events, f).map((e) => e.id);
  assert.deepEqual(ids(NO_FILTER), events.map((e) => e.id));
  assert.deepEqual(ids({ courses: new Set(["cs"]), types: null }), ["cs-hw", "cs-lab", "cs-dive"]);
  assert.deepEqual(ids({ courses: null, types: new Set(["hw"]) }), ["cs-hw", "cs-lab", "loose"]);
  assert.deepEqual(ids({ courses: new Set(["cs"]), types: new Set(["hw", "exam"]) }), ["cs-hw", "cs-lab"]);
  assert.equal(activeFilters({ courses: new Set(["cs"]), types: new Set(["hw"]) }), 2);
});

test("the URL round-trips the filter, and a stale link (a deleted course, a made-up type) falls back to all", () => {
  const f = { courses: new Set(["ds"]), types: new Set(["exam", "dive"] as const) };
  const params = writeFilter(f, new URLSearchParams("view=week"));
  assert.equal(params.get("view"), "week");
  assert.deepEqual(readFilter(params, ["ds", "cs"]), f);
  assert.deepEqual(readFilter(new URLSearchParams("courses=gone&types=nope"), ["ds"]), NO_FILTER);
  assert.equal(writeFilter(NO_FILTER, params).toString(), "view=week");
});

test("toggling from all unticks one; unticking the last or ticking the last missing one returns to all", () => {
  const all = ["a", "b", "c"];
  const one = toggle(null, "a", all);
  assert.deepEqual(one, new Set(["b", "c"]));
  assert.equal(toggle(one, "a", all), null);
  assert.equal(toggle(new Set(["b"]), "b", all), null);
});

test("month and week days start on Sunday, and paging moves a month (to the 1st) or a week", () => {
  const month = monthDays("2026-11-24");
  assert.equal(month.length, 42);
  assert.equal(month[0], "2026-11-01"); // Nov 1 2026 is a Sunday
  assert.deepEqual(weekDays("2026-11-24"), ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
  assert.equal(shiftAnchor("2026-11-24", "month", 1), "2026-12-01");
  assert.equal(shiftAnchor("2026-01-15", "month", -1), "2025-12-01");
  assert.equal(shiftAnchor("2026-11-24", "week", -1), "2026-11-17");
});

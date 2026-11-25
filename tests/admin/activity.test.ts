import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActivityDay, activityGaps, activityStrip, daysBetween } from "../../src/lib/admin/activity.ts";

const d = (day: string, beats = 1): ActivityDay => ({ day, firstAt: `${day}T10:00:00Z`, lastAt: `${day}T11:00:00Z`, beats });

test("gaps of seven days or more are listed oldest first, and an open one ends in null", () => {
  const days = [d("2026-11-01"), d("2026-11-02"), d("2026-11-12"), d("2026-11-13"), d("2026-11-14")];
  assert.deepEqual(activityGaps(days, "2026-11-25"), [
    { from: "2026-11-02", to: "2026-11-12", days: 9 },
    { from: "2026-11-14", to: null, days: 11 },
  ]);
});

test("a short break is not a gap, and nothing is a gap for an account seen today", () => {
  assert.deepEqual(activityGaps([d("2026-11-20"), d("2026-11-23"), d("2026-11-25")], "2026-11-25"), []);
  assert.deepEqual(activityGaps([], "2026-11-25"), []);
});

test("the strip covers the last n days ending today, marking the active ones", () => {
  const strip = activityStrip([d("2026-11-24", 3)], "2026-11-25", 3);
  assert.deepEqual(strip, [
    { day: "2026-11-23", active: false, beats: 0 },
    { day: "2026-11-24", active: true, beats: 3 },
    { day: "2026-11-25", active: false, beats: 0 },
  ]);
  assert.equal(daysBetween("2026-11-01", "2026-12-01"), 30);
});

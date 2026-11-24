import test from "node:test";
import assert from "node:assert/strict";
import { claudeMinutesByDay } from "../../src/lib/course/cram-page.ts";

test("a day's time with Claude is what it logged or the estimate from its evidence, whichever is more, never both", () => {
  const estimated = new Map([["2026-11-15", 40], ["2026-11-16", 90]]);
  const out = claudeMinutesByDay(estimated, { "2026-11-16": 240, "2026-11-17": 60, "2026-11-15": 10 });
  assert.deepEqual([...out].sort(), [["2026-11-15", 40], ["2026-11-16", 240], ["2026-11-17", 60]]);
  assert.deepEqual([...claudeMinutesByDay(estimated, {})], [...estimated]);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { ExamScope } from "../../src/lib/data.ts";
import { HISTORY_MAX, describeScopeChange, withHistory } from "../../src/lib/course/scope-history.ts";

const o = (id: string, weight: number) => ({ objectiveId: id, weight, evidence: [] });
const before: ExamScope = { objectives: [o("a", 1), o("b", 0), o("c", 0)], sources: ["professor"], budget: { hours: 22, daysOut: [], since: "2026-11-15T09:00:00.000Z", perDay: { "2026-11-16": 8, "2026-11-17": 14 } } };

test("a scope edit says what changed, in words, and nothing when nothing did", () => {
  assert.equal(describeScopeChange(before, before), null);
  const after: ExamScope = { ...before, objectives: [o("a", 1), o("b", 1), o("c", 0)], budget: { ...before.budget!, hours: 16, perDay: { "2026-11-16": 8, "2026-11-17": 8 } }, problemTypes: [{ id: "cs", name: "Charge sharing", objectiveIds: [], materialIds: [] }], reservedMaterialId: "m" };
  assert.equal(describeScopeChange(before, after, { before: "2026-11-13", after: "2026-11-18" }), "date 2026-11-13 → 2026-11-18; objectives excluded 2 → 1 (of 3 listed); budget 22 h → 16 h; kinds of problem 0 → 1; reserved exam set");
  assert.equal(describeScopeChange(before, { ...before, budget: { ...before.budget!, perDay: { "2026-11-16": 10, "2026-11-17": 12 } } }), "hours moved between days");
  assert.equal(describeScopeChange(null, before), "objectives excluded 0 → 2 (of 3 listed); budget none → 22 h");
});

test("the history carries over from the scope before, names who made the edit, and keeps the last thirty", () => {
  const first = withHistory(null, before, "student", "2026-11-15T09:00:00.000Z")!;
  assert.deepEqual(first.history, [{ at: "2026-11-15T09:00:00.000Z", by: "student", what: "objectives excluded 0 → 2 (of 3 listed); budget none → 22 h" }]);
  // Claude resends the scope without the history: it's kept, and the edit is Claude's.
  const second = withHistory(first, { ...before, objectives: [o("a", 1), o("b", 1), o("c", 1)] }, "claude", "2026-11-16T07:06:00.000Z")!;
  assert.deepEqual(second.history?.map((h) => [h.by, h.what]), [["student", first.history![0].what], ["claude", "objectives excluded 2 → 0 (of 3 listed)"]]);
  assert.deepEqual(withHistory(second, second, "claude", "2026-11-16T08:00:00.000Z")!.history, second.history, "no change, no entry");
  let scope = second;
  for (let i = 0; i < 40; i++) scope = withHistory(scope, { ...scope, budget: { ...before.budget!, hours: i } }, "student", `2026-11-17T00:00:${String(i).padStart(2, "0")}.000Z`)!;
  assert.equal(scope.history!.length, HISTORY_MAX);
  assert.equal(withHistory(null, null, "student", "x"), null);
});

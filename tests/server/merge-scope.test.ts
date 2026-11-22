import test from "node:test";
import assert from "node:assert/strict";
import type { ExamScope } from "../../src/lib/data.ts";

/**
 * set_exam's scope merge (cram mode contract, section 6, per-day addendum): a scope with objectives
 * replaces the exam's; one with only a budget keeps the exam's scope and merges the budget over
 * the exam's. Loads the server connector module through tests/support/hooks.mjs; nothing here
 * touches a database.
 */
const ctx = { today: "2026-11-12", examDate: "2026-11-15", now: "2026-11-12T15:00:00.000Z" };
const OBJ = "f0000000-0000-4000-8000-000000000001";
const kept: ExamScope = {
  objectives: [{ objectiveId: OBJ, weight: 2, evidence: [{ signal: "professor", strength: "strong", quote: "chapters 3 to 5" }] }],
  sources: ["professor"],
  materialIds: ["m1"],
  budget: { hours: 4, daysOut: [], since: "2026-11-11T09:00:00.000Z", perDay: { "2026-11-11": 1, "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 } },
};

test("a budget-only scope keeps the exam's objectives, sources and materials and merges the budget; a full scope replaces them and keeps the budget", async () => {
  const { mergeScope } = await import("../../src/lib/server/connector.ts");
  const todayOnly = mergeScope(kept, { budget: { today: 2.5 } }, ctx);
  assert.deepEqual(todayOnly, { ...kept, budget: { hours: 5.5, daysOut: [], since: kept.budget!.since, perDay: { ...kept.budget!.perDay, "2026-11-12": 2.5 } } });
  // The scope resent (Edit scope from the chat) without a budget keeps the exam's budget.
  const resent = mergeScope(kept, { objectives: [], sources: ["guess"], materialIds: ["m2"] }, ctx);
  assert.deepEqual(resent, { objectives: [], sources: ["guess"], materialIds: ["m2"], budget: kept.budget });
  // No exam scope yet: a budget-only call makes one with the assumed 2 hours a day as the base.
  const fresh = mergeScope(null, { budget: { perDay: { "2026-11-13": 0 } } }, ctx);
  assert.deepEqual(fresh, { objectives: [], sources: [], budget: { hours: 4, daysOut: ["2026-11-13"], since: ctx.now, perDay: { "2026-11-12": 2, "2026-11-13": 0, "2026-11-14": 2 } } });
  // The old form on a fresh exam: a total spread over the days from since.
  const total = mergeScope(null, { objectives: [], sources: [], budget: { hours: 6, daysOut: [], since: "2026-11-12T09:00:00.000Z" } }, ctx);
  assert.deepEqual(total.budget, { hours: 6, daysOut: [], since: "2026-11-12T09:00:00.000Z", perDay: { "2026-11-12": 2, "2026-11-13": 2, "2026-11-14": 2 } });
});

test("patchObjectives changes only the objectives named; the rest keep their weights, sources join, the budget stays", async () => {
  const { mergeScope } = await import("../../src/lib/server/connector.ts");
  const OTHER = "f0000000-0000-4000-8000-000000000002";
  const two: ExamScope = { ...kept, objectives: [...kept.objectives, { objectiveId: OTHER, weight: 0, evidence: [] }] };
  const out = mergeScope(two, { objectives: [{ objectiveId: OTHER, weight: 1, evidence: [] }], sources: ["guess"], patchObjectives: true }, ctx);
  assert.deepEqual(out.objectives.map((o) => [o.objectiveId, o.weight]), [[OBJ, 2], [OTHER, 1]]);
  assert.deepEqual(out.sources, ["professor", "guess"]);
  assert.deepEqual(out.materialIds, ["m1"]);
  assert.deepEqual(out.budget, kept.budget);
});

test("the rules, the exam map, the reservation and the student's worries stay when a scope is resent; null clears the reservation", async () => {
  const { mergeScope } = await import("../../src/lib/server/connector.ts");
  const types = [{ id: "cs", name: "Charge sharing", objectiveIds: [OBJ], materialIds: ["m1"] }];
  const mapped: ExamScope = { ...kept, worries: "signs", rules: { notes: "none" }, problemTypes: types, reservedMaterialId: "m9" };
  const resent = mergeScope(mapped, { objectives: [], sources: ["guess"] }, ctx);
  assert.deepEqual([resent.worries, resent.rules, resent.problemTypes, resent.reservedMaterialId], ["signs", { notes: "none" }, types, "m9"]);
  assert.deepEqual(resent.budget, kept.budget);
  const patched = mergeScope(mapped, { problemTypes: [], reservedMaterialId: null }, ctx);
  assert.deepEqual([patched.problemTypes, patched.reservedMaterialId, patched.objectives], [[], undefined, kept.objectives]);
  assert.equal(mergeScope(mapped, { reservedMaterialId: "m2" }, ctx).reservedMaterialId, "m2");
});

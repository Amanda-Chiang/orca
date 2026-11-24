import test from "node:test";
import assert from "node:assert/strict";
import { examReadiness, typePlanTopics, typesTouchedSince, type ProblemAttempt } from "../../src/lib/course/readiness.ts";
import { cramPlan } from "../../src/lib/mastery/cram-plan.ts";

const types = [
  { id: "cs", name: "Charge sharing", objectiveIds: [], materialIds: ["f25", "f23", "f22"] },
  { id: "rlc", name: "RLC design", objectiveIds: [], materialIds: ["f25"] },
  { id: "de", name: "Op-amp DE", objectiveIds: [], materialIds: ["f25", "f23"] },
  { id: "ac", name: "AC source transformation", objectiveIds: [], materialIds: [] },
];
const at = (day: number, typeId: string, outcome: ProblemAttempt["outcome"], cold: boolean, extra: Partial<ProblemAttempt> = {}): ProblemAttempt => ({ typeId, at: `2026-11-${String(day).padStart(2, "0")}T15:00:00.000Z`, outcome, cold, ...extra });

test("only a cold solve says ready; the latest attempt decides; a kind with no attempt is untested", () => {
  const r = examReadiness(types, [
    at(15, "cs", "shown", true, { errorNote: "conserved energy, not charge" }),
    at(16, "cs", "solved", true),
    at(16, "rlc", "solved", false),
    at(16, "de", "solved", true),
    at(17, "de", "stuck", true, { errorNote: "missed the feedback branch" }),
  ]);
  assert.deepEqual(r.types.map((t) => [t.id, t.exams, t.state, t.attempts]), [["cs", 3, "ready", 2], ["de", 2, "not-yet", 2], ["ac", 1, "untested", 0], ["rlc", 1, "shaky", 1]]);
  assert.deepEqual([r.ready, r.total], [1, 4]);
  // Weighed by how many exams ask each: (3 × 1 + 2 × 0 + 1 × 0 + 1 × 0.5) / 7.
  assert.equal(r.share, 3.5 / 7);
  assert.equal(r.types[0].lastError, "conserved energy, not charge");
  assert.equal(r.measured, null);
  assert.deepEqual(examReadiness(types, []).types.map((t) => t.state), ["untested", "untested", "untested", "untested"]);
});

test("the measured score is the reserved exam's latest sitting, summed over its problems", () => {
  const r = examReadiness(types, [
    at(10, "cs", "solved", true, { mockMaterialId: "old", points: 5, outOf: 25 }),
    at(17, "cs", "solved", true, { mockMaterialId: "f22", points: 20, outOf: 25 }),
    at(17, "de", "with-hints", true, { mockMaterialId: "f22", points: 10, outOf: 25 }),
    at(17, "rlc", "stuck", true),
  ]);
  assert.deepEqual(r.measured, { materialId: "f22", points: 30, outOf: 50, at: "2026-11-17T15:00:00.000Z" });
});

test("with a map the plan's units are the kinds of problem: ready ones are done, the diagnostic is a cold problem each, recurrence sets the order", () => {
  const budget = { hours: 6, daysOut: [], since: "2026-11-16T09:00:00.000Z", perDay: { "2026-11-16": 3, "2026-11-17": 3 } };
  const base = { today: "2026-11-16", examDate: "2026-11-18", budget, spentMinutes: { beforeToday: 0, today: 0 }, unit: "problem-type" as const };
  const fresh = cramPlan({ ...base, topics: typePlanTopics(examReadiness(types, [])), touchedObjectiveIds: [] });
  assert.equal(fresh.unit, "problem-type");
  assert.deepEqual(fresh.diagnostic, { minutes: 50, topicIds: ["cs", "de", "ac", "rlc"] });
  assert.match(fresh.line, /Today: a cold exam-style problem for each kind, then Charge sharing/);
  assert.match(fresh.line, /Ready for 0 of 4 kinds of problem\./);
  // After the diagnostic: charge sharing is ready (done), the op-amp DE was missed (a weak spot, first), the rest untested.
  const attempts = [at(16, "cs", "solved", true), at(16, "de", "stuck", true)];
  const after = cramPlan({ ...base, topics: typePlanTopics(examReadiness(types, attempts)), touchedObjectiveIds: typesTouchedSince(attempts, budget.since) });
  assert.equal(after.diagnostic, null);
  assert.deepEqual(after.verified, { done: 1, total: 4, share: 0.25 });
  assert.equal(after.today[0].topicId, "de");
  assert.ok(after.topics.find((t) => t.id === "cs")!.done);
  assert.deepEqual(typesTouchedSince(attempts, "2026-11-17T00:00:00.000Z"), []);
});

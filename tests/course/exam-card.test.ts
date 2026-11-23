import test from "node:test";
import assert from "node:assert/strict";
import type { ExamScope, Objective, Topic } from "../../src/lib/data.ts";
import { NOT_IN_FILES, cardExam, crammingExam, examTopicIds, daysUntil, examObjectives, objectiveMaterialIds, protectScope, scopeFromSetup, splitByMaterials } from "../../src/lib/course/exam-card.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id, review: "confirmed", pos: { x: 0, y: 0 }, source: [], ...extra });
const objective = (id: string, topicId: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId, name: id, description: "", origin: "material", review: "confirmed", materialId: "m", runId: "r", signals: [], ...extra });
const exam = (date: string, extra: Partial<{ cramming: boolean; courseId: string }> = {}) => ({ courseId: "c", date, cramming: false, ...extra });

const topics = [topic("t1"), topic("t2"), topic("old", { mergedInto: "t2" }), topic("gone", { review: "archived" })];
const objectives = {
  a: objective("a", "t1"),
  b: objective("b", "t2"),
  c: objective("c", "old"),
  d: objective("d", "t1", { review: "archived" }),
  e: objective("e", "gone"),
};

test("the card shows the cramming exam first, else the soonest exam from today on", () => {
  assert.equal(cardExam([exam("2026-11-20"), exam("2026-11-12"), exam("2026-11-09")], "c", "2026-11-10")?.date, "2026-11-12");
  assert.equal(cardExam([exam("2026-11-12"), exam("2026-12-20", { cramming: true })], "c", "2026-11-10")?.date, "2026-12-20");
  assert.equal(cardExam([exam("2026-11-10")], "c", "2026-11-10")?.date, "2026-11-10", "today's exam still shows");
  assert.equal(cardExam([exam("2026-11-09"), exam("2026-11-12", { courseId: "d" })], "c", "2026-11-10"), null);
});

test("days left are whole days, 0 on the day", () => {
  assert.equal(daysUntil("2026-11-15", "2026-11-10"), 5);
  assert.equal(daysUntil("2026-11-10", "2026-11-10"), 0);
  assert.equal(daysUntil("2026-03-30", "2026-03-27"), 3, "daylight saving doesn't skip a day");
  assert.equal(daysUntil("2026-11-09", "2026-11-10"), -1);
});

test("an exam covers its topics' live objectives (merges followed), every topic when it names none", () => {
  assert.deepEqual(examObjectives({ topicIds: ["t1"], scope: null }, topics, objectives), ["a"]);
  assert.deepEqual(examObjectives({ topicIds: ["old"], scope: null }, topics, objectives), ["b", "c"], "a merged topic's objectives count under its survivor");
  assert.deepEqual(examObjectives({ topicIds: [], scope: null }, topics, objectives), ["a", "b", "c"]);
  assert.deepEqual(examObjectives({ topicIds: ["gone"], scope: null }, topics, objectives), []);
});

test("with a scope, the card counts the listed objectives that weigh more than 0", () => {
  const scope: ExamScope = { objectives: [{ objectiveId: "a", weight: 2, evidence: [] }, { objectiveId: "b", weight: 0, evidence: [] }, { objectiveId: "d", weight: 1, evidence: [] }], sources: ["professor"] };
  assert.deepEqual(examObjectives({ topicIds: [], scope }, topics, objectives), ["a"], "excluded and archived ones don't count");
  assert.deepEqual(examObjectives({ topicIds: ["t1"], scope: { objectives: [], sources: [] } }, topics, objectives), ["a"], "an empty scope falls back to the topics");
});

test("the setup's scope lists every covered objective at weight 1 with the professor's words; without words it's unchanged", () => {
  assert.equal(scopeFromSetup(null, ["a", "b"], "  "), null);
  const made = scopeFromSetup(null, ["a", "b"], "Chapters 3 and 4, no proofs.")!;
  assert.deepEqual(made.sources, ["professor"]);
  assert.deepEqual(
    made.objectives,
    ["a", "b"].map((objectiveId) => ({ objectiveId, weight: 1, evidence: [{ signal: "professor", strength: "strong", quote: "Chapters 3 and 4, no proofs." }] })),
  );
  // Editing keeps earlier weights and other evidence, replaces the professor's quote, and keeps the format.
  const before: ExamScope = {
    objectives: [{ objectiveId: "a", weight: 3, evidence: [{ signal: "practice-exam", strength: "strongest" }, { signal: "professor", strength: "strong", quote: "old" }] }],
    format: { minutes: 90 },
    sources: ["practice-exam", "professor"],
  };
  const edited = scopeFromSetup(before, ["a", "b"], "new")!;
  assert.deepEqual(edited.objectives[0], { objectiveId: "a", weight: 3, evidence: [{ signal: "practice-exam", strength: "strongest" }, { signal: "professor", strength: "strong", quote: "new" }] });
  assert.deepEqual(edited.objectives[1], { objectiveId: "b", weight: 1, evidence: [{ signal: "professor", strength: "strong", quote: "new" }] });
  assert.deepEqual(edited.format, { minutes: 90 });
  assert.deepEqual(edited.sources, ["practice-exam", "professor"]);
  assert.equal(scopeFromSetup(before, ["a"], ""), before);
});

test("the picked materials split the candidates: an objective is in scope when the material that created it or one its signals name was picked", () => {
  const signal = (materialId: string) => ({ materialId, materialType: "Lecture" as const, places: [] });
  const catalogue = {
    a: objective("a", "t1", { materialId: "m1" }),
    b: objective("b", "t1", { materialId: "m2", signals: [signal("m2"), signal("m1")] }),
    c: objective("c", "t2", { materialId: "m3" }),
    d: objective("d", "t2", { materialId: null, origin: "inferred" }),
  };
  assert.deepEqual(objectiveMaterialIds(catalogue.b), ["m2", "m1"]);
  assert.deepEqual(objectiveMaterialIds(catalogue.d), []);
  assert.deepEqual(splitByMaterials(["a", "b", "c", "d"], ["m1"], catalogue), { inScope: ["a", "b"], excluded: ["c", "d"] });
  assert.deepEqual(splitByMaterials(["a", "b", "c", "d"], [], catalogue), { inScope: ["a", "b", "c", "d"], excluded: [] }, "nothing picked: everything in scope");

  // The scope: picked ones weigh 1 with the professor's words; the rest weigh 0 with a note saying why; the pick is stored.
  const made = scopeFromSetup(null, ["a", "b", "c", "d"], "Lectures 11 to 16.", ["m1"], catalogue)!;
  const words = { signal: "professor", strength: "strong", quote: "Lectures 11 to 16." };
  const out = { signal: "professor", strength: "strong", quote: NOT_IN_FILES };
  assert.deepEqual(made.objectives, [
    { objectiveId: "a", weight: 1, evidence: [words] },
    { objectiveId: "b", weight: 1, evidence: [words] },
    { objectiveId: "c", weight: 0, evidence: [out] },
    { objectiveId: "d", weight: 0, evidence: [out] },
  ]);
  assert.deepEqual([made.sources, made.materialIds], [["professor"], ["m1"]]);
  // Without words, a pick still narrows (no quote on the in-scope ones).
  const silent = scopeFromSetup(null, ["a", "c"], "", ["m1"], catalogue)!;
  assert.deepEqual(silent.objectives, [{ objectiveId: "a", weight: 1, evidence: [] }, { objectiveId: "c", weight: 0, evidence: [out] }]);
  // Re-picking widens again: an objective excluded before comes back at 1, other evidence kept; nothing picked drops the stored pick.
  const widened = scopeFromSetup({ ...made, objectives: made.objectives.map((o) => (o.objectiveId === "c" ? { ...o, evidence: [{ signal: "homework", strength: "medium" }, ...o.evidence] } : o)) }, ["a", "b", "c", "d"], "All of it.", [], catalogue)!;
  assert.deepEqual(widened.objectives.map((o) => [o.objectiveId, o.weight]), [["a", 1], ["b", 1], ["c", 1], ["d", 1]]);
  assert.deepEqual(widened.objectives[2].evidence, [{ signal: "homework", strength: "medium" }, { signal: "professor", strength: "strong", quote: "All of it." }]);
  assert.equal("materialIds" in widened, false);
});

test("a past exam is done: the card skips it even while its cramming flag is still on", () => {
  assert.equal(cardExam([exam("2026-11-13", { cramming: true })], "c", "2026-11-15"), null);
  assert.equal(cardExam([exam("2026-11-13", { cramming: true }), exam("2026-11-20")], "c", "2026-11-15")?.date, "2026-11-20");
});

test("a file pick keeps a topic's unanchored objectives and weak spots when the topic is in scope, and drops them when it isn't", () => {
  const cat = {
    rc1: objective("rc1", "rc", { materialId: "practice" }),
    rc2: objective("rc2", "rc", { materialId: "lecture" }),
    rcFlag: objective("rcFlag", "rc", { materialId: null }),
    op1: objective("op1", "op", { materialId: "lecture" }),
    opFlag: objective("opFlag", "op", { materialId: null }),
  };
  const split = splitByMaterials(Object.keys(cat), ["practice"], cat, new Set(["rc2", "opFlag"]));
  assert.deepEqual(split.inScope.sort(), ["rc1", "rc2", "rcFlag"]);
  assert.deepEqual(split.excluded.sort(), ["op1", "opFlag"]);
});

test("protectScope puts back a file-pick zero on a weak spot or unanchored objective of an in-scope topic, not a professor's exclusion", () => {
  const zero = (id: string, quote = NOT_IN_FILES) => ({ objectiveId: id, weight: 0, evidence: [{ signal: "professor" as const, strength: "strong" as const, quote }] });
  const scope: ExamScope = { objectives: [{ objectiveId: "rc1", weight: 1, evidence: [] }, zero("rcFlag"), zero("rcSaid", "no RL circuits"), zero("op1"), zero("opFlag")], sources: ["professor"], materialIds: ["practice"] };
  const lines = [
    { id: "rc1", topicId: "rc", materialIds: ["practice"], weak: false },
    { id: "rcFlag", topicId: "rc", materialIds: [], weak: true },
    { id: "rcSaid", topicId: "rc", materialIds: [], weak: true },
    { id: "op1", topicId: "op", materialIds: ["lecture"], weak: false },
    { id: "opFlag", topicId: "op", materialIds: [], weak: true },
  ];
  const { scope: out, raised } = protectScope(scope, lines);
  assert.deepEqual(raised, ["rcFlag"]);
  assert.deepEqual(out.objectives.find((o) => o.objectiveId === "rcFlag"), { objectiveId: "rcFlag", weight: 1, evidence: [] });
  assert.equal(out.objectives.find((o) => o.objectiveId === "rcSaid")?.weight, 0);
  assert.equal(out.objectives.find((o) => o.objectiveId === "opFlag")?.weight, 0);
  // Without a file pick nothing changes.
  assert.deepEqual(protectScope({ ...scope, materialIds: undefined }, lines).raised, []);
});

test("cram mode: the course's cramming exam from today on; a past one has ended it", () => {
  assert.equal(crammingExam([exam("2026-11-20"), exam("2026-11-25", { cramming: true })], "c", "2026-11-22")?.date, "2026-11-25");
  assert.equal(crammingExam([exam("2026-11-22", { cramming: true })], "c", "2026-11-22")?.date, "2026-11-22", "on the exam's day it's still on");
  assert.equal(crammingExam([exam("2026-11-21", { cramming: true })], "c", "2026-11-22"), null, "the day after, it's off");
  assert.equal(crammingExam([exam("2026-11-25")], "c", "2026-11-22"), null, "an exam not crammed for isn't cram mode");
  assert.equal(crammingExam([exam("2026-11-25", { cramming: true, courseId: "d" })], "c", "2026-11-22"), null);
});

test("the exam's topics: those holding an objective in scope, merges followed", () => {
  assert.deepEqual([...examTopicIds({ topicIds: ["t1"], scope: null }, topics, objectives)], ["t1"]);
  assert.deepEqual([...examTopicIds({ topicIds: ["old"], scope: null }, topics, objectives)], ["t2"], "a merged topic counts as its survivor");
  const scope = { sources: [], objectives: [{ objectiveId: "b", weight: 1, evidence: [] }, { objectiveId: "a", weight: 0, evidence: [] }] } as ExamScope;
  assert.deepEqual([...examTopicIds({ topicIds: ["t1", "t2"], scope }, topics, objectives)], ["t2"], "weight 0 leaves a topic out");
  assert.deepEqual([...examTopicIds({ topicIds: [], scope: null }, topics, objectives)].sort(), ["t1", "t2"], "no topics named: every live topic with objectives");
});

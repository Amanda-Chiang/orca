import test from "node:test";
import assert from "node:assert/strict";
import { examMap, rulesLine } from "../../src/lib/course/exam-map.ts";

const type = (id: string, name: string, materialIds: string[], objectiveIds: string[] = []) => ({ id, name, objectiveIds, materialIds });

test("the exam map orders problem types by how many mapped exams ask them, and says when too few exams were read", () => {
  assert.equal(examMap(null), null);
  assert.equal(examMap({ problemTypes: [] }), null);
  const two = examMap({ problemTypes: [type("rlc", "RLC design", ["f25"], ["o1", "o2"]), type("cs", "Charge sharing", ["f25", "f23"]), type("de", "Op-amp DE", ["f23", "f23"])] })!;
  assert.equal(two.examsMapped, 2);
  assert.equal(two.uncertain, true, "two exams can't say what recurs");
  assert.deepEqual(two.types.map((t) => [t.id, t.exams, t.objectives]), [["cs", 2, 0], ["de", 1, 0], ["rlc", 1, 2]]);
  const three = examMap({ problemTypes: [type("cs", "Charge sharing", ["f25", "f23", "f22"])] })!;
  assert.deepEqual([three.examsMapped, three.uncertain], [3, false]);
});

test("the rules line names what's known and nothing else", () => {
  assert.equal(rulesLine(undefined), null);
  assert.equal(rulesLine({ text: "Graded on derivations." }), null, "free text is shown apart");
  assert.equal(rulesLine({ notes: "none", calculator: "simple", minutes: 75 }), "Closed book · simple calculator · 75 min");
  assert.equal(rulesLine({ notes: "sheet" }), "Formula sheet allowed");
});

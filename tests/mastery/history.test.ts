import test from "node:test";
import assert from "node:assert/strict";
import { objectiveHistory } from "../../src/lib/mastery/history.ts";
import { masteryPercent } from "../../src/lib/mastery/percent.ts";
import { computeObjectiveState } from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, MarkEvent, Outcome } from "../../src/lib/mastery/types.ts";

const day = (n: number, hour = 12) => new Date(Date.UTC(2027, 0, n, hour)).toISOString();
const options = { hasMechanismQuestions: false, dayKey: (iso: string) => iso.slice(0, 10) };
let seq = 0;
const flag = (when: string, objectiveId = "o"): ConfusionEvent => ({ kind: "confusion", id: `f${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId, materialId: null, note: null, flagSource: "manual", page: null });
const mark = (when: string): MarkEvent => ({ kind: "mark", id: `m${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o" });
const answer = (when: string, outcome: Outcome = "correct"): AnswerEvent => ({ kind: "answer", id: `a${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", questionId: `q${seq}`, tier: null, outcome, grader: "choice", source: "quick-review", sessionId: when.slice(0, 10) });

test("each event's percent before and after chains, oldest first, and ends at the objective's state", () => {
  const events: EvidenceEvent[] = [answer(day(2)), flag(day(1)), answer(day(1, 13)), flag(day(1), "other"), answer(day(3), "incorrect"), mark(day(4))];
  const h = objectiveHistory("o", events, options);
  assert.deepEqual(h.map((x) => x.event.at), [day(1), day(1, 13), day(2), day(3), day(4)]);
  assert.equal(h[0].before, 0);
  // A right answer after a flag moves the percent up; marking mastered takes it to the top.
  assert.ok(h[1].after > h[1].before);
  assert.equal(h[4].statusAfter, "mastered");
  assert.equal(h[4].after, masteryPercent(computeObjectiveState("o", events, new Date(day(4)), options)));
});

test("no events, no history", () => {
  assert.deepEqual(objectiveHistory("o", [flag(day(1), "other")], options), []);
});

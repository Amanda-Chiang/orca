import test from "node:test";
import assert from "node:assert/strict";
import { masteredAt } from "../../src/lib/mastery/mastered-at.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, MarkEvent } from "../../src/lib/mastery/types.ts";

const day = (n: number, hour = 12) => new Date(Date.UTC(2027, 0, n, hour)).toISOString();
const options = { hasMechanismQuestions: false, dayKey: (iso: string) => iso.slice(0, 10) };
let seq = 0;
const flag = (when: string): ConfusionEvent => ({ kind: "confusion", id: `f${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", materialId: null, note: null, flagSource: "manual", page: null });
const mark = (when: string): MarkEvent => ({ kind: "mark", id: `m${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o" });
const answer = (q: string, when: string): AnswerEvent => ({ kind: "answer", id: `a${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", questionId: q, tier: null, outcome: "correct", grader: "choice", source: "quick-review", sessionId: when.slice(0, 10) });

test("the time of the answer that met the bar", () => {
  const events: EvidenceEvent[] = [flag(day(1)), answer("q1", day(1, 13)), answer("q2", day(1, 14)), answer("q3", day(2))];
  assert.equal(masteredAt("o", events, options), day(2));
});

test("a mark masters at its own time; a later flag clears it, a later mark sets it again", () => {
  assert.equal(masteredAt("o", [flag(day(1)), mark(day(3))], options), day(3));
  assert.equal(masteredAt("o", [flag(day(1)), mark(day(3)), flag(day(4))], options), null);
  assert.equal(masteredAt("o", [flag(day(1)), mark(day(3)), flag(day(4)), mark(day(6))], options), day(6));
});

test("never mastered is null", () => {
  assert.equal(masteredAt("o", [flag(day(1)), answer("q1", day(1, 13))], options), null);
});

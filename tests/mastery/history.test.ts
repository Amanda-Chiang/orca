import test from "node:test";
import assert from "node:assert/strict";
import { objectiveHistory } from "../../src/lib/mastery/history.ts";
import { masteryPercent } from "../../src/lib/mastery/percent.ts";
import { computeObjectiveState } from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, MarkEvent, Outcome, SignalEvent, WorkEvent } from "../../src/lib/mastery/types.ts";

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

const work = (when: string, outcome: Outcome): WorkEvent => ({ kind: "work", id: `w${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", problem: "Sign-extend 1011.", basis: "known-answer", outcome, source: "connector", sessionId: "chat" });
const signal = (when: string, s: SignalEvent["signal"]): SignalEvent => ({ kind: "signal", id: `s${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", signal: s, note: null, source: "connector", sessionId: "chat" });

test("every kind of event has an entry, and each entry's before is the previous one's after", () => {
  const events: EvidenceEvent[] = [flag(day(1)), work(day(1, 13), "correct"), signal(day(1, 14), "asked-harder"), answer(day(2)), signal(day(2, 13), "lost"), mark(day(3)), signal(day(4), "got-it")];
  const h = objectiveHistory("o", events, options);
  assert.deepEqual(h.map((x) => x.event.kind), ["confusion", "work", "signal", "answer", "signal", "mark", "signal"]);
  // Before mastery the percent is progress toward the bar, so it doesn't move between events; once
  // mastered it's predicted recall, which drifts down with time (the got-it a day after the mark).
  for (let i = 1; i < 6; i++) assert.equal(h[i].before, h[i - 1].after, `entry ${i} starts where entry ${i - 1} ended`);
  assert.ok(h[6].before <= h[5].after);
  // Claude's problem counts like an answer; asking for something harder changes nothing.
  assert.ok(h[1].after > h[1].before);
  assert.equal(h[2].after, h[2].before);
});

test("a flag on a mastered objective takes the percent down; marking it mastered takes it back up", () => {
  const h = objectiveHistory("o", [flag(day(1)), mark(day(2)), flag(day(3)), mark(day(4))], options);
  assert.equal(h[1].statusAfter, "mastered");
  assert.ok(h[2].after < h[2].before, "the flag after a mark");
  assert.equal(h[2].statusAfter, "learning");
  assert.equal(h[3].statusAfter, "mastered");
  assert.ok(h[3].after > h[3].before);
});

test("events in the same millisecond replay in id order, as replayObjective does", () => {
  const at = day(1);
  const second: AnswerEvent = { ...answer(at), id: "b" };
  const first: ConfusionEvent = { ...flag(at), id: "a" };
  assert.deepEqual(objectiveHistory("o", [second, first], options).map((x) => x.event.id), ["a", "b"]);
});

test("a miss on a mastered objective shows it falling", () => {
  const events: EvidenceEvent[] = [flag(day(1)), mark(day(2))];
  const miss = answer(day(3), "incorrect");
  const h = objectiveHistory("o", [...events, miss], options);
  assert.ok(h[2].after < h[2].before);
});

/**
 * Mastery rules v5 (owner, 2026-11-22: "trust the student"): a weak spot the student marks mastered
 * in the List view is mastered at once, shown as theirs, with a spaced check markedCheckDays later;
 * the next answer or flag takes over as usual.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MASTERY_RULES, replayObjective, stateAt } from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, MarkEvent } from "../../src/lib/mastery/types.ts";

const day = (n: number, hour = 12) => new Date(Date.UTC(2027, 0, n, hour)).toISOString();
const options = { hasMechanismQuestions: false, dayKey: (iso: string) => iso.slice(0, 10) };
const DAY = 86_400_000;

let seq = 0;
const mark = (when: string): MarkEvent => ({ kind: "mark", id: `m${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o" });
const flag = (when: string): ConfusionEvent => ({ kind: "confusion", id: `f${++seq}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", materialId: null, note: null, flagSource: "manual", page: null });
const answer = (questionId: string, when: string, over: Partial<AnswerEvent> = {}): AnswerEvent => ({
  kind: "answer",
  id: `a${++seq}`,
  at: when,
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  questionId,
  tier: null,
  outcome: "correct",
  grader: "choice",
  source: "quick-review",
  sessionId: when.slice(0, 10),
  ...over,
});
const stateOf = (events: EvidenceEvent[], now: string) => stateAt("o", replayObjective("o", events, options), new Date(now));

test("a flagged weak spot marked mastered is mastered at once, marked by the student, with no credit", () => {
  const s = stateOf([flag(day(1)), mark(day(2))], day(3));
  assert.equal(s.status, "mastered");
  assert.equal(s.markedByStudent, true);
  assert.equal(s.credit, 0);
  assert.equal(s.dueAt, new Date(Date.parse(day(2)) + MASTERY_RULES.markedCheckDays * DAY).toISOString());
});

test("a mix-up is cleared by the mark", () => {
  const s = stateOf([answer("q1", day(1), { outcome: "incorrect" }), answer("q2", day(1, 13), { outcome: "incorrect" }), mark(day(2))], day(3));
  assert.equal(s.status, "mastered");
});

test("the spaced check comes due markedCheckDays later; passing it keeps mastery and clears the mark", () => {
  const due = Date.parse(day(2)) + MASTERY_RULES.markedCheckDays * DAY;
  const events: EvidenceEvent[] = [flag(day(1)), mark(day(2))];
  assert.equal(stateOf(events, new Date(due + DAY).toISOString()).status, "fading");
  const passed = stateOf([...events, answer("q1", new Date(due + DAY).toISOString())], new Date(due + 2 * DAY).toISOString());
  assert.equal(passed.status, "mastered");
  assert.equal(passed.markedByStudent, false);
  assert.equal(passed.spacedChecks, 1);
});

test("missing the check after a mark brings it back; a new flag sends it back to learning", () => {
  const due = Date.parse(day(2)) + MASTERY_RULES.markedCheckDays * DAY;
  const missed = stateOf([flag(day(1)), mark(day(2)), answer("q1", new Date(due + DAY).toISOString(), { outcome: "incorrect" })], new Date(due + DAY + 60_000).toISOString());
  assert.equal(missed.status, "fading");
  assert.equal(missed.markedByStudent, false);
  const reflagged = stateOf([flag(day(1)), mark(day(2)), flag(day(3))], day(4));
  assert.equal(reflagged.status, "learning");
  assert.equal(reflagged.markedByStudent, false);
});

test("marking an objective already mastered and not due changes nothing", () => {
  const mastered: EvidenceEvent[] = [flag(day(1)), answer("q1", day(1, 13)), answer("q2", day(1, 14)), answer("q3", day(2))];
  const before = stateOf(mastered, day(2, 13));
  assert.equal(before.status, "mastered");
  const after = stateOf([...mastered, mark(day(2, 13))], day(2, 14));
  assert.equal(after.markedByStudent, false);
  assert.equal(after.dueAt, before.dueAt);
});

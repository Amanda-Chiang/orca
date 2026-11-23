import test from "node:test";
import assert from "node:assert/strict";
import { canRetry, nudgeFor, pickSibling, siblingSlot, spotVerdict } from "../src/lib/quiz/after-miss.ts";

test("a second try for short answers and choice questions with three or more options, never true/false", () => {
  assert.equal(canRetry({ kind: "Short answer", options: [] }), true);
  assert.equal(canRetry({ kind: "Multiple choice", options: ["a", "b", "c", "d"] }), true);
  assert.equal(canRetry({ kind: "Multiple choice", options: ["a", "b"] }), false);
  assert.equal(canRetry({ kind: "True or false", options: ["True", "False"] }), false);
});

test("the nudge names the kind of mistake and never the answer; none without one", () => {
  assert.equal(nudgeFor(null), null);
  assert.match(nudgeFor("units")!, /units/);
  assert.equal(spotVerdict("units", null), null);
  assert.match(spotVerdict("units", "units")!, /same/);
  assert.match(spotVerdict("sign", "concept")!, /idea itself/);
});

test("the sibling is slotted three questions on, or at the end of a short run", () => {
  assert.equal(siblingSlot(0, 10), 4);
  assert.equal(siblingSlot(8, 10), 10);
});

test("the sibling is another question on the objective: unseen first, else the one seen longest ago, never one in the run", () => {
  const qs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(pickSibling(qs, new Set(["a"]), new Map([["b", "2026-11-01"]]))?.id, "c");
  assert.equal(pickSibling(qs, new Set(["a"]), new Map([["b", "2026-11-02"], ["c", "2026-11-01"]]))?.id, "c");
  assert.equal(pickSibling(qs, new Set(["a", "b", "c"]), new Map()), null);
});

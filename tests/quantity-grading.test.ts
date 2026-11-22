import test from "node:test";
import assert from "node:assert/strict";
import { gradeExact, isDontKnow, isExpressionAnswer, quantityOf } from "../src/lib/grading.ts";

test("a number with a unit is a quantity, not an expression, however the number is written", () => {
  assert.deepEqual(quantityOf("2000 A/s"), { value: 2000, unit: "A/s" });
  assert.deepEqual(quantityOf("2,000 A/s"), { value: 2000, unit: "A/s" });
  assert.deepEqual(quantityOf("2e3 A/s"), { value: 2000, unit: "A/s" });
  assert.deepEqual(quantityOf("4.7 kohm"), { value: 4.7, unit: "kΩ" });
  assert.deepEqual(quantityOf("−25 V"), { value: -25, unit: "V" });
  for (const not of ["2000", "0101", "A/s", "a + b", "x'y", "3 apples and 2 pears"]) assert.equal(quantityOf(not), null, not);
  assert.equal(isExpressionAnswer("2000 A/s"), false);
  assert.equal(isExpressionAnswer("a/b"), true, "letters over letters is still an expression");
});

test("a quantity is right by value within 1% and the same unit, with SI prefixes converted; the right number without its unit is partly right", () => {
  const key = ["2000 A/s"];
  for (const right of ["2000 A/s", "2,000 A/s", "2e3 A/s", "2 kA/s", "2000A/s", "1990 A/s", "it is 2000 A/s."]) assert.equal(gradeExact(right, key).outcome, "correct", right);
  for (const partly of ["2000", "2,000", "2000 V"]) assert.equal(gradeExact(partly, key).outcome, "partial", partly);
  for (const wrong of ["200 A/s", "2 A/s", "2100 A/s", "20 kA/s"]) assert.equal(gradeExact(wrong, key).outcome, "incorrect", wrong);
  assert.equal(gradeExact("36.4 ps", ["36.4 ps"]).outcome, "correct");
  assert.equal(gradeExact("0.0364 ns", ["36.4 ps"]).outcome, "correct");
  assert.equal(gradeExact("6000 ohm", ["6 kΩ"]).outcome, "correct");
  assert.equal(gradeExact("500 uF", ["500 µF"]).outcome, "correct");
  // Keys without a unit grade as before: a bit string is never a number.
  assert.equal(gradeExact("101", ["0101"]).outcome, "incorrect");
  assert.equal(gradeExact("0.5", ["1/2"]).outcome, "correct");
});

test("\"I don't know\" is a miss with no guess, in the ways students type it", () => {
  for (const s of ["I don't know", "i dont know", "idk", "IDK.", "no idea", "not sure", "I give up", "skip", "??"]) assert.equal(isDontKnow(s), true, s);
  for (const s of ["I know it's B", "B", "1010", "don't care"]) assert.equal(isDontKnow(s), false, s);
  assert.deepEqual(gradeExact("idk", ["1010"]), { outcome: "incorrect", feedback: "The answer is 1010." });
});

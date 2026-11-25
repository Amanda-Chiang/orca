import test from "node:test";
import assert from "node:assert/strict";
import { NEW_ONBOARDING, TIPS_OFF, mergeOnboarding, onboardingFromProfile, withSeen } from "../../src/lib/onboarding/state.ts";

test("a seen tip is added once, in the order seen", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.deepEqual(a, { seen: ["add-course"], skipped: false });
  assert.deepEqual(withSeen(a, ["island", "add-course"]).seen, ["add-course", "island"]);
});

test("nothing new returns the same object, so callers can tell there is nothing to save", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.equal(withSeen(a, ["add-course"]), a);
  assert.equal(withSeen(a, []), a);
});

test("a profile's value is read as stored; a malformed one throws", () => {
  assert.deepEqual(onboardingFromProfile({ seen: ["x"], skipped: true }), { seen: ["x"], skipped: true });
  assert.throws(() => onboardingFromProfile({ seen: "all" }));
  assert.throws(() => onboardingFromProfile(null));
});

test("a database from before the column has the tips off", () => {
  assert.deepEqual(onboardingFromProfile(undefined), TIPS_OFF);
  assert.equal(TIPS_OFF.skipped, true);
});

test("merging keeps a tip seen in either copy, and skipping in either (a stale read or tab can't undo them)", () => {
  const screen = withSeen(NEW_ONBOARDING, ["add-course", "hard-slides"]);
  const staleRead = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.deepEqual(mergeOnboarding(staleRead, screen), { seen: ["add-course", "hard-slides"], skipped: false });
  assert.deepEqual(mergeOnboarding(screen, staleRead), { seen: ["add-course", "hard-slides"], skipped: false });
  assert.equal(mergeOnboarding(screen, staleRead), screen);
  assert.equal(mergeOnboarding(screen, { seen: [], skipped: true }).skipped, true);
  assert.equal(mergeOnboarding({ seen: [], skipped: true }, screen).skipped, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HOURS_PER_DAY, cramPlan, defaultBudget, type CramPlanInput } from "../../src/lib/mastery/cram-plan.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const obj = (id: string, status: ObjectiveStatus, weight = 1) => ({ id, name: `Objective ${id}`, weight, status });

/** Two topics in scope: A (two objectives, one weak), B (one objective, unseen); C is done; D is out of scope. */
const topics: CramPlanInput["topics"] = [
  { id: "A", name: "Adders", objectives: [obj("a1", "learning"), obj("a2", "verified")] },
  { id: "B", name: "Buses", objectives: [obj("b1", "unseen")] },
  { id: "C", name: "Counters", objectives: [obj("c1", "mastered"), obj("c2", "verified")] },
  { id: "D", name: "Decoders", objectives: [obj("d1", "unseen", 0)] },
];
const SINCE = "2026-11-10T09:00:00.000Z";
/** Nine days to the exam, 1 hour each but the 14th (half) and the 15th (out): 7.5 hours. */
const perDay = { "2026-11-10": 1, "2026-11-11": 1, "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 0.5, "2026-11-15": 0, "2026-11-16": 1, "2026-11-17": 1, "2026-11-18": 1 };
const budget = { hours: 7.5, daysOut: ["2026-11-15"], since: SINCE, perDay };
const none = { beforeToday: 0, today: 0 };
const base: CramPlanInput = { today: "2026-11-10", examDate: "2026-11-19", budget, topics, spentMinutes: none, touchedObjectiveIds: [] };

test("days left exclude the exam day; study days are the days ahead with hours, and the plan carries the hours by day", () => {
  const plan = cramPlan(base);
  assert.equal(plan.daysLeft, 9);
  assert.equal(plan.studyDays.length, 8, "the day out isn't a study day");
  assert.ok(!plan.studyDays.includes("2026-11-15"));
  assert.deepEqual([plan.studyDays[0], plan.studyDays[7]], ["2026-11-10", "2026-11-18"]);
  assert.deepEqual(plan.perDay, perDay);
  const later = cramPlan({ ...base, today: "2026-11-16" });
  assert.deepEqual(later.studyDays, ["2026-11-16", "2026-11-17", "2026-11-18"], "past days aren't study days left");
  assert.equal(cramPlan({ ...base, today: "2026-11-18" }).daysLeft, 1);
  assert.equal(cramPlan({ ...base, today: "2026-11-19" }).daysLeft, 0);
  assert.equal(cramPlan({ ...base, today: "2026-11-25" }).daysLeft, 0, "never negative");
  // A budget saved before per-day budgets: its hours spread evenly, days out at 0.
  const legacy = cramPlan({ ...base, budget: { hours: 6, daysOut: ["2026-11-14", "2026-11-15", "2026-12-01"], since: SINCE } });
  assert.equal(legacy.studyDays.length, 7);
  assert.equal(legacy.perDay["2026-11-10"], 6 / 7);
  assert.equal(legacy.perDay["2026-11-14"], 0);
});

test("today's minutes are today's hours less what's spent today; hours left count today and later", () => {
  assert.deepEqual([cramPlan(base).minutesToday, cramPlan(base).minutesPerDay, cramPlan(base).hoursLeft], [60, 60, 7.5]);
  const spent = cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 20 } });
  assert.deepEqual([spent.minutesToday, spent.minutesPerDay, spent.hoursLeft], [40, 40, 7.5 - 20 / 60]);
  assert.equal(cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 90 } }).minutesToday, 0, "never negative");
  assert.equal(cramPlan({ ...base, spentMinutes: { beforeToday: 0, today: 600 } }).hoursLeft, 0, "never negative");
  // Later in the cram: only the days ahead count, and a day out has no minutes.
  const half = cramPlan({ ...base, today: "2026-11-14", spentMinutes: { beforeToday: 240, today: 0 } });
  assert.deepEqual([half.minutesToday, half.hoursLeft], [30, 3.5]);
  const out = cramPlan({ ...base, today: "2026-11-15" });
  assert.deepEqual([out.minutesToday, out.hoursLeft, out.today], [0, 3, []]);
  const examDay = cramPlan({ ...base, today: "2026-11-19" });
  assert.deepEqual([examDay.studyDays, examDay.minutesToday, examDay.hoursLeft], [[], 0, 0]);
  // A day the budget doesn't name (the exam moved later) has no hours.
  assert.equal(cramPlan({ ...base, examDate: "2026-11-21", today: "2026-11-19" }).minutesToday, 0);
});

test("missed time is never debt: it moves the lowest-priority topics to cut once the time left can't cover them", () => {
  assert.deepEqual(cramPlan(base).cut, [], "everything fits");
  // One hour left for A (weak, 60 needed), E (180) and B (60): A first, then E takes the rest; B is cut.
  const short = cramPlan({ ...base, topics: withE, today: "2026-11-18", spentMinutes: { beforeToday: 0, today: 0 } });
  assert.deepEqual(short.today, [{ topicId: "A", minutes: 60 }]);
  assert.deepEqual(short.cut, ["B", "E"]);
  assert.match(short.line, /If time runs short: Buses, Encoders\.$/);
  assert.ok(!("behindMinutes" in short), "no behind minutes");
});

test("today is a queue: the ranked topics take their share one after another, weak spots first; done and out-of-scope topics get nothing", () => {
  const plan = cramPlan(base);
  const byId = Object.fromEntries(plan.topics.map((t) => [t.id, t]));
  assert.deepEqual([byId.A.weight, byId.A.unverifiedShare, byId.A.done], [2, 0.5, false]);
  assert.deepEqual([byId.C.weight, byId.C.unverifiedShare, byId.C.done], [2, 0, true]);
  assert.deepEqual([byId.D.weight, byId.D.done], [0, false]);
  assert.deepEqual(plan.verified, { done: 3, total: 5, share: 0.6 });
  // Adders (the weak spot) has the hour; Buses waits for tomorrow rather than splitting it.
  assert.deepEqual(plan.today, [{ topicId: "A", minutes: 60 }]);
  assert.deepEqual([byId.A.minutesToday, byId.B.minutesToday, byId.C.minutesToday, byId.D.minutesToday], [60, 0, 0, 0]);
  assert.deepEqual(dayOf(plan, "2026-11-11").topics, [{ topicId: "B", minutes: 60 }], "every topic is covered once before any is gone over again");
  // A longer day runs on to the next topic once the first has its share.
  const long = cramPlan({ ...base, budget: { ...budget, perDay: { ...perDay, "2026-11-10": 3 } } });
  assert.deepEqual(long.today.map((t) => t.topicId), ["A", "B"]);
  // A day out today: nothing is allocated.
  const off = cramPlan({ ...base, budget: { ...budget, perDay: { ...perDay, "2026-11-10": 0 } } });
  assert.deepEqual(off.today, []);
});

test("diagnostic first: with nothing in scope verified or answered since the cram started, today opens with a sweep, one question per open topic", () => {
  const fresh: CramPlanInput["topics"] = [{ id: "X", name: "Xors", objectives: [obj("x1", "unseen"), obj("x2", "learning")] }, { id: "Y", name: "Ymux", objectives: [obj("y1", "unseen")] }];
  const plan = cramPlan({ ...base, topics: fresh });
  assert.deepEqual(plan.diagnostic, { minutes: 10, topicIds: ["X", "Y"] });
  assert.deepEqual(plan.today, [{ topicId: "X", minutes: 50 }]);
  assert.equal(plan.line, "9 days to the exam. Today: a quick sweep (one question per topic), then Xors. Verified: 0%.");
  assert.equal(cramPlan({ ...base, topics: fresh, touchedObjectiveIds: ["y1"] }).diagnostic, null, "answered something: no sweep");
  assert.equal(cramPlan(base).diagnostic, null, "something verified: no sweep");
});

test("practice tests go on study days: the first on the last one before the exam, a second halfway; their minutes come first that day", () => {
  const mocks = [{ materialId: "m1", name: "Practice 1.pdf" }, { materialId: "m2", name: "2018 midterm.pdf", minutes: 50 }];
  const plan = cramPlan({ ...base, mocks });
  assert.deepEqual(plan.days.filter((d) => d.mock).map((d) => [d.day, d.mock?.name, d.mock?.minutes]), [["2026-11-13", "2018 midterm.pdf", 50], ["2026-11-18", "Practice 1.pdf", 60]]);
  assert.equal(dayOf(plan, "2026-11-13").topics.reduce((sum, t) => sum + t.minutes, 0), 10, "the day's other 10 minutes");
  assert.deepEqual(dayOf(plan, "2026-11-18").topics, []);
  assert.match(plan.line, /Practice test: Fri\./);
  const onTheDay = cramPlan({ ...base, mocks, today: "2026-11-18" });
  assert.deepEqual(onTheDay.mockToday, { materialId: "m1", name: "Practice 1.pdf", minutes: 60 });
  assert.match(onTheDay.line, /Today: practice test Practice 1\.pdf\./);
  assert.equal(cramPlan(base).mockToday, null);
});

test("weak spots are the in-scope objectives in rotation or waiting on a check", () => {
  const plan = cramPlan({
    ...base,
    topics: [{ id: "A", name: "Adders", objectives: [obj("l", "learning"), obj("m", "mixed-up"), obj("f", "fading"), obj("c", "check-due"), obj("v", "verified"), obj("u", "unseen"), obj("out", "learning", 0)] }],
  });
  assert.deepEqual(plan.topics[0].weakSpots, ["l", "m", "f", "c"]);
});

test("the line names what's done and today's queue, never time behind, and exam day says so", () => {
  assert.equal(cramPlan(base).line, "9 days to the exam. Done: Counters. Today: Adders. Verified: 60%.");
  assert.equal(cramPlan({ ...base, today: "2026-11-13", spentMinutes: { beforeToday: 0, today: 0 } }).line, "6 days to the exam. Done: Counters. Today: Adders. Verified: 60%.", "nothing studied before today: no debt");
  assert.equal(cramPlan({ ...base, today: "2026-11-15" }).line, "4 days to the exam. Done: Counters. Verified: 60%.", "a day off");
  assert.equal(cramPlan({ ...base, today: "2026-11-19" }).line, "Exam day. Light review only, nothing new.");
  assert.equal(cramPlan({ ...base, today: "2026-11-18" }).line.slice(0, 18), "1 day to the exam.");
  const nothingDone = cramPlan({ ...base, topics: topics.filter((t) => t.id !== "C") });
  assert.equal(nothingDone.line, "9 days to the exam. Today: Adders. Verified: 33%.");
});

test("the plan is deterministic", () => {
  assert.deepEqual(cramPlan(base), cramPlan(base));
});

test("a plan says when its budget was assumed: 2 hours for every study day from today, nothing spent", () => {
  assert.equal(cramPlan(base).defaulted, false);
  const assumed = defaultBudget("2026-11-10", "2026-11-19", "2026-11-10T15:00:00.000Z");
  assert.equal(assumed.hours, DEFAULT_HOURS_PER_DAY * 9);
  assert.deepEqual(assumed.daysOut, []);
  assert.equal(Object.keys(assumed.perDay!).length, 9);
  const plan = cramPlan({ ...base, budget: assumed, defaulted: true });
  assert.equal(plan.defaulted, true);
  assert.equal(plan.hoursLeft, 18);
  assert.equal(plan.minutesToday, 120);
  assert.deepEqual(plan.cut, []);
});

/* ── The schedule (schedule addendum) ── */

/** A fifth topic with three unseen objectives, so the walk has something to work through. */
const withE: CramPlanInput["topics"] = [...topics, { id: "E", name: "Encoders", objectives: [obj("e1", "unseen"), obj("e2", "unseen"), obj("e3", "unseen")] }];
const dayOf = (plan: ReturnType<typeof cramPlan>, day: string) => plan.days.find((d) => d.day === day)!;

test("the schedule has a column for every day of the budget, today flagged, the days before it past, and carries each day's hours", () => {
  const plan = cramPlan({ ...base, today: "2026-11-13" });
  assert.deepEqual(plan.days.map((d) => d.day), Object.keys(perDay));
  assert.deepEqual(plan.days.map((d) => d.hours), Object.values(perDay));
  assert.deepEqual(plan.days.map((d) => (d.today ? "today" : d.past ? "past" : "later")), ["past", "past", "past", "today", "later", "later", "later", "later", "later"]);
  assert.deepEqual(dayOf(plan, "2026-11-13").topics, plan.today, "today's column is today's split");
  // The exam day and anything after it never show; on the day every column is past.
  const examDay = cramPlan({ ...base, today: "2026-11-19" });
  assert.equal(examDay.days.length, 9);
  assert.ok(examDay.days.every((d) => d.past && !d.today));
  // The exam moved later: a day the budget doesn't name has no column.
  assert.equal(cramPlan({ ...base, examDate: "2026-11-21" }).days.length, 9);
});

test("the days after today cover every topic once, weak spots first then the heaviest, then spend the spare time going back over them", () => {
  const plan = cramPlan({ ...base, topics: withE });
  // The need: 60 minutes per unverified objective at its weight (A 60, E 180, B 60: 300) of the 7.5 hours; the other 150 go to a second pass in proportion.
  assert.deepEqual(plan.today, [{ topicId: "A", minutes: 60 }]);
  assert.deepEqual(
    plan.days.filter((d) => !d.today).map((d) => [d.day, d.topics]),
    [
      ["2026-11-11", [{ topicId: "E", minutes: 60 }]],
      ["2026-11-12", [{ topicId: "E", minutes: 60 }]],
      ["2026-11-13", [{ topicId: "E", minutes: 60 }]],
      ["2026-11-14", [{ topicId: "B", minutes: 30 }]],
      ["2026-11-15", []],
      ["2026-11-16", [{ topicId: "B", minutes: 30 }, { topicId: "A", minutes: 30 }]],
      ["2026-11-17", [{ topicId: "E", minutes: 60 }]],
      ["2026-11-18", [{ topicId: "E", minutes: 30 }, { topicId: "B", minutes: 30 }]],
    ],
  );
  for (const d of plan.days.filter((d) => !d.today)) assert.equal(d.topics.reduce((sum, t) => sum + t.minutes, 0), d.hours * 60, d.day);
  assert.ok(plan.days.every((d) => d.topics.every((t) => t.topicId !== "C" && t.topicId !== "D")));
  // Short of time, priority decides: the weak spot, then the heaviest; the rest is cut, not squeezed.
  const squeezed = cramPlan({ ...base, topics: withE, examDate: "2026-11-12", budget: { hours: 1.5, daysOut: [], since: SINCE, perDay: { "2026-11-10": 0.5, "2026-11-11": 1 } } });
  assert.deepEqual(squeezed.today, [{ topicId: "A", minutes: 30 }]);
  assert.deepEqual(dayOf(squeezed, "2026-11-11").topics, [{ topicId: "A", minutes: 30 }, { topicId: "E", minutes: 30 }]);
  assert.deepEqual(squeezed.cut, ["B"]);
  const allDone = cramPlan({ ...base, topics: [topics[2]] });
  assert.ok(allDone.days.every((d) => d.topics.length === 0));
});

test("past days carry the walk from the start of the cram, with whether they were met when the minutes studied are known", () => {
  const later = { ...base, topics: withE, today: "2026-11-13", spentMinutes: { beforeToday: 130, today: 20 } };
  const unknown = cramPlan(later);
  assert.deepEqual(unknown.days.slice(0, 3).map((d) => d.topics), [[{ topicId: "A", minutes: 60 }], [{ topicId: "E", minutes: 60 }], [{ topicId: "E", minutes: 60 }]]);
  assert.ok(unknown.days.every((d) => d.spentMinutes === null && d.met === null), "not known: no mark");
  const known = cramPlan({ ...later, spentByDay: { "2026-11-10": 60, "2026-11-11": 40, "2026-11-13": 20 } });
  assert.deepEqual(known.days.slice(0, 4).map((d) => [d.spentMinutes, d.met]), [[60, true], [40, false], [0, false], [20, null]]);
  assert.ok(known.days.slice(4).every((d) => d.spentMinutes === 0 && d.met === null), "a day not yet past is never marked");
  // A day off with nothing studied is met.
  const offMet = cramPlan({ ...later, today: "2026-11-16", spentByDay: {} });
  assert.deepEqual([dayOf(offMet, "2026-11-15").met, dayOf(offMet, "2026-11-14").met], [true, false]);
});

test("a topic is done when every in-scope objective is verified, in progress once one has evidence since the cram started, else untouched", () => {
  const covered = (plan: ReturnType<typeof cramPlan>) => Object.fromEntries(plan.topics.map((t) => [t.id, t.covered]));
  assert.deepEqual(covered(cramPlan(base)), { A: "untouched", B: "untouched", C: "done", D: "untouched" });
  assert.deepEqual(covered(cramPlan({ ...base, touchedObjectiveIds: ["a1", "d1"] })), { A: "in-progress", B: "untouched", C: "done", D: "untouched" }, "an out-of-scope objective doesn't count");
  assert.deepEqual(covered(cramPlan({ ...base, touchedObjectiveIds: ["c1"] })), { A: "untouched", B: "untouched", C: "done", D: "untouched" }, "done stays done");
});

test("days before the cram started aren't part of it: no columns, no hours (left over from an earlier exam date)", () => {
  // The budget still names 11-10 to 11-12 from an earlier test, but this cram started on the 15th.
  const stale = { ...budget, since: "2026-11-15T09:00:00.000Z", perDay: { "2026-11-10": 4, "2026-11-11": 4, "2026-11-12": 3, "2026-11-15": 1, "2026-11-16": 1, "2026-11-17": 1 } };
  const plan = cramPlan({ ...base, today: "2026-11-17", examDate: "2026-11-19", budget: stale, spentMinutes: { beforeToday: 120, today: 0 } });
  assert.equal(plan.hoursLeft, 1, "only today is left");
  assert.deepEqual(plan.days.map((d) => d.day), ["2026-11-15", "2026-11-16", "2026-11-17"]);
});

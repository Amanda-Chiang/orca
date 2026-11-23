import test from "node:test";
import assert from "node:assert/strict";
import { examMinutes, hoursMinutes, studyDays } from "../../src/lib/course/study-time.ts";

const dayOf = (iso: string) => iso.slice(0, 10);
const none = { results: [], activity: [], sittings: [], timers: [], dayOf };

test("a timer running while a quiz was taken counts the overlap once, for Orca", () => {
  const days = studyDays({
    ...none,
    results: [{ courseId: "c", seconds: 20 * 60, finishedAt: "2026-11-20T10:30:00Z" }],
    timers: [{ courseId: "c", startedAt: "2026-11-20T10:00:00Z", endedAt: "2026-11-20T11:00:00Z" }],
  });
  assert.deepEqual(days, [{ courseId: "c", day: "2026-11-20", app: 20, claude: 0, timer: 40 }]);
});

test("a running timer doesn't count yet; another course's time stays its own", () => {
  const days = studyDays({
    ...none,
    timers: [
      { courseId: "c", startedAt: "2026-11-20T10:00:00Z", endedAt: null },
      { courseId: "d", startedAt: "2026-11-20T10:00:00Z", endedAt: "2026-11-20T10:30:00Z" },
    ],
    results: [{ courseId: "c", seconds: 600, finishedAt: "2026-11-20T10:20:00Z" }],
  });
  assert.deepEqual(days, [
    { courseId: "c", day: "2026-11-20", app: 10, claude: 0, timer: 0 },
    { courseId: "d", day: "2026-11-20", app: 0, claude: 0, timer: 30 },
  ]);
});

test("Claude's time is its stretches, or what it logged for the day when that's more", () => {
  const activity = [
    { courseId: "c", at: "2026-11-20T10:00:00Z", source: "connector" },
    { courseId: "c", at: "2026-11-20T10:10:00Z", source: "connector" },
    { courseId: "c", at: "2026-11-20T10:12:00Z", source: "quiz" },
  ];
  assert.equal(studyDays({ ...none, activity })[0].claude, 15);
  assert.equal(studyDays({ ...none, activity, sittings: [{ courseId: "c", day: "2026-11-20", minutes: 50 }] })[0].claude, 50);
  assert.equal(studyDays({ ...none, activity, sittings: [{ courseId: "c", day: "2026-11-20", minutes: 5 }] })[0].claude, 15);
});

test("an exam's time is its course's since the exam before it, through its day", () => {
  const days = [
    { courseId: "c", day: "2026-10-01", app: 30, claude: 0, timer: 0 },
    { courseId: "c", day: "2026-10-10", app: 0, claude: 20, timer: 10 },
    { courseId: "c", day: "2026-10-11", app: 45, claude: 0, timer: 0 },
    { courseId: "d", day: "2026-10-05", app: 99, claude: 0, timer: 0 },
  ];
  const exams = [
    { id: "final", courseId: "c", date: "2026-12-01" },
    { id: "midterm", courseId: "c", date: "2026-10-10" },
  ];
  assert.deepEqual(Object.fromEntries(examMinutes(days, exams)), { midterm: 60, final: 45 });
});

test("minutes are written as hours and minutes", () => {
  assert.equal(hoursMinutes(0), "0m");
  assert.equal(hoursMinutes(45.4), "45m");
  assert.equal(hoursMinutes(185), "3h 05m");
});

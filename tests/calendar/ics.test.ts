import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIcs, firstOnOrAfter, fold, icsText, reviewDays } from "../../src/lib/calendar/ics.ts";

const now = new Date("2026-11-25T12:00:00Z");

test("exams and due dates are all-day events with stable ids; meetings and review days repeat weekly", () => {
  const ics = buildIcs({
    courses: [{ id: "c1", name: "Circuit Analysis", short: "E3201", schedule: { meetings: [{ day: 2, start: "10:10", end: "11:25" }], quickDays: null, deepDays: [0] } }],
    exams: [{ id: "x1", courseId: "c1", title: "Final", date: "2026-12-17" }],
    events: [{ id: "e1", courseId: "c1", kind: "hw", title: "HW10 due", date: "2026-12-01" }],
    from: "2026-11-25",
    timezone: "America/New_York",
    now,
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /UID:exam-x1@orca\r\nDTSTAMP:20261125T120000Z\r\nSUMMARY:Final · E3201\r\nDTSTART;VALUE=DATE:20261217\r\nDTEND;VALUE=DATE:20261218/);
  assert.match(ics, /SUMMARY:HW10 due · E3201\r\nDTSTART;VALUE=DATE:20261201/);
  // Wed 25 Nov 2026 → the first Tuesday on or after is 1 Dec.
  assert.match(ics, /SUMMARY:E3201 class\r\nDTSTART;TZID=America\/New_York:20261201T101000\r\nDTEND;TZID=America\/New_York:20261201T112500\r\nRRULE:FREQ=WEEKLY;BYDAY=TU/);
  // No quick days set: the day before class, Monday.
  assert.match(ics, /SUMMARY:Orca review · E3201\r\nDTSTART;VALUE=DATE:20261130\r\nRRULE:FREQ=WEEKLY;BYDAY=MO/);
  assert.match(ics, /SUMMARY:Orca dive · E3201\r\nDTSTART;VALUE=DATE:20261129\r\nRRULE:FREQ=WEEKLY;BYDAY=SU/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("helpers: first weekday on or after, review days, escaping and folding", () => {
  assert.equal(firstOnOrAfter("2026-11-25", 3), "20261125");
  assert.equal(firstOnOrAfter("2026-11-25", 2), "20261201");
  assert.deepEqual(reviewDays({ meetings: [{ day: 0, start: "09:00", end: "10:00" }], quickDays: null, deepDays: null }), [6]);
  assert.deepEqual(reviewDays({ meetings: [], quickDays: [3, 1, 3], deepDays: null }), [1, 3]);
  assert.deepEqual(reviewDays(null), []);
  assert.equal(icsText("a, b; c\\d\nend"), "a\\, b\\; c\\\\d\\nend");
  const long = "DESCRIPTION:" + "x".repeat(100);
  const folded = fold(long);
  assert.equal(folded, long.slice(0, 75) + "\r\n " + long.slice(75));
  assert.equal(fold("short"), "short");
});

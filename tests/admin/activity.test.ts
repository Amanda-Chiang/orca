import test from "node:test";
import assert from "node:assert/strict";
import { type ConnectorRow, type InAppRow, CONNECTOR_DAY_CAP_MINUTES, KIND_LABELS, STUDY_KINDS, activityByDay, connectorMinutes, isEmpty, lastDays, summarize } from "../../src/lib/admin/activity.ts";

const today = new Date("2026-11-15T15:00:00Z");
const row = (day: string, kind: InAppRow["kind"], sessions: number, seconds: number, answers: number, owner = "a"): InAppRow => ({ owner, day, kind, sessions, seconds, answers });
const conn = (day: string, first: string, last: string, answers = 0, owner = "a"): ConnectorRow => ({ owner, day, answers, first: `${day}T${first}Z`, last: `${day}T${last}Z` });

test("every kind has a label, warm-up and the connector included", () => {
  assert.deepEqual([...STUDY_KINDS], ["topic", "quick", "deep", "requiz", "warmup", "connector"]);
  assert.equal(KIND_LABELS.warmup, "Warm-up");
  assert.equal(KIND_LABELS.connector, "Claude connector");
});

test("the connector's minutes are the day's first-to-last span, capped at two hours", () => {
  assert.equal(connectorMinutes("2026-11-15T10:00:00Z", "2026-11-15T10:45:00Z"), 45);
  assert.equal(connectorMinutes("2026-11-15T10:00:00Z", "2026-11-15T10:00:00Z"), 0, "one event is no time");
  assert.equal(connectorMinutes("2026-11-15T08:00:00Z", "2026-11-15T20:00:00Z"), CONNECTOR_DAY_CAP_MINUTES);
  assert.throws(() => connectorMinutes("2026-11-15T11:00:00Z", "2026-11-15T10:00:00Z"));
  assert.throws(() => connectorMinutes("never", "2026-11-15T10:00:00Z"));
});

test("lastDays runs back from today's UTC day", () => {
  assert.deepEqual(lastDays(3, new Date("2026-11-01T23:30:00Z")), ["2026-11-01", "2026-10-31", "2026-10-30"]);
  assert.deepEqual(lastDays(0, today), []);
});

test("summarize buckets today, the last 7 UTC days and all time, one row per kind in order", () => {
  const s = summarize(
    [
      row("2026-11-15", "quick", 2, 600, 12),
      row("2026-11-15", "warmup", 1, 120, 5),
      row("2026-11-09", "deep", 1, 1200, 8), // the 7th day back: in the week
      row("2026-11-08", "deep", 1, 300, 4), // the 8th: all time only
      row("2026-11-15", "topic", 0, 0, 3, "b"), // answers from an unfinished session
    ],
    [conn("2026-11-15", "10:00:00", "10:30:00", 6), conn("2026-11-15", "09:00:00", "23:00:00", 2, "b"), conn("2026-10-01", "10:00:00", "10:10:00", 1)],
    today,
  );
  assert.deepEqual(s.map((k) => k.kind), [...STUDY_KINDS]);
  const by = Object.fromEntries(s.map((k) => [k.kind, k]));
  assert.deepEqual(by.quick.today, { sessions: 2, minutes: 10, answers: 12 });
  assert.deepEqual(by.warmup.all, { sessions: 1, minutes: 2, answers: 5 });
  assert.deepEqual(by.deep.today, { sessions: 0, minutes: 0, answers: 0 });
  assert.deepEqual(by.deep.week, { sessions: 1, minutes: 20, answers: 8 });
  assert.deepEqual(by.deep.all, { sessions: 2, minutes: 25, answers: 12 });
  assert.deepEqual(by.topic.today, { sessions: 0, minutes: 0, answers: 3 });
  // Connector: a student-day is one session; student b's 14-hour span counts 120.
  assert.deepEqual(by.connector.today, { sessions: 2, minutes: 30 + 120, answers: 8 });
  assert.deepEqual(by.connector.all, { sessions: 3, minutes: 160, answers: 9 });
  assert.equal(by.requiz.all.sessions, 0);
  assert.equal(isEmpty(s), false);
});

test("nothing recorded is empty", () => {
  assert.equal(isEmpty(summarize([], [], today)), true);
});

test("activityByDay has every day of the window, newest first, the connector's estimate in the minutes", () => {
  const days = activityByDay(
    [row("2026-11-15", "quick", 1, 90, 4), row("2026-11-13", "deep", 2, 600, 10), row("2026-09-01", "topic", 1, 60, 1)],
    [conn("2026-11-13", "10:00:00", "10:15:00", 3)],
    30,
    today,
  );
  assert.equal(days.length, 30);
  assert.equal(days[0].day, "2026-11-15");
  assert.equal(days[29].day, "2026-10-17");
  assert.deepEqual(days[0], { day: "2026-11-15", sessions: { topic: 0, quick: 1, deep: 0, requiz: 0, warmup: 0, connector: 0 }, minutes: 1.5, answers: 4 });
  assert.deepEqual(days[2], { day: "2026-11-13", sessions: { topic: 0, quick: 0, deep: 2, requiz: 0, warmup: 0, connector: 1 }, minutes: 25, answers: 13 });
  assert.equal(days[1].answers, 0);
  assert.equal(days.reduce((s, d) => s + d.sessions.topic, 0), 0, "a day outside the window is left out");
});

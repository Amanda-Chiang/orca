/**
 * Study time across every source (owner, 2026-11-22: one record of how long the student has worked,
 * per day, course and exam). Three kinds of time, each with when it happened:
 * - in Orca: a finished session (quiz, quick review, dive), from its finish time back by its length;
 * - with Claude: the connector's evidence cut into stretches (as the cram plan counts it), and what
 *   Claude logged per sitting (log_session) when that's more than the stretches that day;
 * - the study timer: from start to stop.
 * Where two overlap in one course (a timer running while a quiz was taken), the time counts once, for
 * the first of Orca, Claude, timer. A piece counts on the day it started. Pure.
 */
import { CONNECTOR_GAP_MINUTES, CONNECTOR_TAIL_MINUTES, type ConnectorActivity } from "./cram-page.ts";

export type StudySource = "app" | "claude" | "timer";
export const STUDY_SOURCES: readonly StudySource[] = ["app", "claude", "timer"];

/** One course's minutes on one day, by source. */
export interface StudyDay {
  courseId: string;
  day: string;
  app: number;
  claude: number;
  timer: number;
}

export interface StudyTimeInput {
  results: ReadonlyArray<{ courseId: string; seconds: number; finishedAt: string }>;
  /** Every evidence event; only the connector's count (as ConnectorActivity reads them). */
  activity: ReadonlyArray<ConnectorActivity & { courseId: string }>;
  sittings: ReadonlyArray<{ courseId: string; day: string; minutes: number }>;
  timers: ReadonlyArray<{ courseId: string; startedAt: string; endedAt: string | null }>;
  dayOf: (iso: string) => string;
}

type Span = [number, number];

/** The parts of `span` that none of `covered` (sorted, disjoint) overlaps. */
function uncovered(span: Span, covered: readonly Span[]): Span[] {
  const out: Span[] = [];
  let [start] = span;
  const end = span[1];
  for (const [a, b] of covered) {
    if (b <= start) continue;
    if (a >= end) break;
    if (a > start) out.push([start, a]);
    start = Math.max(start, b);
    if (start >= end) return out;
  }
  if (start < end) out.push([start, end]);
  return out;
}

function addCovered(covered: Span[], pieces: readonly Span[]): Span[] {
  const all = [...covered, ...pieces].sort((x, y) => x[0] - y[0]);
  const merged: Span[] = [];
  for (const s of all) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/** The connector's events cut into stretches: a pause over CONNECTOR_GAP_MINUTES ends one; each runs to its last event plus CONNECTOR_TAIL_MINUTES. */
function claudeStretches(events: readonly ConnectorActivity[]): Span[] {
  const times = events
    .filter((e) => e.source === "connector" || (e.flagSource ?? "").startsWith("connector"))
    .map((e) => Date.parse(e.at))
    .sort((a, b) => a - b);
  const spans: Span[] = [];
  let i = 0;
  while (i < times.length) {
    let j = i;
    while (j + 1 < times.length && times[j + 1] - times[j] <= CONNECTOR_GAP_MINUTES * 60_000) j++;
    spans.push([times[i], times[j] + CONNECTOR_TAIL_MINUTES * 60_000]);
    i = j + 1;
  }
  return spans;
}

/** Every course's minutes by day and source, overlaps counted once; sorted by day, then course. */
export function studyDays(input: StudyTimeInput): StudyDay[] {
  const courseIds = new Set<string>([...input.results.map((r) => r.courseId), ...input.activity.map((a) => a.courseId), ...input.sittings.map((s) => s.courseId), ...input.timers.map((t) => t.courseId)]);
  const byKey = new Map<string, StudyDay>();
  const entry = (courseId: string, day: string) => {
    const key = `${courseId}|${day}`;
    let e = byKey.get(key);
    if (!e) byKey.set(key, (e = { courseId, day, app: 0, claude: 0, timer: 0 }));
    return e;
  };
  for (const courseId of courseIds) {
    const spans: Record<StudySource, Span[]> = {
      app: input.results.filter((r) => r.courseId === courseId && r.seconds > 0).map((r) => [Date.parse(r.finishedAt) - r.seconds * 1000, Date.parse(r.finishedAt)] as Span),
      claude: claudeStretches(input.activity.filter((a) => a.courseId === courseId)),
      timer: input.timers.filter((t) => t.courseId === courseId && t.endedAt !== null).map((t) => [Date.parse(t.startedAt), Date.parse(t.endedAt!)] as Span),
    };
    let covered: Span[] = [];
    for (const source of STUDY_SOURCES) {
      for (const span of spans[source].sort((a, b) => a[0] - b[0])) {
        const pieces = uncovered(span, covered);
        for (const [a, b] of pieces) entry(courseId, input.dayOf(new Date(a).toISOString()))[source] += (b - a) / 60_000;
        covered = addCovered(covered, pieces);
      }
    }
    // What Claude logged for a day counts when it's more than the stretches that day (homework and lessons leave no evidence).
    const logged = new Map<string, number>();
    for (const s of input.sittings) if (s.courseId === courseId) logged.set(s.day, (logged.get(s.day) ?? 0) + s.minutes);
    for (const [day, minutes] of logged) {
      const e = entry(courseId, day);
      if (minutes > e.claude) e.claude = minutes;
    }
  }
  return [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day) || a.courseId.localeCompare(b.courseId));
}

export const minutesOf = (d: Pick<StudyDay, StudySource>) => d.app + d.claude + d.timer;

/**
 * Each exam's study time: the course's minutes on the days since its previous exam (or from the
 * start, for the first) through the exam's day. Exams in date order within each course.
 */
export function examMinutes(days: readonly StudyDay[], exams: ReadonlyArray<{ id: string; courseId: string; date: string }>): Map<string, number> {
  const out = new Map<string, number>();
  const byCourse = new Map<string, Array<{ id: string; date: string }>>();
  for (const e of exams) byCourse.set(e.courseId, [...(byCourse.get(e.courseId) ?? []), e]);
  for (const [courseId, list] of byCourse) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    sorted.forEach((exam, i) => {
      const after = i > 0 ? sorted[i - 1].date : "";
      out.set(exam.id, days.filter((d) => d.courseId === courseId && d.day > after && d.day <= exam.date).reduce((sum, d) => sum + minutesOf(d), 0));
    });
  }
  return out;
}

/** "3h 05m", "45m", "0m": minutes as the progress page writes them. */
export function hoursMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * What students are doing, by kind of study (owner, 2026-11-15): the admin view's pure helpers.
 * `admin_activity` (migration 20261110180000) returns per student, UTC day and kind the sessions,
 * seconds and answers of in-app study, and per student and day the connector's first and last event;
 * these bucket them (today, the last 7 days, all time, one row per day) and estimate the connector's
 * minutes. Node-loadable (relative imports, no Next).
 */
import { dayKey } from "./stats.ts";

export const STUDY_KINDS = ["topic", "quick", "deep", "requiz", "warmup", "connector"] as const;
export type StudyKind = (typeof STUDY_KINDS)[number];

export const KIND_LABELS: Record<StudyKind, string> = {
  topic: "Topic quiz",
  quick: "Quick review",
  deep: "Dive",
  requiz: "Re-quiz",
  warmup: "Warm-up",
  connector: "Claude connector",
};

export function isStudyKind(k: string): k is StudyKind {
  return (STUDY_KINDS as readonly string[]).includes(k);
}

/** A connector day counts at most this many minutes. */
export const CONNECTOR_DAY_CAP_MINUTES = 120;

/** One student's in-app study of one kind on one UTC day. */
export interface InAppRow {
  owner: string;
  /** YYYY-MM-DD, UTC. */
  day: string;
  kind: Exclude<StudyKind, "connector">;
  sessions: number;
  seconds: number;
  answers: number;
}

/** One student's connector activity on one UTC day. */
export interface ConnectorRow {
  owner: string;
  day: string;
  answers: number;
  /** ISO times of the day's first and last connector event. */
  first: string;
  last: string;
}

/**
 * The connector's minutes for one student on one day: the span from the first to the last connector
 * event, capped at `CONNECTOR_DAY_CAP_MINUTES`. An estimate: a day with one event is 0, and a break
 * between two sittings counts as study.
 */
export function connectorMinutes(first: string, last: string): number {
  const span = (Date.parse(last) - Date.parse(first)) / 60_000;
  if (!Number.isFinite(span) || span < 0) throw new Error(`Bad connector span: ${first} to ${last}`);
  return Math.min(span, CONNECTOR_DAY_CAP_MINUTES);
}

export interface Totals {
  /** For the connector: days with connector activity (one per student per day). */
  sessions: number;
  minutes: number;
  answers: number;
}

export interface KindSummary {
  kind: StudyKind;
  label: string;
  today: Totals;
  week: Totals;
  all: Totals;
}

const zero = (): Totals => ({ sessions: 0, minutes: 0, answers: 0 });
const add = (t: Totals, sessions: number, minutes: number, answers: number) => {
  t.sessions += sessions;
  t.minutes += minutes;
  t.answers += answers;
};

/** The UTC days from `days - 1` days ago through today, newest first. */
export function lastDays(days: number, today: Date): string[] {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: Math.max(days, 0) }, (_, i) => dayKey(new Date(start - i * 86_400_000)));
}

/** One row per kind, in `STUDY_KINDS` order, with today's, the last 7 UTC days' and all-time totals. */
export function summarize(inApp: readonly InAppRow[], connector: readonly ConnectorRow[], today: Date): KindSummary[] {
  const todayKey = dayKey(today);
  const week = new Set(lastDays(7, today));
  const out = new Map<StudyKind, KindSummary>(STUDY_KINDS.map((k) => [k, { kind: k, label: KIND_LABELS[k], today: zero(), week: zero(), all: zero() }]));
  const put = (kind: StudyKind, day: string, sessions: number, minutes: number, answers: number) => {
    const s = out.get(kind)!;
    add(s.all, sessions, minutes, answers);
    if (week.has(day)) add(s.week, sessions, minutes, answers);
    if (day === todayKey) add(s.today, sessions, minutes, answers);
  };
  for (const r of inApp) put(r.kind, r.day, r.sessions, r.seconds / 60, r.answers);
  for (const c of connector) put("connector", c.day, 1, connectorMinutes(c.first, c.last), c.answers);
  return [...out.values()];
}

export interface ActivityDay {
  day: string;
  sessions: Record<StudyKind, number>;
  /** In-app minutes plus the connector's estimate. */
  minutes: number;
  answers: number;
}

/** The last `days` UTC days ending today, newest first, every day present (zeros included). */
export function activityByDay(inApp: readonly InAppRow[], connector: readonly ConnectorRow[], days: number, today: Date): ActivityDay[] {
  const rows = new Map(
    lastDays(days, today).map((day) => [day, { day, sessions: Object.fromEntries(STUDY_KINDS.map((k) => [k, 0])) as Record<StudyKind, number>, minutes: 0, answers: 0 }]),
  );
  for (const r of inApp) {
    const d = rows.get(r.day);
    if (!d) continue;
    d.sessions[r.kind] += r.sessions;
    d.minutes += r.seconds / 60;
    d.answers += r.answers;
  }
  for (const c of connector) {
    const d = rows.get(c.day);
    if (!d) continue;
    d.sessions.connector += 1;
    d.minutes += connectorMinutes(c.first, c.last);
    d.answers += c.answers;
  }
  return [...rows.values()];
}

/** Whether nothing at all was recorded: the tables then say "No sessions yet". */
export function isEmpty(summary: readonly KindSummary[]): boolean {
  return summary.every((s) => s.all.sessions === 0 && s.all.answers === 0);
}

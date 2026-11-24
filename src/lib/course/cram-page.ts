/**
 * What the cram page and the exam card feed the plan (cram mode contract, section 6): the scope as
 * topics with weighted objectives and their statuses, the minutes studied in Orca since cramming
 * started (split at today, and by day), the objectives touched since, the hours a day a setup
 * starts from, and the days it asks about. Pure.
 */
import type { Duration, Exam, Objective, QuizResult, Relation, Topic } from "../data.ts";
import type { EvidenceEvent } from "../mastery/types.ts";
import { addDays } from "../mastery/agenda.ts";
import type { CramPlanInput, SpentMinutes } from "../mastery/cram-plan.ts";
import { durationSeconds } from "../mastery/session.ts";
import type { ObjectiveStatus } from "../mastery/types.ts";
import { examObjectives } from "./exam-card.ts";
import { courseObjectiveWeights, survivingTopic } from "./weights.ts";

/** The hours a setup starts from: the course's exam review duration ("10 hours" → 10, "30 min" → 0.5). */
export function hoursFromDuration(d: Duration): number {
  return durationSeconds(d) / 3600;
}

/** Hours a day from a total over some study days, to the nearest half hour and at least half an hour (the setup's prefill). */
export function perDayHours(total: number, studyDays: number): number {
  return Math.max(0.5, Math.round((total / Math.max(1, studyDays)) * 2) / 2);
}

/** "Friday" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
export function weekdayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** The days the setup asks about: today to the day before the exam (none on or after the day). */
export function remainingDays(today: string, examDate: string): string[] {
  const days: string[] = [];
  for (let d = today; d < examDate; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Minutes of finished sessions in this course since `since` ("in Orca": the connector's estimate is
 * server-side), split at the start of today: `dayOf` puts a finish time on the student's day.
 */
export function spentMinutesInOrca(results: readonly QuizResult[], courseId: string, since: string, today: string, dayOf: (iso: string) => string): SpentMinutes {
  const spent = { beforeToday: 0, today: 0 };
  for (const r of results) {
    if (r.courseId !== courseId || r.finishedAt < since) continue;
    const day = dayOf(r.finishedAt);
    if (day === today) spent.today += r.seconds / 60;
    else if (day < today) spent.beforeToday += r.seconds / 60;
  }
  return spent;
}

/** A pause longer than this between Claude's connector events ends a study stretch (owner, 2026-11-16: Claude sessions count as study). */
export const CONNECTOR_GAP_MINUTES = 30;
/** What one event at the end of a stretch counts for (the question it answered took some time too). */
export const CONNECTOR_TAIL_MINUTES = 5;

/** An evidence event as the connector estimate reads it: when, and whether it came through Claude. */
export interface ConnectorActivity {
  at: string;
  /** "connector" on an answer, work or signal Claude recorded. */
  source?: string | null;
  /** "connector" or "connector-struggled" on a flag Claude raised. */
  flagSource?: string | null;
}

/**
 * Minutes of study with Claude, by the student's day, from the connector's evidence: the events are
 * cut into stretches wherever CONNECTOR_GAP_MINUTES pass without one, and each stretch counts from its
 * first event to its last plus CONNECTOR_TAIL_MINUTES. A stretch counts on the day it started.
 */
export function connectorMinutesByDay(events: readonly ConnectorActivity[], dayOf: (iso: string) => string): Map<string, number> {
  const times = events
    .filter((e) => e.source === "connector" || (e.flagSource ?? "").startsWith("connector"))
    .map((e) => ({ t: Date.parse(e.at), at: e.at }))
    .sort((a, b) => a.t - b.t);
  const byDay = new Map<string, number>();
  let i = 0;
  while (i < times.length) {
    let j = i;
    while (j + 1 < times.length && times[j + 1].t - times[j].t <= CONNECTOR_GAP_MINUTES * 60_000) j++;
    const day = dayOf(times[i].at);
    byDay.set(day, (byDay.get(day) ?? 0) + (times[j].t - times[i].t) / 60_000 + CONNECTOR_TAIL_MINUTES);
    i = j + 1;
  }
  return byDay;
}

/**
 * A day's study with Claude: what Claude logged for it (log_session) when that's more than the
 * estimate from its evidence, else the estimate. Logged time is the fuller record (homework and
 * lessons leave no evidence); taking the larger of the two never counts a sitting twice.
 */
export function claudeMinutesByDay(estimated: ReadonlyMap<string, number>, logged: Readonly<Record<string, number>>): Map<string, number> {
  const out = new Map(estimated);
  for (const [day, minutes] of Object.entries(logged)) out.set(day, Math.max(out.get(day) ?? 0, minutes));
  return out;
}

/** Minutes of finished sessions in this course since `since`, by the student's day (the plan's `spentByDay`; "in Orca", as `spentMinutesInOrca`). */
export function spentMinutesByDayInOrca(results: readonly QuizResult[], courseId: string, since: string, dayOf: (iso: string) => string): Record<string, number> {
  const byDay: Record<string, number> = {};
  for (const r of results) {
    if (r.courseId !== courseId || r.finishedAt < since) continue;
    const day = dayOf(r.finishedAt);
    byDay[day] = (byDay[day] ?? 0) + r.seconds / 60;
  }
  return byDay;
}

/** The course's objectives with any evidence (an answer, work, a flag or a signal) at or after `since` (the plan's `touchedObjectiveIds`). */
export function touchedObjectives(evidence: readonly EvidenceEvent[], courseId: string, since: string): string[] {
  return [...new Set(evidence.filter((e) => e.courseId === courseId && e.at >= since).map((e) => e.objectiveId))];
}

/**
 * The plan's topics: every live topic with objectives the exam covers, each objective at its course
 * weight × its scope weight (1 when unlisted), with its status. Topic ids follow merges, as the
 * agenda's weights do.
 */
export function planTopics(
  exam: Pick<Exam, "topicIds" | "scope">,
  topics: readonly Topic[],
  catalogue: Readonly<Record<string, Objective>>,
  relations: readonly Relation[],
  statusOf: (objectiveId: string) => ObjectiveStatus,
): CramPlanInput["topics"] {
  const covered = new Set(examObjectives(exam, topics, catalogue));
  const weights = courseObjectiveWeights(catalogue, topics, relations);
  const scoped = new Map((exam.scope?.objectives ?? []).map((o) => [o.objectiveId, Math.max(0, o.weight)]));
  const byId = new Map(topics.map((t) => [t.id, t]));
  const live = topics.filter((t) => t.review !== "archived" && !t.mergedInto);
  const grouped = new Map<string, CramPlanInput["topics"][number]["objectives"]>(live.map((t) => [t.id, []]));
  for (const id of covered) {
    const o = catalogue[id];
    const topicId = survivingTopic(o.topicId, byId)?.id ?? o.topicId;
    const list = grouped.get(topicId);
    if (!list) continue;
    const weight = weights.get(id);
    if (weight === undefined) throw new Error(`No weight computed for objective ${id}`);
    list.push({ id, name: o.name, weight: weight * (scoped.get(id) ?? 1), status: statusOf(id) });
  }
  return live.filter((t) => grouped.get(t.id)!.length > 0).map((t) => ({ id: t.id, name: t.name, objectives: grouped.get(t.id)! }));
}

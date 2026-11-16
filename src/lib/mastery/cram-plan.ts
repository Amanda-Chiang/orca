/**
 * The cram plan (cram mode contract, section 6, its per-day and schedule addenda): derived from the
 * exam date, the student's time budget by day and the scope's objectives as they stand, never stored.
 * Pure and deterministic: no clock reads, `today` comes from the caller (in the student's
 * timezone). The cram page reads it in the browser and `course_state` reads the same calculation,
 * so Claude's progress line and the page agree.
 */
import type { CramBudget } from "../data.ts";
import { perDayOf } from "./cram-budget.ts";
import type { ObjectiveStatus } from "./types.ts";

export { DEFAULT_HOURS_PER_DAY, defaultBudget } from "./cram-budget.ts";

/** Minutes studied since budget.since, split at the start of today (the student's day). */
export interface SpentMinutes {
  /** On the days before today. */
  beforeToday: number;
  /** Today so far. */
  today: number;
}

export interface CramPlanInput {
  /** YYYY-MM-DD, student's timezone */
  today: string;
  /** YYYY-MM-DD */
  examDate: string;
  budget: CramBudget;
  /** The exam's topics with their objectives: `weight` is the agenda's effective weight (course × scope); 0 = out of scope. */
  topics: Array<{ id: string; name: string; objectives: Array<{ id: string; name: string; weight: number; status: ObjectiveStatus }> }>;
  /**
   * Minutes studied since budget.since: session_results seconds (any mode) + connector estimate
   * (span of a day's connector events, capped at 120 min/day), split at the start of today.
   */
  spentMinutes: SpentMinutes;
  /**
   * Minutes studied on each day since budget.since (YYYY-MM-DD in the student's timezone → minutes;
   * a day left out is 0): what the schedule marks past days met or short with. Left out when the
   * caller doesn't know it (every day's `spentMinutes` is then null).
   */
  spentByDay?: Record<string, number>;
  /** Objectives with any evidence (an answer, work, a flag or a signal) at or after budget.since: a topic with one is in progress. */
  touchedObjectiveIds: string[];
  /** The budget was assumed (`defaultBudget`), not set by the student. */
  defaulted?: boolean;
  /** The vault's practice and past exams, to be sat timed on days of the cram (`minutes`: the exam's length when known, else MOCK_MINUTES). */
  mocks?: Array<{ materialId: string; name: string; minutes?: number }>;
}

/** How far a topic has got in the cram: done when every in-scope objective is verified or mastered; in progress once any of them has evidence since the cram started; else untouched. */
export type CramCovered = "untouched" | "in-progress" | "done";

/** One day of the schedule, from the day cramming started to the day before the exam. */
export interface CramPlanDay {
  /** YYYY-MM-DD, the student's timezone. */
  day: string;
  /** The budget's hours for it (0: a day off). */
  hours: number;
  /** What's planned for it, in the order to do it (weak spots first, then the heaviest); empty on a day off and when nothing is left to do. */
  topics: Array<{ topicId: string; minutes: number }>;
  today: boolean;
  past: boolean;
  /** Minutes studied that day, when the caller knows them (`spentByDay`); null otherwise. */
  spentMinutes: number | null;
  /** A practice test placed on this day, timed; its minutes come out of the day before the topics. */
  mock: { materialId: string; name: string; minutes: number } | null;
  /** A past day: whether what was studied reached the hours planned for it; null for today and later, and when the minutes aren't known. */
  met: boolean | null;
}

export interface CramPlanTopic {
  id: string;
  name: string;
  /** The sum of its in-scope objectives' weights. */
  weight: number;
  /** In-scope objectives not yet verified or mastered, as a share of its in-scope objectives. */
  unverifiedShare: number;
  /** Every in-scope objective is verified or mastered: it gets no minutes. */
  done: boolean;
  minutesToday: number;
  /** Objective ids in rotation or check-due: listed first on the page and in Claude's order. */
  weakSpots: string[];
  /** done: every in-scope objective verified or mastered; in-progress: evidence on one of them since the cram started; untouched: neither. */
  covered: CramCovered;
}

export interface CramPlan {
  /** Calendar days from today to the exam, exam day excluded; 0 on the day. */
  daysLeft: number;
  /** Days from today to the day before the exam with hours in the budget (a day at 0 is a day out). */
  studyDays: string[];
  /** The budget's hours by day, from the day cramming started to the day before the exam (`perDayOf`). */
  perDay: Record<string, number>;
  /** max(0, the budget's hours for today and later − today's spent minutes / 60) */
  hoursLeft: number;
  /** max(0, today's hours × 60 − minutes spent today): what's left to do today; 0 on a day out or the exam day. */
  minutesToday: number;
  /** The same as `minutesToday`, kept for readers of the first plan (it was the average over the study days left). */
  minutesPerDay: number;
  /**
   * Topics the time left can't cover, lowest priority first to go (owner, 2026-11-16: a backlog, not
   * a timetable): missed time never piles up as debt, it moves topics here. Empty when everything fits.
   */
  cut: string[];
  /**
   * The cram's first block while nothing in scope has been answered since it started: a sweep, one
   * question per topic in `topicIds`, so the misses find the weak spots before teaching (the ALD
   * cram's "diagnostic first"). Its minutes come out of today before the topics. Null otherwise.
   */
  diagnostic: { minutes: number; topicIds: string[] } | null;
  /** A practice test placed on today (also on today's entry in `days`); null otherwise. */
  mockToday: { materialId: string; name: string; minutes: number } | null;
  /** Objectives verified or mastered over objectives in scope (weight > 0). */
  verified: { done: number; total: number; share: number };
  topics: CramPlanTopic[];
  /** Today's queue, in the order to do it: weak spots first, then the heaviest; one topic after another, each until its share is used (owner, 2026-11-16: no slicing the day into 5-minute pieces). */
  today: Array<{ topicId: string; minutes: number }>;
  /**
   * The schedule: every day from the start of the cram to the day before the exam (the budget's
   * days). Today carries `today`'s split; the days after it walk through what's left, weak spots
   * first then the heaviest, so the scope progresses day by day (`scheduleDays`); the days before
   * today carry what the same walk puts on them from the start of the cram, recomputed from the
   * scope as it stands, with whether they were met when the minutes studied are known.
   */
  days: CramPlanDay[];
  /** "9 days to the exam. Done: A. Today: a quick sweep, then C, then D. Verified: 60%. Practice test: Mon. If time runs short: E." (day of: "Exam day. Light review only, nothing new.") */
  line: string;
  /** The budget was assumed: DEFAULT_HOURS_PER_DAY a study day from today, nothing spent. Claude says so and asks. */
  defaulted: boolean;
}

const DAY_MS = 86_400_000;
const VERIFIED: ReadonlySet<ObjectiveStatus> = new Set(["verified", "mastered"]);
/** Statuses that aren't in rotation and have no check open (src/lib/mastery/types.ts): everything else is a weak spot. */
/** Statuses that aren't a weak spot: everything else (in rotation, or waiting on a check) is. */
export const NOT_WEAK: ReadonlySet<ObjectiveStatus> = new Set(["unseen", "verified"]);

function ymd(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m - 1, d];
}

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / DAY_MS);
}

/** Round to the nearest 5 minutes; under 5 is dropped (0). */
const toFive = (minutes: number) => Math.round(minutes / 5) * 5;

/** The nominal minutes an unverified objective needs, at weight 1 (the schedule's unit of need). */
export const MINUTES_PER_UNVERIFIED = 60;

/** A practice test's minutes when its length isn't known. */
export const MOCK_MINUTES = 60;
/** A diagnostic sweep: about this many minutes a topic, within the bounds below. */
const SWEEP_MINUTES_PER_TOPIC = 3;
const SWEEP_MIN = 10;
const SWEEP_MAX = 30;

/** The topics in the order to work through them: ones with weak spots first, then the largest need, then the plan's order. */
function rankTopics(topics: readonly CramPlanTopic[], need: readonly number[]): number[] {
  return topics.map((_, i) => i).sort((a, b) => Number(topics[b].weakSpots.length > 0) - Number(topics[a].weakSpots.length > 0) || need[b] - need[a] || a - b);
}

/** What's left to lay out: a first pass that covers every topic once, then a second pass of review with the time to spare. */
interface Passes {
  first: number[];
  second: number[];
}

/**
 * Lay the topics' remaining need out over `days`, in order: each day's minutes go to the topics in
 * rank order (`ranked`), first pass before second, each taking what it still needs up to what's left
 * of the day, rounded to 5 minutes. A need shrinks day by day, so the cram works through the scope
 * one topic after another, covers every topic once before going back over any (the ALD cram's
 * order), and only then spends the spare time. `need` is changed in place.
 */
function scheduleDays(days: ReadonlyArray<{ day: string; minutes: number }>, topics: readonly CramPlanTopic[], need: Passes, ranked: readonly number[]): Map<string, Array<{ topicId: string; minutes: number }>> {
  const out = new Map<string, Array<{ topicId: string; minutes: number }>>();
  for (const { day, minutes } of days) {
    const planned: Array<{ topicId: string; minutes: number }> = [];
    let left = minutes;
    for (const pass of [need.first, need.second]) {
      for (const i of ranked) {
        if (left < 5) break;
        const take = toFive(Math.min(pass[i], left));
        if (take <= 0) continue;
        const same = planned.find((p) => p.topicId === topics[i].id);
        if (same) same.minutes += take;
        else planned.push({ topicId: topics[i].id, minutes: take });
        pass[i] = Math.max(0, pass[i] - take);
        left -= take;
      }
    }
    out.set(day, planned);
  }
  return out;
}

/** Each topic's nominal need: MINUTES_PER_UNVERIFIED for each unverified objective at its weight. */
const nominalNeeds = (topics: readonly CramPlanTopic[]) => topics.map((t) => (t.weight > 0 && !t.done ? t.weight * t.unverifiedShare * MINUTES_PER_UNVERIFIED : 0));

/**
 * What each topic gets of `minutes`: when everything fits, its nominal need in a first pass and the
 * spare time as review in a second, in proportion; when it doesn't, the topics in rank order take
 * their full need until the time runs out, and the rest get nothing (they're `cut`). Priority
 * decides, not an even squeeze.
 */
function needsFor(topics: readonly CramPlanTopic[], minutes: number, ranked: readonly number[]): { need: Passes; cut: number[] } {
  const nominal = nominalNeeds(topics);
  const sum = nominal.reduce((a, b) => a + b, 0);
  const none = nominal.map(() => 0);
  if (sum <= 0 || minutes <= 0) return { need: { first: none, second: [...none] }, cut: [] };
  if (sum <= minutes) return { need: { first: nominal, second: nominal.map((n) => (n * (minutes - sum)) / sum) }, cut: [] };
  const need = nominal.map(() => 0);
  const cut: number[] = [];
  let left = minutes;
  for (const i of ranked) {
    if (nominal[i] <= 0) continue;
    if (left < 5) {
      cut.push(i);
      continue;
    }
    need[i] = Math.min(nominal[i], left);
    left -= need[i];
  }
  return { need: { first: need, second: nominal.map(() => 0) }, cut };
}

const shortDay = (day: string) => new Date(Date.UTC(...ymd(day))).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/**
 * Where the practice tests go: the last study day before the exam for the first, and for a second
 * the study day halfway through the cram; further ones aren't placed. A day takes one test.
 */
function placeMocks(mocks: NonNullable<CramPlanInput["mocks"]>, studyDays: readonly string[]): Map<string, { materialId: string; name: string; minutes: number }> {
  const placed = new Map<string, { materialId: string; name: string; minutes: number }>();
  if (!mocks.length || !studyDays.length) return placed;
  const slots = [studyDays[studyDays.length - 1], studyDays[Math.floor((studyDays.length - 1) / 2)]];
  mocks.forEach((m, i) => {
    const day = slots[i];
    if (day === undefined || placed.has(day)) return;
    placed.set(day, { materialId: m.materialId, name: m.name, minutes: m.minutes ?? MOCK_MINUTES });
  });
  return placed;
}

export function cramPlan(input: CramPlanInput): CramPlan {
  const { today, examDate, budget, spentMinutes } = input;
  const startDay = budget.since.slice(0, 10);
  // The cram's days: from the day it started to the day before the exam (days left over from an earlier date aren't part of it).
  const perDayAll = perDayOf(budget, examDate);
  const days = Object.keys(perDayAll).filter((d) => d >= startDay && d < examDate).sort();
  const perDay = Object.fromEntries(days.map((d) => [d, perDayAll[d]]));
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const studyDays = days.filter((d) => d >= today && perDay[d] > 0);
  const hoursAhead = days.filter((d) => d >= today).reduce((sum, d) => sum + perDay[d], 0);
  const hoursLeft = Math.max(0, hoursAhead - spentMinutes.today / 60);
  const minutesToday = daysLeft === 0 ? 0 : Math.max(0, (perDay[today] ?? 0) * 60 - spentMinutes.today);

  const touched = new Set(input.touchedObjectiveIds);
  let done = 0;
  let total = 0;
  let anyTouched = false;
  const topics: CramPlanTopic[] = input.topics.map((t) => {
    const inScope = t.objectives.filter((o) => o.weight > 0);
    const verified = inScope.filter((o) => VERIFIED.has(o.status)).length;
    done += verified;
    total += inScope.length;
    if (inScope.some((o) => touched.has(o.id))) anyTouched = true;
    const isDone = inScope.length > 0 && verified === inScope.length;
    return {
      id: t.id,
      name: t.name,
      weight: inScope.reduce((sum, o) => sum + o.weight, 0),
      unverifiedShare: inScope.length ? (inScope.length - verified) / inScope.length : 0,
      done: isDone,
      minutesToday: 0,
      weakSpots: inScope.filter((o) => !NOT_WEAK.has(o.status)).map((o) => o.id),
      covered: isDone ? "done" : inScope.some((o) => touched.has(o.id)) ? "in-progress" : "untouched",
    };
  });
  const open = topics.filter((t) => t.weight > 0 && !t.done);

  // Practice tests on their days (only days still ahead; a past one has been sat or skipped).
  const mocks = placeMocks(input.mocks ?? [], studyDays);
  const mockMinutes = (day: string) => Math.min(mocks.get(day)?.minutes ?? 0, perDay[day] * 60);
  const mockToday = mocks.get(today) ?? null;

  // Diagnostic first: nothing in scope answered since the cram started, so today opens with a sweep.
  const sweepTopics = !anyTouched && done === 0 && minutesToday > 0 ? open.map((t) => t.id) : [];
  const sweep = sweepTopics.length ? Math.min(minutesToday, Math.max(SWEEP_MIN, Math.min(SWEEP_MAX, toFive(sweepTopics.length * SWEEP_MINUTES_PER_TOPIC)))) : 0;
  const diagnostic = sweep > 0 ? { minutes: sweep, topicIds: sweepTopics } : null;

  // What's left for topics: today's minutes less the sweep and today's test, then the later days less theirs.
  const todayTopicMinutes = Math.max(0, minutesToday - sweep - (mockToday ? mockMinutes(today) : 0));
  const later = days.filter((d) => d > today).map((d) => ({ day: d, minutes: Math.max(0, perDay[d] * 60 - mockMinutes(d)) }));
  const ahead = todayTopicMinutes + later.reduce((sum, d) => sum + d.minutes, 0);
  const ranked = rankTopics(topics, nominalNeeds(topics));
  const { need, cut } = needsFor(topics, ahead, ranked);

  // Today is a queue: the ranked topics take their share in turn until today's minutes are used.
  const todayPlanned = scheduleDays([{ day: today, minutes: todayTopicMinutes }], topics, need, ranked).get(today) ?? [];
  for (const t of todayPlanned) {
    const topic = topics.find((x) => x.id === t.topicId);
    if (topic) topic.minutesToday = t.minutes;
  }
  const laterPlanned = scheduleDays(later, topics, need, ranked);
  // The days before today get the same walk from the start of the cram, over the whole budget: what was planned for them, as derivable now.
  const before = days.filter((d) => d < today).map((d) => ({ day: d, minutes: perDay[d] * 60 }));
  const beforeRanked = rankTopics(topics, nominalNeeds(topics));
  const beforePlanned = scheduleDays(before, topics, needsFor(topics, days.reduce((sum, d) => sum + perDay[d] * 60, 0), beforeRanked).need, beforeRanked);
  const spentByDay = input.spentByDay;
  const schedule: CramPlanDay[] = days.map((day) => {
    const past = day < today;
    const spent = spentByDay ? (spentByDay[day] ?? 0) : null;
    const mock = mocks.get(day);
    return {
      day,
      hours: perDay[day],
      topics: day === today ? todayPlanned : past ? (beforePlanned.get(day) ?? []) : (laterPlanned.get(day) ?? []),
      today: day === today,
      past,
      spentMinutes: spent,
      met: past && spent !== null ? spent >= perDay[day] * 60 : null,
      mock: mock ? { ...mock, minutes: mockMinutes(day) } : null,
    };
  });

  const share = total ? done / total : 0;
  const nameOf = new Map(topics.map((t) => [t.id, t.name]));
  const cutIds = cut.map((i) => topics[i].id).reverse();
  let line: string;
  if (daysLeft === 0) line = "Exam day. Light review only, nothing new.";
  else {
    const doneNames = topics.filter((t) => t.done).map((t) => t.name);
    const steps = [
      ...(diagnostic ? ["a quick sweep (one question per topic)"] : []),
      ...(mockToday ? [`practice test ${mockToday.name}`] : []),
      ...todayPlanned.map((t) => nameOf.get(t.topicId) ?? t.topicId),
    ];
    line = `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to the exam.`;
    if (doneNames.length) line += ` Done: ${doneNames.join(", ")}.`;
    // At most three named, so the line stays one sentence; the page and the plan list them all.
    if (steps.length) line += ` Today: ${steps.slice(0, 3).join(", then ")}${steps.length > 3 ? ` and ${steps.length - 3} more` : ""}.`;
    line += ` Verified: ${Math.round(share * 100)}%.`;
    const nextMock = [...mocks.keys()].sort().find((d) => d > today);
    if (nextMock) line += ` Practice test: ${shortDay(nextMock)}.`;
    if (cutIds.length) line += ` If time runs short: ${cutIds.slice(0, 3).map((id) => nameOf.get(id) ?? id).join(", ")}${cutIds.length > 3 ? ` and ${cutIds.length - 3} more` : ""}.`;
  }

  return { daysLeft, studyDays, perDay, hoursLeft, minutesToday, minutesPerDay: minutesToday, cut: cutIds, diagnostic, mockToday, verified: { done, total, share }, topics, today: todayPlanned, days: schedule, line, defaulted: input.defaulted ?? false };
}

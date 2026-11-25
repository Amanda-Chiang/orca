"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionLine } from "@/lib/connector/mcp";
import { examReadiness, typePlanTopics, typesTouchedSince, type ExamReadiness, type ProblemAttempt } from "@/lib/course/readiness";
import type { Course, Exam } from "@/lib/data";
import { planTopics, touchedObjectives } from "@/lib/course/cram-page";
import { useStudyDays } from "@/components/study/useStudyDays";
import { cramPlan, type CramPlan, type CramPlanInput, type SpentMinutes } from "@/lib/mastery/cram-plan";
import { courseMastery, type CourseMastery } from "@/lib/mastery/course-mastery";
import { perDayOf } from "@/lib/mastery/cram-budget";
import { trailTopics } from "@/lib/data";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";

/**
 * The exam's cram plan, computed in the browser from the store (cram mode contract, section 6):
 * null until the exam has a time budget (set at the page's setup). Spent minutes are the course's
 * study time since the budget's `since`, counted as the progress page counts it (`useStudyDays`:
 * finished sessions, time with Claude, the study timer including a running one, overlaps once),
 * split at today and by day; `studyLoaded` is false until the server's part of that is read (the plan
 * then knows no day's minutes). The topics' covered state reads the store's evidence since then. The
 * vault's held-back exams are the practice tests the plan places on days.
 */
export function useCramPlan(course: Course | undefined, exam: Exam | null, mastery: CourseMastery | undefined, log: StudyLog | null = null): { plan: CramPlan; spentMinutes: SpentMinutes; topics: CramPlanInput["topics"]; readiness: ExamReadiness | null; split: StudySplit; studyLoaded: boolean } | null {
  const { objectives, relations, evidence, materials } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const budget = exam?.scope?.budget;
  const days = useStudyDays(course && budget ? { courseId: course.id, since: budget.since } : { courseId: "", since: "" });
  return useMemo(() => {
    if (!course || !mastery || !exam || !budget) return null;
    const today = dayKey(new Date(nowMs).toISOString());
    const spentMinutes = { beforeToday: 0, today: 0 };
    const split: StudySplit = {};
    for (const d of days ?? []) {
      const minutes = d.app + d.claude + d.timer;
      split[d.day] = { app: d.app, claude: d.claude, timer: d.timer };
      if (d.day === today) spentMinutes.today += minutes;
      else if (d.day < today) spentMinutes.beforeToday += minutes;
    }
    const spentByDay = days ? Object.fromEntries(Object.entries(split).map(([day, x]) => [day, x.app + x.claude + x.timer])) : undefined;
    // With an exam map the plan's units are its kinds of problem (ready = done, touched = attempted since); else the course's topics.
    const types = exam.scope?.problemTypes ?? [];
    const readiness = types.length ? examReadiness(types, log?.attempts ?? []) : null;
    const topics = readiness ? typePlanTopics(readiness) : planTopics(exam, course.topics, objectives[course.id] ?? {}, relations[course.id] ?? [], (id) => mastery.objectives.get(id)?.status ?? "unseen");
    const touchedObjectiveIds = readiness ? typesTouchedSince(log?.attempts ?? [], budget.since) : touchedObjectives(evidence, course.id, budget.since);
    const mocks = materials.filter((m) => m.courseId === course.id && m.heldBack).sort((a, b) => Number(b.id === exam.scope?.reservedMaterialId) - Number(a.id === exam.scope?.reservedMaterialId)).map((m) => ({ materialId: m.id, name: m.filename, ...(exam.scope?.format?.minutes ? { minutes: exam.scope.format.minutes } : {}) }));
    return { plan: cramPlan({ today, dayOf: dayKey, examDate: exam.date, budget, topics, spentMinutes, ...(spentByDay ? { spentByDay } : {}), touchedObjectiveIds, mocks, unit: readiness ? "problem-type" : "topic" }), spentMinutes, topics, readiness, split, studyLoaded: days !== null };
  }, [exam, budget, course, objectives, relations, evidence, materials, mastery, dayKey, nowMs, log, days]);
}

/** Minutes studied each day since the cram started, by source: in Orca, with Claude and on the study timer. */
export type StudySplit = Record<string, { app: number; claude: number; timer: number }>;

/**
 * Whether the student's Claude is connected (a connector token exists), read once a cramming state
 * shows: null until known. Study with Claude links to Settings only when it isn't.
 */
export function useConnectorStatus(wanted: boolean): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch("/api/connector", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Couldn't read the connector: ${res.status}`);
        const body = (await res.json()) as { connected: boolean };
        if (live) setConnected(body.connected);
      })
      .catch(() => {
        // Unknown stays null: the link to Settings is shown, which works either way.
        if (live) setConnected(null);
      });
    return () => {
      live = false;
    };
  }, [wanted]);
  return connected;
}

/** The course's session record as the cram page reads it. */
export interface StudyLog {
  sessions: SessionLine[];
  sittings: Array<{ day: string; minutes: number; at: string }>;
  /** The exam-style problems attempted for the exam's problem types (log_problem). */
  attempts: ProblemAttempt[];
}

/**
 * The sittings the student's Claude logged for this course (`GET /api/study-log`): null until read,
 * read again when the tab comes back into view (a sitting is logged from the chat, in another tab).
 */
export function useStudyLog(courseId: string | undefined, examId?: string): StudyLog | null {
  const [log, setLog] = useState<StudyLog | null>(null);
  useEffect(() => {
    if (!courseId) return;
    let live = true;
    const read = () =>
      fetch(`/api/study-log?courseId=${courseId}${examId ? `&examId=${examId}` : ""}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Couldn't read the session record: ${res.status}`);
          const body = (await res.json()) as StudyLog;
          if (live) setLog(body);
        })
        .catch((e: unknown) => console.error(e));
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [courseId, examId]);
  return log;
}

/** One topic (or kind of problem) at the cram's start and at its end: in-scope objectives verified or mastered (or ready). */
export interface CramTopicChange {
  id: string;
  name: string;
  total: number;
  before: number;
  after: number;
}

/** What a finished cram did, from its start (`budget.since`) to Stop (`endedAt`), and nothing after. */
export interface CramResultsData {
  since: string;
  endedAt: string;
  /** The student's day the cram ended on. */
  lastDay: string;
  /** Minutes studied in the cram, and by source. */
  minutes: number;
  sources: { app: number; claude: number; timer: number };
  split: StudySplit;
  /** Minutes the plan asked for, from the cram's first day through the day it ended. */
  goalMinutes: number;
  /** Share ready at the start and at the end (objectives verified or mastered; kinds of problem ready once the exam is mapped). */
  ready: { before: number; after: number; done: number; total: number; doneBefore: number };
  topics: CramTopicChange[];
  unit: CramPlan["unit"];
  studyLoaded: boolean;
}

/**
 * The cram's results (owner, 2026-11-25): the whole cram, from its start to Stop. Mastery is
 * recomputed from the evidence log at both ends (the store has all of it), readiness from the
 * problem attempts before each; time is `useStudyDays` bounded at both ends.
 */
export function useCramResults(course: Course | undefined, exam: Exam | null, log: StudyLog | null, endedAt: string): CramResultsData | null {
  const { objectives, relations, evidence, questionBank } = useOrca();
  const dayKey = useDayKey();
  const budget = exam?.scope?.budget;
  const days = useStudyDays(course && budget ? { courseId: course.id, since: budget.since, until: endedAt } : { courseId: "", since: "", until: endedAt });
  return useMemo(() => {
    if (!course || !exam || !budget) return null;
    const catalogue = objectives[course.id] ?? {};
    const types = exam.scope?.problemTypes ?? [];
    const topicsAt = (at: string): CramPlanInput["topics"] => {
      if (types.length) return typePlanTopics(examReadiness(types, (log?.attempts ?? []).filter((a) => a.at < at)));
      const m = courseMastery({ courseId: course.id, topicIds: trailTopics(course).map((t) => t.id), bank: questionBank[course.id] ?? {}, catalogue, evidence: evidence.filter((e) => e.at < at), now: new Date(at), dayKey });
      return planTopics(exam, course.topics, catalogue, relations[course.id] ?? [], (id) => m.objectives.get(id)?.status ?? "unseen");
    };
    const count = (ts: CramPlanInput["topics"]) =>
      new Map(ts.map((t) => {
        const inScope = t.objectives.filter((o) => o.weight > 0);
        return [t.id, { name: t.name, total: inScope.length, done: inScope.filter((o) => o.status === "verified" || o.status === "mastered").length }] as const;
      }));
    const start = count(topicsAt(budget.since));
    const end = count(topicsAt(endedAt));
    const topics = [...end].map(([id, e]) => ({ id, name: e.name, total: e.total, before: start.get(id)?.done ?? 0, after: e.done }));
    const total = topics.reduce((s, t) => s + t.total, 0);
    const doneBefore = topics.reduce((s, t) => s + t.before, 0);
    const done = topics.reduce((s, t) => s + t.after, 0);
    const split: StudySplit = {};
    const sources = { app: 0, claude: 0, timer: 0 };
    for (const d of days ?? []) {
      split[d.day] = { app: d.app, claude: d.claude, timer: d.timer };
      sources.app += d.app;
      sources.claude += d.claude;
      sources.timer += d.timer;
    }
    const lastDay = dayKey(endedAt);
    const goalMinutes = Object.entries(perDayOf(budget, exam.date, dayKey)).reduce((s, [day, h]) => (day >= dayKey(budget.since) && day <= lastDay ? s + h * 60 : s), 0);
    return {
      since: budget.since,
      endedAt,
      lastDay,
      minutes: sources.app + sources.claude + sources.timer,
      sources,
      split,
      goalMinutes,
      ready: { before: total ? doneBefore / total : 0, after: total ? done / total : 0, done, total, doneBefore },
      topics,
      unit: types.length ? "problem-type" : "topic",
      studyLoaded: days !== null,
    };
  }, [course, exam, budget, log, objectives, relations, evidence, questionBank, dayKey, days, endedAt]);
}

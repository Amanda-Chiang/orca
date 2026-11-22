"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionLine } from "@/lib/connector/mcp";
import type { Course, Exam } from "@/lib/data";
import { claudeMinutesByDay, connectorMinutesByDay, planTopics, spentMinutesByDayInOrca, spentMinutesInOrca, touchedObjectives } from "@/lib/course/cram-page";
import { cramPlan, type CramPlan, type CramPlanInput, type SpentMinutes } from "@/lib/mastery/cram-plan";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";

/**
 * The exam's cram plan, computed in the browser from the store (cram mode contract, section 6):
 * null until the exam has a time budget (set at the page's setup). Spent minutes are the course's
 * finished sessions since the budget's `since` plus the time studied with Claude (its connector
 * evidence in stretches, `connectorMinutesByDay`, as `course_state` counts it), split at today and by
 * day. The topics' covered state reads the store's evidence since then. The vault's held-back exams
 * are the practice tests the plan places on days.
 */
export function useCramPlan(course: Course | undefined, exam: Exam | null, mastery: CourseMastery | undefined, log: StudyLog | null = null): { plan: CramPlan; spentMinutes: SpentMinutes; topics: CramPlanInput["topics"] } | null {
  const { objectives, relations, results, evidence, materials } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const budget = exam?.scope?.budget;
  return useMemo(() => {
    if (!course || !mastery || !exam || !budget) return null;
    const today = dayKey(new Date(nowMs).toISOString());
    const inOrca = spentMinutesInOrca(results, course.id, budget.since, today, dayKey);
    const spentByDay = spentMinutesByDayInOrca(results, course.id, budget.since, dayKey);
    const mine = evidence.filter((e) => e.courseId === course.id && e.at >= budget.since);
    const estimated = connectorMinutesByDay(mine.map((e) => ({ at: e.at, source: "source" in e ? e.source : null, flagSource: e.kind === "confusion" ? e.flagSource : null })), dayKey);
    // What Claude logged for a day (log_session) wins when it's more than the estimate; sittings before the cram started don't count.
    const logged: Record<string, number> = {};
    for (const sitting of log?.sittings ?? []) if (sitting.at >= budget.since) logged[sitting.day] = (logged[sitting.day] ?? 0) + sitting.minutes;
    const withClaude = claudeMinutesByDay(estimated, logged);
    const spentMinutes = { ...inOrca };
    for (const [day, minutes] of withClaude) {
      spentByDay[day] = (spentByDay[day] ?? 0) + minutes;
      if (day === today) spentMinutes.today += minutes;
      else if (day < today) spentMinutes.beforeToday += minutes;
    }
    const topics = planTopics(exam, course.topics, objectives[course.id] ?? {}, relations[course.id] ?? [], (id) => mastery.objectives.get(id)?.status ?? "unseen");
    const touchedObjectiveIds = touchedObjectives(evidence, course.id, budget.since);
    // The reserved exam is the one to sit: it goes first, so it gets the last study day.
    const mocks = materials.filter((m) => m.courseId === course.id && m.heldBack).sort((a, b) => Number(b.id === exam.scope?.reservedMaterialId) - Number(a.id === exam.scope?.reservedMaterialId)).map((m) => ({ materialId: m.id, name: m.filename, ...(exam.scope?.format?.minutes ? { minutes: exam.scope.format.minutes } : {}) }));
    return { plan: cramPlan({ today, examDate: exam.date, budget, topics, spentMinutes, spentByDay, touchedObjectiveIds, mocks }), spentMinutes, topics };
  }, [exam, budget, course, objectives, relations, results, evidence, materials, mastery, dayKey, nowMs, log]);
}

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
}

/**
 * The sittings the student's Claude logged for this course (`GET /api/study-log`): null until read,
 * read again when the tab comes back into view (a sitting is logged from the chat, in another tab).
 */
export function useStudyLog(courseId: string | undefined): StudyLog | null {
  const [log, setLog] = useState<StudyLog | null>(null);
  useEffect(() => {
    if (!courseId) return;
    let live = true;
    const read = () =>
      fetch(`/api/study-log?courseId=${courseId}`, { cache: "no-store" })
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
  }, [courseId]);
  return log;
}

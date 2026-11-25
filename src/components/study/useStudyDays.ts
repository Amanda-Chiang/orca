"use client";

import { useMemo } from "react";
import { studyDays, type StudyDay } from "@/lib/course/study-time";
import { timerEnd } from "@/lib/study-timer";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { useStudyTime } from "@/components/study/StudyTime";

/**
 * Every course's study time by day and source (src/lib/course/study-time.ts): finished sessions and
 * Claude's connector evidence from the store, logged sittings and timers from the server, and a
 * running timer up to this minute. With `scope`, one course's time from `since` on (the cram plan
 * counts from the cram's start). Null until the server's part is read, so a missing piece never shows
 * as zero. The progress page and the cram page's Your Progress both read this, so they agree.
 */
export function useStudyDays(scope?: { courseId: string; since: string; until?: string }): StudyDay[] | null {
  const { results, evidence, courses } = useOrca();
  const { server, running } = useStudyTime();
  const dayOf = useDayKey();
  const nowMs = useNow();
  const courseId = scope?.courseId;
  const since = scope?.since ?? "";
  // `until` (a finished cram's end): nothing from then on, and a timer cut off there.
  const until = scope?.until;
  return useMemo(() => {
    if (!server) return null;
    const live = new Set(courses.map((c) => c.id));
    const keep = (c: string) => live.has(c) && (courseId === undefined || c === courseId);
    const before = (at: string) => until === undefined || at < until;
    // A running timer counts up to this minute (not before the clock is known).
    const now = new Date(nowMs);
    const timers = [...server.timers, ...(running && nowMs > Date.parse(running.startedAt) ? [{ ...running, endedAt: timerEnd(running.startedAt, now).toISOString() }] : [])]
      .filter((t) => keep(t.courseId) && t.startedAt >= since && before(t.startedAt))
      .map((t) => (until !== undefined && t.endedAt !== null && t.endedAt > until ? { ...t, endedAt: until } : t));
    return studyDays({
      results: results.filter((r) => keep(r.courseId) && r.finishedAt >= since && before(r.finishedAt)),
      activity: evidence.filter((e) => keep(e.courseId) && e.at >= since && before(e.at)).map((e) => ({ courseId: e.courseId, at: e.at, source: "source" in e ? e.source : null, flagSource: e.kind === "confusion" ? e.flagSource : null })),
      sittings: server.sittings.filter((s) => keep(s.courseId) && s.at >= since && before(s.at)),
      timers,
      dayOf,
    });
  }, [server, running, results, evidence, courses, dayOf, nowMs, courseId, since, until]);
}

"use client";

import { useMemo } from "react";
import { studyDays, type StudyDay } from "@/lib/course/study-time";
import { useDayKey, useOrca } from "@/lib/store";
import { useStudyTime } from "@/components/study/StudyTime";

/**
 * Every course's study time by day and source (src/lib/course/study-time.ts): finished sessions and
 * Claude's connector evidence from the store, logged sittings and timers from the server. Null until
 * the server's part is read, so a missing piece never shows as zero.
 */
export function useStudyDays(): StudyDay[] | null {
  const { results, evidence, courses } = useOrca();
  const { server } = useStudyTime();
  const dayOf = useDayKey();
  return useMemo(() => {
    if (!server) return null;
    const live = new Set(courses.map((c) => c.id));
    return studyDays({
      results: results.filter((r) => live.has(r.courseId)),
      activity: evidence.filter((e) => live.has(e.courseId)).map((e) => ({ courseId: e.courseId, at: e.at, source: "source" in e ? e.source : null, flagSource: e.kind === "confusion" ? e.flagSource : null })),
      sittings: server.sittings,
      timers: server.timers,
      dayOf,
    });
  }, [server, results, evidence, courses, dayOf]);
}

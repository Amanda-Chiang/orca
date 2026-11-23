"use client";

import { useState } from "react";
import { useOrca } from "@/lib/store";
import { clock } from "@/lib/study-timer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useElapsed, useStudyTime } from "@/components/study/StudyTime";

/**
 * Start study session (owner, 2026-11-22): a timer for time Orca can't see (reading, homework, office
 * hours). Pick the course (fixed when `courseId` is given, as on a course page), start, then Stop to
 * record it or Discard to drop it. Shown on the progress page and a course's page.
 */
export function StudyTimerCard({ courseId, compact = false }: { courseId?: string; compact?: boolean }) {
  const { courses } = useOrca();
  const { running, start, stop, discard, busy, problem } = useStudyTime();
  const [picked, setPicked] = useState(courseId ?? courses[0]?.id ?? "");
  const elapsed = useElapsed(running?.startedAt ?? null);
  const target = courseId ?? picked;
  const runningCourse = courses.find((c) => c.id === running?.courseId);
  const elsewhere = running !== null && courseId !== undefined && running.courseId !== courseId;

  return (
    <Card radius={24} lip={5} className={`flex flex-col gap-[10px] ${compact ? "px-[18px] py-[14px]" : "px-[22px] pb-[18px] pt-[18px]"}`} data-part="study-timer" data-running={running ? "1" : undefined}>
      <div className="flex items-center gap-[10px]">
        <span className={`h-[12px] w-[12px] shrink-0 rounded-full ${running ? "animate-pulse bg-study-mint" : "bg-alice-deep"}`} aria-hidden />
        <h2 className={`${compact ? "text-[17px]" : "text-[20px]"} font-bold text-prussian`}>{running ? `Studying ${runningCourse?.name ?? "a course"}` : "Study session"}</h2>
      </div>
      {running ? (
        <>
          <p className={`${compact ? "text-[32px]" : "text-[48px]"} font-bold leading-none tabular-nums text-prussian`} data-part="study-timer-clock">
            {clock(elapsed)}
          </p>
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button size="sm" disabled={busy} onClick={() => void stop()} data-part="study-timer-stop">
              Stop and save
            </Button>
            <button type="button" disabled={busy} onClick={() => void discard()} data-part="study-timer-discard" className="text-[13px] font-bold text-wisteria-deep underline disabled:opacity-60">
              Discard
            </button>
          </div>
          {elsewhere && <p className="text-[12px] font-medium text-wisteria-deep">Running for another course. Stop it to start one here.</p>}
          <p className="text-[12px] font-medium text-wisteria-deep">Counts up to 4 hours; time also spent in an Orca quiz counts once.</p>
        </>
      ) : courses.length === 0 ? (
        <p className="text-[14px] font-medium text-wisteria-deep">Add a course to time your studying.</p>
      ) : (
        <>
          <p className="text-[13px] font-medium text-wisteria-deep">For time Orca can&apos;t see: reading, homework, office hours.</p>
          <div className="flex flex-wrap items-center gap-[8px]">
            {courseId === undefined && <Select label="Course" size="sm" value={picked} options={courses.map((c) => c.id)} labels={Object.fromEntries(courses.map((c) => [c.id, c.name]))} onChange={setPicked} data-part="study-timer-course" />}
            <Button size="sm" disabled={busy || !target} onClick={() => void start(target)} data-part="study-timer-start">
              Start study session
            </Button>
          </div>
        </>
      )}
      {problem && (
        <p role="alert" className="text-[13px] font-semibold text-prussian">
          {problem}
        </p>
      )}
    </Card>
  );
}

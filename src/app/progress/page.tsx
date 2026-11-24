"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { addDays } from "@/lib/mastery/agenda";
import { examMinutes, hoursMinutes, minutesOf, type StudyDay } from "@/lib/course/study-time";
import { fadeUp, stagger } from "@/lib/motion";
import { useDayKey, useOrca, useStreak } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Card } from "@/components/ui/Card";
import { StudyTimerCard } from "@/components/study/StudyTimerCard";
import { useStudyTime } from "@/components/study/StudyTime";
import { useStudyDays } from "@/components/study/useStudyDays";
import { SourcesCard, StatTile, TILE_ACCENTS } from "@/components/study/StudyParts";

/** A course's color in the charts, by its order on the map. */
const COURSE_COLORS = ["bg-study-sky", "bg-study-gold", "bg-study-rose", "bg-study-mint", "bg-study-coral", "bg-study-violet"] as const;
const CHART_DAYS = 14;

/** "Tue 11" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
const dayChip = (day: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric" }) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
};
const sumDays = (days: readonly StudyDay[], from: string, to: string) => days.filter((d) => d.day >= from && d.day <= to).reduce((s, d) => s + minutesOf(d), 0);

/**
 * Your progress (owner, 2026-11-22): every minute studied, across courses and sources. Tiles for
 * today, the past week (against the week before), all time and the streak; the study timer; the last
 * two weeks as bars colored by course; where the time came from (Orca, Claude, the timer); and each
 * course with its exams, each exam's time counted from the exam before it.
 */
export default function ProgressPage() {
  const { courses, exams, hydrated } = useOrca();
  const days = useStudyDays();
  const { problem } = useStudyTime();
  const streak = useStreak();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const today = nowMs ? dayKey(new Date(nowMs).toISOString()) : "";
  const colorOf = useMemo(() => new Map(courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]])), [courses]);

  return (
    <Screen bg="alice" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton href="/" />
        <div>
          <h1 className="text-[40px] font-bold leading-none text-prussian">Your progress</h1>
          <p className="mt-[5px] text-[14px] font-medium text-wisteria-deep" data-part="progress-since">
            {days && days.length > 0 ? `Studying since ${dayChip(days[0].day, { month: "short", day: "numeric", year: "numeric" })} · ${new Set(days.filter((d) => minutesOf(d) > 0).map((d) => d.day)).size} days studied` : "Every minute you study, in Orca, with Claude or on the timer."}
          </p>
        </div>
      </header>

      {!days || !today ? (
        <p className="px-[24px] pt-[24px] text-[16px] font-semibold text-wisteria-deep" data-part="progress-loading">
          {problem ?? (hydrated ? "Adding up your study time…" : "")}
        </p>
      ) : (
        <motion.div variants={stagger(0.05, 0.06)} initial="hidden" animate="show" className="flex flex-col gap-[14px] px-[24px] pb-[32px] pt-[20px]" data-part="progress-page">
          <Tiles days={days} today={today} streak={streak} />
          <div className="flex items-stretch gap-[14px]">
            <motion.div variants={fadeUp} className="min-w-0 flex-1">
              <DayChart days={days} today={today} colorOf={colorOf} courses={courses} />
            </motion.div>
            <motion.div variants={fadeUp} className="flex w-[340px] shrink-0 flex-col gap-[14px]">
              <StudyTimerCard />
              <SourcesCard totals={{ app: days.reduce((t, d) => t + d.app, 0), claude: days.reduce((t, d) => t + d.claude, 0), timer: days.reduce((t, d) => t + d.timer, 0) }} />
            </motion.div>
          </div>
          <motion.div variants={fadeUp}>
            <CourseCards days={days} today={today} courses={courses} exams={exams} colorOf={colorOf} />
          </motion.div>
        </motion.div>
      )}
    </Screen>
  );
}

function Tiles({ days, today, streak }: { days: StudyDay[]; today: string; streak: number }) {
  const week = sumDays(days, addDays(today, -6), today);
  const before = sumDays(days, addDays(today, -13), addDays(today, -7));
  const delta = week - before;
  const all = days.reduce((s, d) => s + minutesOf(d), 0);
  return (
    <motion.div variants={fadeUp} className="grid grid-cols-4 gap-[14px]">
      <StatTile label="Today" value={hoursMinutes(sumDays(days, today, today))} accent={TILE_ACCENTS[0]} part="progress-today" />
      <StatTile label="Past 7 days" value={hoursMinutes(week)} note={before || week ? `${delta >= 0 ? "▲" : "▼"} ${hoursMinutes(Math.abs(delta))} vs the week before` : null} accent={TILE_ACCENTS[1]} part="progress-week" />
      <StatTile label="All time" value={hoursMinutes(all)} accent={TILE_ACCENTS[2]} part="progress-all" />
      <StatTile label="Streak" value={`${streak} ${streak === 1 ? "day" : "days"}`} accent={TILE_ACCENTS[3]} part="progress-streak" />
    </motion.div>
  );
}

/** The last two weeks: a bar per day, stacked by course in its color; hover for the minutes. */
function DayChart({ days, today, colorOf, courses }: { days: StudyDay[]; today: string; colorOf: Map<string, string>; courses: ReadonlyArray<{ id: string; name: string }> }) {
  const HEIGHT = 190;
  const range = Array.from({ length: CHART_DAYS }, (_, i) => addDays(today, i - CHART_DAYS + 1));
  const byDay = new Map(range.map((d) => [d, days.filter((x) => x.day === d && minutesOf(x) > 0)]));
  const totals = range.map((d) => (byDay.get(d) ?? []).reduce((s, x) => s + minutesOf(x), 0));
  const max = Math.max(60, ...totals);
  const name = new Map(courses.map((c) => [c.id, c.name]));
  const shown = courses.filter((c) => range.some((d) => (byDay.get(d) ?? []).some((x) => x.courseId === c.id)));
  return (
    <Card radius={24} lip={5} className="flex h-full flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]" data-part="progress-chart">
      <h2 className="text-[20px] font-bold text-prussian">Last two weeks</h2>
      <ol className="flex items-end gap-[6px]" aria-label="Minutes studied by day">
        {range.map((d, i) => {
          const parts = byDay.get(d) ?? [];
          const title = parts.length ? `${dayChip(d)}: ${parts.map((x) => `${name.get(x.courseId) ?? "A course"} ${hoursMinutes(minutesOf(x))}`).join(", ")}` : `${dayChip(d)}: nothing studied`;
          return (
            <li key={d} className="flex min-w-0 flex-1 flex-col items-center gap-[6px]" title={title} data-part="progress-day" data-day={d} data-minutes={Math.round(totals[i])}>
              <span className="h-[14px] text-[11px] font-bold text-prussian">{totals[i] ? hoursMinutes(totals[i]) : ""}</span>
              <div className="flex w-full max-w-[34px] flex-col justify-end overflow-hidden rounded-[8px] bg-alice" style={{ height: HEIGHT }}>
                {parts.map((x) => (
                  <div key={x.courseId} className={colorOf.get(x.courseId) ?? "bg-wisteria"} style={{ height: Math.max(2, (minutesOf(x) / max) * HEIGHT) }} />
                ))}
              </div>
              <span className={`text-[11px] font-bold ${d === today ? "text-wisteria-deep" : "text-prussian"}`}>{d === today ? "Today" : dayChip(d, { weekday: "narrow" })}</span>
            </li>
          );
        })}
      </ol>
      {shown.length > 0 ? (
        <p className="flex flex-wrap gap-[12px] text-[12px] font-semibold text-prussian" aria-label="Key">
          {shown.map((c) => (
            <span key={c.id}>
              <span className={`mr-[5px] inline-block h-[10px] w-[10px] rounded-full align-middle ${colorOf.get(c.id)}`} />
              {c.name}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-[13px] font-medium text-wisteria-deep">Nothing studied in the last two weeks. Start a study session or a quick review.</p>
      )}
    </Card>
  );
}

/** Each course: its time all time and this week, and each exam's time (since the exam before it). */
function CourseCards({ days, today, courses, exams, colorOf }: { days: StudyDay[]; today: string; courses: ReadonlyArray<{ id: string; name: string; slug: string }>; exams: ReadonlyArray<{ id: string; courseId: string; title: string; date: string }>; colorOf: Map<string, string> }) {
  const perExam = examMinutes(days, exams);
  if (courses.length === 0) return <p className="text-[14px] font-medium text-wisteria-deep">No courses yet.</p>;
  return (
    <div className="grid grid-cols-2 gap-[14px]" data-part="progress-courses">
      {courses.map((c) => {
        const mine = days.filter((d) => d.courseId === c.id);
        const total = mine.reduce((s, d) => s + minutesOf(d), 0);
        const week = sumDays(mine, addDays(today, -6), today);
        const list = exams.filter((e) => e.courseId === c.id).sort((a, b) => a.date.localeCompare(b.date));
        const most = Math.max(1, ...list.map((e) => perExam.get(e.id) ?? 0));
        return (
          <Card key={c.id} radius={24} lip={5} className="flex flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="progress-course" data-course={c.id}>
            <div className="flex items-center justify-between gap-[10px]">
              <Link href={`/course/${c.slug}`} className="flex min-w-0 items-center gap-[8px]">
                <span className={`h-[14px] w-[14px] shrink-0 rounded-full ${colorOf.get(c.id)}`} aria-hidden />
                <span className="truncate text-[18px] font-bold text-prussian">{c.name}</span>
              </Link>
              <span className="shrink-0 text-[14px] font-bold text-prussian" data-part="progress-course-total">
                {hoursMinutes(total)}
                <span className="font-semibold text-wisteria-deep"> · {hoursMinutes(week)} this week</span>
              </span>
            </div>
            {list.length === 0 ? (
              <p className="text-[13px] font-medium text-wisteria-deep">No exams yet. Add them with Edit Exams on the course page to see time per exam.</p>
            ) : (
              <ul className="flex flex-col gap-[8px]">
                {list.map((e) => {
                  const minutes = perExam.get(e.id) ?? 0;
                  const left = Math.round((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
                  return (
                    <li key={e.id} className="flex flex-col gap-[4px]" data-part="progress-exam" data-exam={e.id}>
                      <div className="flex items-baseline justify-between gap-[8px] text-[13px] font-semibold">
                        <span className="truncate text-prussian">
                          {e.title} <span className="font-medium text-wisteria-deep">· {dayChip(e.date, { month: "short", day: "numeric" })} · {left > 1 ? `in ${left} days` : left === 1 ? "tomorrow" : left === 0 ? "today" : "done"}</span>
                        </span>
                        <span className="shrink-0 text-prussian" data-part="progress-exam-minutes">{hoursMinutes(minutes)}</span>
                      </div>
                      <div className="h-[8px] w-full overflow-hidden rounded-pill bg-alice">
                        <div className={`h-full rounded-pill ${colorOf.get(c.id)} ${left < 0 ? "opacity-50" : ""}`} style={{ width: `${(minutes / most) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

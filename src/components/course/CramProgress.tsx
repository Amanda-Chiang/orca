"use client";

import { motion } from "motion/react";
import type { CramCovered, CramPlan, CramPlanInput } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { fadeUp } from "@/lib/motion";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { StudySplit } from "@/components/course/useCram";
import { hoursMinutes } from "@/lib/course/study-time";
import { SOURCE_STYLE, SourcesCard, StatTile, TILE_ACCENTS } from "@/components/study/StudyParts";
import { StudyTimerCard } from "@/components/study/StudyTimerCard";

const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : (Math.round(h * 10) / 10).toFixed(1));
/** "Tue 11" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
const dayChip = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
};
const isVerified = (s: ObjectiveStatus) => s === "verified" || s === "mastered";

const COVERED: Record<CramCovered, { label: string; chip: string }> = {
  untouched: { label: "Not started", chip: "bg-parchment text-wisteria-deep ring-alice-deep" },
  "in-progress": { label: "In progress", chip: "bg-periwinkle text-prussian ring-periwinkle-deep" },
  done: { label: "Done", chip: "bg-wisteria text-parchment ring-wisteria-deep" },
};

/**
 * The cram page's Your Progress tab (owner, 2026-11-22: it mirrors the overall progress page): tiles
 * for the budget, today, the share ready and the exam's day; each day of the cram (and today) as
 * planned against studied, studied colored by source (in Orca, with Claude, on the study timer); the
 * study timer for this course; where the time went; and every topic (or kind of problem) with its
 * covered state and verified share. The minutes are the progress page's (`useStudyDays`), counted
 * from the cram's start; nothing is stored here.
 */
export function CramProgress({ plan, topics, studied, studiedToday, split, examDate, courseId, studyLoaded, today }: { plan: CramPlan; topics: CramPlanInput["topics"]; studied: number; studiedToday: number; split: StudySplit; examDate: string; courseId: string; studyLoaded: boolean; today: string }) {
  const totalHours = Object.values(plan.perDay).reduce((sum, h) => sum + h, 0);
  const todayDay = plan.days.find((d) => d.today);
  const plannedToday = todayDay ? todayDay.hours * 60 : 0;
  const problems = plan.unit === "problem-type";
  const wait = "…";
  const totals = { app: 0, claude: 0, timer: 0 };
  for (const x of Object.values(split)) {
    totals.app += x.app;
    totals.claude += x.claude;
    totals.timer += x.timer;
  }
  return (
    <div className="flex w-full flex-col gap-[14px]" data-part="cram-progress">
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-[14px]">
        <StatTile label="Hours left" value={`${hoursText(plan.hoursLeft)} of ${hoursText(totalHours)} h`} share={totalHours ? 1 - plan.hoursLeft / totalHours : 0} accent={TILE_ACCENTS[0]} part="cram-budget" note={studyLoaded ? `${hoursMinutes(studied)} studied` : wait} />
        <StatTile label="Today" value={studyLoaded ? hoursMinutes(studiedToday) : wait} share={plannedToday ? studiedToday / plannedToday : null} accent={TILE_ACCENTS[1]} part="cram-spent" note={plan.daysLeft === 0 ? "Exam day: light review only" : plannedToday ? `of ${hoursMinutes(plannedToday)} · ${hoursMinutes(plan.minutesToday)} left` : "A day off"} />
        <StatTile label="Ready" value={`${Math.round(plan.verified.share * 100)}%`} share={plan.verified.share} accent={TILE_ACCENTS[2]} part="cram-plan" note={`${plan.verified.done} of ${plan.verified.total} ${problems ? "kinds of problem" : "objectives"}`} />
        <StatTile label="Exam" value={plan.daysLeft === 0 ? "Today" : plan.daysLeft === 1 ? "Tomorrow" : `In ${plan.daysLeft} days`} accent={TILE_ACCENTS[3]} part="cram-exam-day" note={dayChip(examDate)} />
      </motion.div>

      <div className="flex items-stretch gap-[14px]">
        <motion.div variants={fadeUp} className="min-w-0 flex-1">
          <Card radius={24} lip={5} className="flex h-full flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-days-chart">
            <h2 className="text-[20px] font-bold text-prussian">Each day: planned and studied</h2>
            <DayBars plan={plan} split={split} today={today} />
            <p className="flex flex-wrap gap-[12px] text-[12px] font-semibold text-prussian" aria-label="Key">
              <span><span className="mr-[5px] inline-block h-[10px] w-[10px] rounded-full ring-2 ring-inset ring-alice-deep align-middle" />Planned</span>
              {SOURCE_STYLE.map((x) => (
                <span key={x.key}><span className={`mr-[5px] inline-block h-[10px] w-[10px] rounded-full align-middle ${x.color}`} />{x.label}</span>
              ))}
            </p>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp} className="flex w-[340px] shrink-0 flex-col gap-[14px]">
          <StudyTimerCard courseId={courseId} compact />
          <SourcesCard totals={totals} title="Since the cram started" />
        </motion.div>
      </div>

      <motion.div variants={fadeUp}>
          <Card radius={24} lip={5} className="flex flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-progress-topics">
            <h2 className="text-[20px] font-bold text-prussian">{problems ? "Kinds of problem" : "Topics"}</h2>
            {plan.topics.length === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">Nothing in scope yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-[24px] gap-y-[10px]">
                {plan.topics.map((t) => {
                  const inScope = (topics.find((x) => x.id === t.id)?.objectives ?? []).filter((o) => o.weight > 0);
                  const verified = inScope.filter((o) => isVerified(o.status)).length;
                  return (
                    <li key={t.id} className="flex flex-col gap-[4px]" data-part="cram-progress-topic" data-topic={t.id} data-covered={t.covered}>
                      <div className="flex items-center justify-between gap-[8px]">
                        <span className="truncate text-[14px] font-bold text-prussian" title={t.name}>{t.name}</span>
                        <span className={`shrink-0 rounded-pill px-[8px] py-[1px] text-[11px] font-bold ring-2 ring-inset ${COVERED[t.covered].chip}`}>{COVERED[t.covered].label}</span>
                      </div>
                      <div className="flex items-center gap-[8px]">
                        <ProgressBar value={inScope.length ? verified / inScope.length : 0} height={6} label={`${t.name} verified`} className="flex-1" />
                        <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">{verified}/{inScope.length}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
      </motion.div>
    </div>
  );
}

/**
 * A column per day of the cram, plus today and any day studied since it started: the planned hours as
 * an outline, the minutes studied stacked by source in the progress page's colors (hover for each).
 */
function DayBars({ plan, split, today }: { plan: CramPlan; split: StudySplit; today: string }) {
  const HEIGHT = 170;
  // Today shows even on a day off, so a session started today is on the chart.
  const extra = [...Object.keys(split), ...(plan.daysLeft > 0 ? [today] : [])].filter((day) => !(day in plan.perDay));
  const dayList = [...new Set([...plan.days.map((d) => d.day), ...extra])].sort();
  if (dayList.length === 0) return <p className="text-[14px] font-medium text-wisteria-deep">No days before the exam.</p>;
  const sum = (day: string) => (split[day]?.app ?? 0) + (split[day]?.claude ?? 0) + (split[day]?.timer ?? 0);
  const max = Math.max(60, ...dayList.map((d) => Math.max((plan.perDay[d] ?? 0) * 60, sum(d))));
  const px = (minutes: number) => Math.max(minutes > 0 ? 2 : 0, Math.round((minutes / max) * HEIGHT));
  return (
    <ol className="flex items-end gap-[10px] overflow-x-auto pb-[2px]" aria-label="Minutes by day">
      {dayList.map((day) => {
        const d = plan.days.find((x) => x.day === day);
        const planned = (plan.perDay[day] ?? 0) * 60;
        const studied = sum(day);
        const isToday = day === today;
        const title = `${dayChip(day)}: ${hoursMinutes(studied)} studied (${SOURCE_STYLE.map((x) => `${hoursMinutes(split[day]?.[x.key] ?? 0)} ${x.label.toLowerCase()}`).join(", ")}) of ${hoursMinutes(planned)} planned`;
        return (
          <li key={day} className="flex min-w-[52px] flex-1 flex-col items-center gap-[6px]" title={title} data-part="cram-day-bar" data-day={day} data-today={isToday ? "1" : undefined} data-met={d?.met === null || d === undefined ? undefined : d.met ? "1" : "0"}>
            <span className="h-[14px] text-[12px] font-bold text-prussian">{studied > 0 ? hoursMinutes(studied) : ""}</span>
            <div className="relative flex w-full max-w-[56px] items-end justify-center rounded-[10px] bg-alice" style={{ height: HEIGHT }}>
              {planned > 0 && <div className="absolute bottom-0 w-full rounded-[10px] ring-2 ring-inset ring-alice-deep" style={{ height: px(planned) }} />}
              <div className="relative flex w-[70%] flex-col justify-end overflow-hidden rounded-[6px]">
                {[...SOURCE_STYLE].reverse().map((x) => {
                  const m = split[day]?.[x.key] ?? 0;
                  return m > 0 ? <div key={x.key} className={x.color} style={{ height: px(m) }} /> : null;
                })}
              </div>
            </div>
            <span className={`text-[12px] font-bold ${isToday ? "text-wisteria-deep" : "text-prussian"}`}>{isToday ? "Today" : dayChip(day)}</span>
            <span className="text-[11px] font-semibold text-wisteria-deep">{planned > 0 ? `${hoursText(planned / 60)} h` : "Day off"}</span>
          </li>
        );
      })}
    </ol>
  );
}

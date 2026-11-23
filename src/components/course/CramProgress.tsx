"use client";

import { motion } from "motion/react";
import type { CramCovered, CramPlan, CramPlanInput } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { fadeUp } from "@/lib/motion";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { StudySplit } from "@/components/course/useCram";

const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : (Math.round(h * 10) / 10).toFixed(1));
const minutesText = (m: number) => `${Math.round(m)} min`;
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
 * The cram page's Your Progress tab (owner, 2026-11-22: the old hours line as a dashboard): the
 * budget studied, today against its plan, the share verified and the exam's day as tiles; each day
 * of the cram as planned against studied, the studied part split into the app and Claude; and every
 * topic (or kind of problem) with its covered state and verified share. Everything comes from the
 * plan the page already computes; nothing is stored.
 */
export function CramProgress({ plan, topics, studied, studiedToday, split, examDate }: { plan: CramPlan; topics: CramPlanInput["topics"]; studied: number; studiedToday: number; split: StudySplit; examDate: string }) {
  const totalHours = Object.values(plan.perDay).reduce((sum, h) => sum + h, 0);
  const todayDay = plan.days.find((d) => d.today);
  const plannedToday = todayDay ? todayDay.hours * 60 : 0;
  const problems = plan.unit === "problem-type";
  return (
    <div className="flex w-full flex-col gap-[12px]" data-part="cram-progress">
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-[12px]">
        <Tile label="Hours left" value={`${hoursText(plan.hoursLeft)} of ${hoursText(totalHours)} h`} share={totalHours ? 1 - plan.hoursLeft / totalHours : 0} part="cram-budget" note={`${minutesText(studied)} studied`} />
        <Tile label="Today" value={plannedToday ? `${Math.round(studiedToday)} of ${Math.round(plannedToday)} min` : `${Math.round(studiedToday)} min`} share={plannedToday ? studiedToday / plannedToday : null} part="cram-spent" note={plan.daysLeft === 0 ? "Exam day: light review only" : plannedToday ? `${minutesText(plan.minutesToday)} left today` : "A day off"} />
        <Tile label={problems ? "Ready" : "Verified"} value={`${Math.round(plan.verified.share * 100)}%`} share={plan.verified.share} part="cram-plan" note={`${plan.verified.done} of ${plan.verified.total} ${problems ? "kinds of problem" : "objectives"}`} />
        <Tile label="Exam" value={plan.daysLeft === 0 ? "Today" : plan.daysLeft === 1 ? "Tomorrow" : `In ${plan.daysLeft} days`} share={null} part="cram-exam-day" note={dayChip(examDate)} />
      </motion.div>

      <div className="flex items-start gap-[12px]">
        <motion.div variants={fadeUp} className="min-w-0 flex-1">
          <Card radius={24} lip={5} className="flex flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-days-chart">
            <h2 className="text-[20px] font-bold text-prussian">Each day: planned and studied</h2>
            {plan.days.length === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">No days before the exam.</p>
            ) : (
              <DayBars plan={plan} split={split} />
            )}
            <p className="flex flex-wrap gap-[12px] text-[12px] font-semibold text-wisteria-deep" aria-label="Key">
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] ring-2 ring-inset ring-alice-deep align-middle" />Planned</span>
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] bg-wisteria align-middle" />In Orca</span>
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] bg-periwinkle align-middle" />With Claude</span>
            </p>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp} className="w-[380px] shrink-0">
          <Card radius={24} lip={5} className="flex flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-progress-topics">
            <h2 className="text-[20px] font-bold text-prussian">{problems ? "Kinds of problem" : "Topics"}</h2>
            {plan.topics.length === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">Nothing in scope yet.</p>
            ) : (
              <ul className="flex max-h-[300px] flex-col gap-[10px] overflow-y-auto pr-[4px]">
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
    </div>
  );
}

function Tile({ label, value, share, note, part }: { label: string; value: string; share: number | null; note?: string; part: string }) {
  return (
    <Card radius={20} lip={4} className="flex flex-col gap-[6px] px-[18px] pb-[14px] pt-[14px]" data-part={`${part}-tile`}>
      <p className="eyebrow text-[12px] text-wisteria-deep">{label}</p>
      <p className="text-[24px] font-bold leading-none text-prussian" data-part={part}>{value}</p>
      {share !== null && <ProgressBar value={Math.min(1, Math.max(0, share))} height={6} label={label} />}
      {note && <p className="text-[12px] font-medium text-wisteria-deep" data-part={`${part}-note`}>{note}</p>}
    </Card>
  );
}

/** A column per day of the cram: the planned hours as an outline, the minutes studied filled in (Orca below, Claude above). Future days have nothing studied yet. */
function DayBars({ plan, split }: { plan: CramPlan; split: StudySplit }) {
  const HEIGHT = 160;
  const max = Math.max(60, ...plan.days.map((d) => Math.max(d.hours * 60, (split[d.day]?.app ?? 0) + (split[d.day]?.claude ?? 0))));
  const px = (minutes: number) => Math.round((minutes / max) * HEIGHT);
  return (
    <ol className="flex items-end gap-[10px] overflow-x-auto pb-[2px]" aria-label="Minutes by day">
      {plan.days.map((d) => {
        const app = split[d.day]?.app ?? 0;
        const claude = split[d.day]?.claude ?? 0;
        const planned = d.hours * 60;
        const studied = app + claude;
        const title = `${dayChip(d.day)}: ${minutesText(studied)} studied (${minutesText(app)} in Orca, ${minutesText(claude)} with Claude) of ${minutesText(planned)} planned`;
        return (
          <li key={d.day} className="flex min-w-[52px] flex-1 flex-col items-center gap-[6px]" title={title} data-part="cram-day-bar" data-day={d.day} data-today={d.today ? "1" : undefined} data-met={d.met === null ? undefined : d.met ? "1" : "0"}>
            <span className="text-[12px] font-bold text-prussian">{d.past || d.today ? minutesText(studied) : ""}</span>
            <div className="relative flex w-full max-w-[56px] items-end justify-center" style={{ height: HEIGHT }}>
              {planned > 0 && <div className="absolute bottom-0 w-full rounded-[8px] ring-2 ring-inset ring-alice-deep" style={{ height: px(planned) }} />}
              <div className="relative flex w-[70%] flex-col justify-end overflow-hidden rounded-[6px]">
                {claude > 0 && <div className="bg-periwinkle" style={{ height: px(claude) }} />}
                {app > 0 && <div className="bg-wisteria" style={{ height: px(app) }} />}
              </div>
            </div>
            <span className={`text-[12px] font-bold ${d.today ? "text-wisteria-deep" : "text-prussian"}`}>{d.today ? "Today" : dayChip(d.day)}</span>
            <span className="text-[11px] font-semibold text-wisteria-deep">{planned > 0 ? `${hoursText(d.hours)} h` : "Day off"}</span>
          </li>
        );
      })}
    </ol>
  );
}

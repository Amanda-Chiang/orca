"use client";

import { motion } from "motion/react";
import type { CramPlan } from "@/lib/mastery/cram-plan";
import { fadeUp } from "@/lib/motion";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { CramResultsData } from "@/components/course/useCram";
import { DayBars } from "@/components/course/CramProgress";
import { hoursMinutes } from "@/lib/course/study-time";
import { SOURCE_STYLE, SourcesCard, StatTile, TILE_ACCENTS } from "@/components/study/StudyParts";

const pct = (share: number) => Math.round(share * 100);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * The cram's results (owner, 2026-11-25), unlike the Your Progress tab: only the cram, from its start
 * to Stop. Time studied in it against the hours planned through its last day, how ready the student
 * got (start to end), what changed per topic (or kind of problem), each day, and where the time went.
 */
export function CramResults({ data, plan }: { data: CramResultsData; plan: CramPlan }) {
  const problems = data.unit === "problem-type";
  const wait = "…";
  const gained = data.ready.done - data.ready.doneBefore;
  const points = pct(data.ready.after) - pct(data.ready.before);
  const changed = data.topics.filter((t) => t.after !== t.before);
  return (
    <div className="flex w-full flex-col gap-[14px]" data-part="cram-results-report">
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-[14px]">
        <StatTile
          label="This cram"
          value={data.studyLoaded ? hoursMinutes(data.minutes) : wait}
          share={data.goalMinutes ? data.minutes / data.goalMinutes : null}
          accent={TILE_ACCENTS[1]}
          part="cram-results-time"
          note={data.goalMinutes ? `of ${hoursMinutes(data.goalMinutes)} planned` : "No hours were planned"}
        />
        <StatTile
          label="Ready"
          value={`${pct(data.ready.after)}%`}
          share={data.ready.after}
          accent={TILE_ACCENTS[2]}
          part="cram-results-ready"
          note={`${signed(points)} points, from ${pct(data.ready.before)}%`}
        />
        <StatTile
          label={problems ? "Kinds of problem ready" : "Objectives verified"}
          value={signed(gained)}
          accent={TILE_ACCENTS[0]}
          part="cram-results-verified"
          note={`${data.ready.done} of ${data.ready.total} now`}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card radius={24} lip={5} className="flex flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-results-topics">
          <div className="flex items-baseline justify-between gap-[12px]">
            <h2 className="text-[20px] font-bold text-prussian">{problems ? "Kinds of problem" : "Topics"}: what moved</h2>
            <span className="text-[13px] font-semibold text-wisteria-deep">{changed.length ? `${changed.length} of ${data.topics.length} moved` : "Nothing moved yet"}</span>
          </div>
          {data.topics.length === 0 ? (
            <p className="text-[14px] font-medium text-wisteria-deep">Nothing was in scope.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-[24px] gap-y-[10px]">
              {data.topics.map((t) => {
                const delta = t.after - t.before;
                return (
                  <li key={t.id} className="flex flex-col gap-[4px]" data-part="cram-results-topic" data-topic={t.id} data-delta={delta}>
                    <div className="flex items-center justify-between gap-[8px]">
                      <span className="truncate text-[14px] font-bold text-prussian" title={t.name}>{t.name}</span>
                      {delta !== 0 && <span className="shrink-0 rounded-pill bg-wisteria px-[8px] py-[1px] text-[11px] font-bold text-parchment ring-2 ring-inset ring-wisteria-deep">{signed(delta)}</span>}
                    </div>
                    <div className="flex items-center gap-[8px]">
                      {/* Where it started, faint, under where it ended. */}
                      <div className="relative flex-1">
                        <ProgressBar value={t.total ? t.after / t.total : 0} height={6} label={`${t.name} at the end of the cram`} />
                        {t.before > 0 && <span className="absolute top-0 h-[6px] w-[2px] bg-prussian/50" style={{ left: `${(t.before / t.total) * 100}%` }} aria-hidden title={`${t.before} at the start`} />}
                      </div>
                      <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">
                        {t.before}→{t.after}/{t.total}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </motion.div>

      <div className="flex items-stretch gap-[14px]">
        <motion.div variants={fadeUp} className="min-w-0 flex-1">
          <Card radius={24} lip={5} className="flex h-full flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-results-days">
            <h2 className="text-[20px] font-bold text-prussian">Each day: planned and studied</h2>
            <DayBars plan={plan} split={data.split} today={data.lastDay} />
            <p className="flex flex-wrap gap-[12px] text-[12px] font-semibold text-prussian" aria-label="Key">
              <span><span className="mr-[5px] inline-block h-[10px] w-[10px] rounded-full ring-2 ring-inset ring-alice-deep align-middle" />Planned</span>
              {SOURCE_STYLE.map((x) => (
                <span key={x.key}><span className={`mr-[5px] inline-block h-[10px] w-[10px] rounded-full align-middle ${x.color}`} />{x.label}</span>
              ))}
            </p>
          </Card>
        </motion.div>
        <motion.div variants={fadeUp} className="flex w-[340px] shrink-0 flex-col">
          <SourcesCard totals={data.sources} title="Since the cram started" />
        </motion.div>
      </div>
    </div>
  );
}

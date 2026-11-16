"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cardExam, daysUntil, examObjectives } from "@/lib/course/exam-card";
import type { CramCovered, CramPlan, CramPlanDay, CramPlanInput, SpentMinutes } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { useCourse, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CramSetup } from "@/components/course/CramSetup";
import { useConnectorStatus, useCramPlan } from "@/components/course/useCram";
import { MASTERY_LABEL } from "@/components/review/parts";
import { fadeUp, overlayFade, popIn, stagger } from "@/lib/motion";

const PILL = "pressable rounded-pill bg-parchment px-[12px] py-[6px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice";

const daysText = (days: number) => (days === 0 ? "Exam day" : days === 1 ? "Tomorrow" : days > 1 ? `${days} days left` : days === -1 ? "Yesterday" : `${-days} days ago`);
const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : (Math.round(h * 10) / 10).toFixed(1));
const minutesText = (m: number) => `${Math.round(m)} min`;
/** The covered state's label and look (a chip on the topic row and a tint on the schedule's topics). */
const COVERED: Record<CramCovered, { label: string; chip: string }> = {
  untouched: { label: "Not started", chip: "bg-parchment text-wisteria-deep ring-alice-deep" },
  "in-progress": { label: "In progress", chip: "bg-periwinkle text-prussian ring-periwinkle-deep" },
  done: { label: "Done", chip: "bg-wisteria text-parchment ring-wisteria-deep" },
};
/** "Tue 11" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
const dayChip = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * The cram page (cram mode contract, section 6 and its per-day addendum): setup (the professor's
 * words, the files the exam covers, Add material held back, worries, the hours for each day) until
 * the exam is cramming with a budget, then the plan: days left, the budget with its hours by day
 * (today highlighted), the line, the schedule (a column per day of the cram: its topics and
 * minutes, today highlighted, past days muted and marked met or short), the scope as topic rows
 * with their covered state and weak spots, today, the practice test, the vault, Study with Claude,
 * Edit scope and Stop cramming. The plan is computed here from the store, as the exam card's line
 * is; nothing about it is stored.
 */
export default function CramPage({ params, searchParams }: PageProps<"/course/[slug]/cram">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const { hydrated, exams, objectives, materials, updateExam } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const nowMs = useNow();
  // Edit scope (here or on the card, `?edit=1`) reopens the setup prefilled.
  const [editing, setEditing] = useState(sp.edit === "1");
  const today = dayKey(new Date(nowMs).toISOString());
  const exam = course ? cardExam(exams, course.id, today) : null;
  const m = course ? mastery[course.id] : undefined;
  const planned = useCramPlan(course, exam, m);
  const connected = useConnectorStatus(Boolean(exam?.cramming));

  if (!course || !m) {
    return (
      <Screen bg="ocean">
        <header className="px-[24px] pt-[20px]">
          <BackButton />
        </header>
        {hydrated && <p className="p-[32px] text-[22px] font-bold text-prussian">We couldn&apos;t find that course.</p>}
      </Screen>
    );
  }
  if (!exam) {
    return (
      <Screen bg="ocean">
        <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
          <BackButton href={`/course/${course.slug}`} />
          <h1 className="text-[40px] font-bold leading-none text-prussian">{course.name}</h1>
        </header>
        <p className="p-[32px] text-[22px] font-bold text-prussian" data-part="cram-no-exam">
          No upcoming exam. Add one with Edit Exams on the course page.
        </p>
      </Screen>
    );
  }

  const catalogue = objectives[course.id] ?? {};
  // What the setup starts from: every live objective of the exam's topics (the scope set aside, so a narrowed one can be widened).
  const candidates = examObjectives({ topicIds: exam.topicIds, scope: null }, course.topics, catalogue);
  const days = daysUntil(exam.date, today);
  const cramming = exam.cramming && planned !== null && !editing;
  const mine = materials.filter((mat) => mat.courseId === course.id);
  const vault = mine.filter((mat) => mat.heldBack);

  return (
    <Screen bg="ocean" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton href={`/course/${course.slug}`} />
        <div>
          <h1 className="text-[40px] font-bold leading-none text-prussian">
            {cramming ? "Cramming for " : "Cram for "}
            {exam.title}
          </h1>
          <p className="mt-[5px] text-[14px] font-medium text-wisteria-deep">
            {course.name} · {daysText(days)}
          </p>
        </div>
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex items-start gap-[12px] px-[24px] pb-[28px] pt-[20px]" data-part="cram-page" data-cramming={exam.cramming ? "1" : undefined}>
        {cramming ? (
          <CrammingView course={course} today={today} plan={planned.plan} topics={planned.topics} spentMinutes={planned.spentMinutes} objectiveName={(id) => catalogue[id]?.name ?? id} vault={vault.map((v) => v.filename)} connected={connected} onEdit={() => setEditing(true)} onStop={() => updateExam(exam.id, { cramming: false })} />
        ) : (
          <motion.div variants={fadeUp} className="w-[600px]">
            <Card className="px-[28px] pb-[24px] pt-[24px]">
              {/* Mounted fresh per exam, so its fields start from the exam as it is then. */}
              <CramSetup key={exam.id} exam={exam} course={course} candidates={candidates} materials={mine} catalogue={catalogue} today={today} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
              {exam.cramming && !planned && <p className="mt-[12px] text-[13px] font-medium text-wisteria-deep">Cramming already, with no time budget yet: confirm to set one.</p>}
            </Card>
          </motion.div>
        )}
      </motion.div>
    </Screen>
  );
}

const isVerified = (s: ObjectiveStatus) => s === "verified" || s === "mastered";

function CrammingView({ course, today, plan, topics, spentMinutes, objectiveName, vault, connected, onEdit, onStop }: { course: { slug: string }; today: string; plan: CramPlan; topics: CramPlanInput["topics"]; spentMinutes: SpentMinutes; objectiveName: (id: string) => string; vault: string[]; connected: boolean | null; onEdit: () => void; onStop: () => void }) {
  void today;
  const days = Object.keys(plan.perDay).sort();
  const hours = days.reduce((sum, d) => sum + plan.perDay[d], 0);
  const studied = spentMinutes.beforeToday + spentMinutes.today;
  const topicName = new Map(plan.topics.map((t) => [t.id, t.name]));
  const coveredOf = new Map(plan.topics.map((t) => [t.id, t.covered]));
  const statusOf = new Map(topics.flatMap((t) => t.objectives.map((o) => [o.id, o.status] as const)));
  // Every weak spot in scope, one list (owner, 2026-11-15: only what needs attention stays on the page).
  const weak = plan.topics.flatMap((t) => t.weakSpots.map((id) => ({ id, topic: t.name })));
  const [scopeOpen, setScopeOpen] = useState(false);
  return (
    <div className="flex w-full flex-col gap-[12px]">
      {/* One line: the budget and the share verified; Edit and Stop beside it. */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-x-[14px] gap-y-[6px]" data-part="cram-header">
        <p className="text-[18px] font-bold text-prussian" data-part="cram-budget">
          {hoursText(plan.hoursLeft)} hours left of {hoursText(hours)}
          {plan.behindMinutes > 0 && <span className="text-wisteria-deep"> · {plan.behindMinutes} minutes behind</span>}
        </p>
        <p className="text-[15px] font-semibold text-wisteria-deep" data-part="cram-plan">
          {plan.daysLeft === 0 ? "Exam day. Light review only, nothing new." : `${plan.daysLeft} ${plan.daysLeft === 1 ? "day" : "days"} to the exam · ${Math.round(plan.verified.share * 100)}% verified`}
        </p>
        <p className="text-[13px] font-medium text-wisteria-deep" data-part="cram-spent">
          {minutesText(studied)} studied{plan.daysLeft > 0 ? ` · ${minutesText(plan.minutesToday)} left today` : ""}
        </p>
        <span className="ml-auto flex items-center gap-[8px]">
          <button type="button" onClick={onEdit} data-part="cram-edit" className="text-[13px] font-bold text-wisteria-deep underline">
            Edit
          </button>
          <Button size="xs" variant="secondary" onClick={onStop} data-part="cram-stop">
            Stop cramming
          </Button>
        </span>
      </motion.div>

      <div className="flex items-start gap-[12px]">
        <div className="flex w-[340px] shrink-0 flex-col gap-[12px]">
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-today">
              <h2 className="text-[20px] font-bold text-prussian">Today</h2>
              {plan.daysLeft === 0 ? (
                <p className="text-[14px] font-medium text-wisteria-deep">Light review only, nothing new.</p>
              ) : plan.today.length === 0 ? (
                <p className="text-[14px] font-medium text-wisteria-deep">Nothing planned today.</p>
              ) : (
                <ul className="flex flex-col gap-[4px]">
                  {plan.today.map((t) => (
                    <li key={t.topicId} className="flex justify-between gap-[8px] text-[15px] font-semibold text-prussian" data-part="cram-today-topic" data-topic={t.topicId}>
                      <span className="truncate">{topicName.get(t.topicId) ?? t.topicId}</span>
                      <span className="shrink-0 text-wisteria-deep">{t.minutes} min</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
                <Link href={`/session/${course.slug}?kind=quick`} data-part="cram-start-review" className={PILL}>
                  Start quick review
                </Link>
                {connected ? (
                  <span className="text-[13px] font-medium text-prussian" data-part="study-with-claude">
                    Or study with Claude: it has this plan.
                  </span>
                ) : (
                  <Link href="/settings#connector" data-part="study-with-claude" className={PILL}>
                    Study with Claude
                  </Link>
                )}
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[6px] px-[22px] pb-[16px] pt-[16px]" data-part="cram-weak">
              <h2 className="text-[17px] font-bold text-prussian">Weak spots{weak.length ? ` · ${weak.length}` : ""}</h2>
              {weak.length === 0 ? (
                <p className="text-[13px] font-medium text-wisteria-deep">None flagged in scope.</p>
              ) : (
                <ul className="flex max-h-[180px] flex-col gap-[3px] overflow-y-auto">
                  {weak.map((w) => (
                    <li key={w.id} className="text-[13px] font-medium leading-snug text-prussian" data-part="cram-weak-item" data-objective={w.id}>
                      {objectiveName(w.id)} <span className="text-wisteria-deep">· {MASTERY_LABEL[statusOf.get(w.id) ?? "unseen"]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[4px] px-[22px] pb-[16px] pt-[16px]" data-part="cram-mock">
              <h2 className="text-[17px] font-bold text-prussian">Practice test</h2>
              {vault.length ? (
                <>
                  <ul className="flex flex-col" data-part="cram-vault">
                    {vault.map((name) => (
                      <li key={name} className="truncate text-[13px] font-semibold text-prussian" data-part="cram-vault-item">
                        {name}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[13px] font-medium text-wisteria-deep">Held back. No practice test yet: sit it timed once your weak spots are covered.</p>
                </>
              ) : (
                <p className="text-[13px] font-medium text-wisteria-deep">
                  No practice test yet.{" "}
                  <Link href={`/add-material?course=${course.slug}&type=Practice%20exam&holdBack=1`} data-part="cram-add-material" className="font-bold underline">
                    Add one
                  </Link>
                </p>
              )}
            </Card>
          </motion.div>
        </div>

        <motion.div variants={fadeUp} className="min-w-0 flex-1">
          <Card className="flex flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]">
            <div className="flex items-baseline justify-between gap-[12px]">
              <h2 className="text-[20px] font-bold text-prussian">The schedule</h2>
              <button type="button" onClick={() => setScopeOpen(true)} data-part="cram-scope-open" className="text-[13px] font-bold text-wisteria-deep underline">
                See all {plan.topics.length} topics
              </button>
            </div>
            {plan.days.length === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">No days before the exam.</p>
            ) : (
              <ol className="flex gap-[8px] overflow-x-auto pb-[4px]" data-part="cram-schedule" aria-label="The schedule by day">
                {plan.days.map((d) => (
                  <ScheduleDay key={d.day} day={d} topicName={(id) => topicName.get(id) ?? id} covered={(id) => coveredOf.get(id) ?? "untouched"} />
                ))}
              </ol>
            )}
            <p className="flex flex-wrap gap-[10px] text-[12px] font-semibold text-wisteria-deep" aria-label="Key">
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] bg-alice align-middle" />Not started</span>
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] bg-periwinkle/40 align-middle" />In progress</span>
              <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-[3px] bg-wisteria/25 align-middle" />Done</span>
            </p>
          </Card>
        </motion.div>
      </div>

      <ScopePanel open={scopeOpen} onClose={() => setScopeOpen(false)} plan={plan} topics={topics} objectiveName={objectiveName} statusOf={statusOf} />
    </div>
  );
}

/** Every topic in scope, with how far it has got: the detail behind the schedule, opened on demand. */
function ScopePanel({ open, onClose, plan, topics, objectiveName, statusOf }: { open: boolean; onClose: () => void; plan: CramPlan; topics: CramPlanInput["topics"]; objectiveName: (id: string) => string; statusOf: Map<string, ObjectiveStatus> }) {
  const scoped = new Map(topics.map((t) => [t.id, t.objectives.filter((o) => o.weight > 0)]));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="scope" className="fixed inset-0 z-50 flex justify-end bg-prussian/40" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.aside role="dialog" aria-modal="true" aria-label="The scope" className="flex h-full w-[460px] max-w-full flex-col gap-[12px] overflow-y-auto bg-parchment px-[22px] py-[20px]" variants={popIn} initial="hidden" animate="show" exit="exit" onClick={(e) => e.stopPropagation()} data-part="cram-scope">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[22px] font-bold text-prussian">The scope</h2>
              <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-verified">
                {plan.verified.done} of {plan.verified.total} verified
              </p>
            </div>
            {plan.topics.length === 0 && <p className="text-[14px] font-medium text-wisteria-deep">This exam has no objectives in scope yet.</p>}
            <ul className="flex flex-col gap-[10px]">
              {plan.topics.map((t) => {
                const inScope = scoped.get(t.id) ?? [];
                const verified = inScope.filter((o) => isVerified(o.status)).length;
                return (
                  <li key={t.id} className="flex flex-col gap-[6px] rounded-[14px] border-2 border-alice-deep px-[14px] py-[10px]" data-part="cram-topic" data-topic={t.id} data-done={t.done ? "1" : undefined} data-covered={t.covered}>
                    <div className="flex items-center justify-between gap-[10px]">
                      <div className="flex min-w-0 items-center gap-[8px]">
                        <p className="truncate text-[15px] font-bold text-prussian">{t.name}</p>
                        <span className={`shrink-0 rounded-pill px-[8px] py-[2px] text-[11px] font-bold ring-2 ring-inset ${COVERED[t.covered].chip}`} data-part="cram-topic-covered">
                          {COVERED[t.covered].label}
                        </span>
                      </div>
                      <p className="shrink-0 text-[13px] font-semibold text-wisteria-deep" data-part="cram-topic-minutes">
                        {t.done ? "Done" : t.minutesToday > 0 ? `${t.minutesToday} min today` : "Not today"}
                      </p>
                    </div>
                    <div className="flex items-center gap-[10px]">
                      <ProgressBar value={inScope.length ? verified / inScope.length : 0} height={8} label={`${t.name} verified`} className="flex-1" />
                      <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep" data-part="cram-topic-verified">
                        {verified}/{inScope.length} verified
                      </span>
                    </div>
                    {t.weakSpots.length > 0 && (
                      <ul className="flex flex-col gap-[2px]" data-part="cram-weak-spots">
                        {t.weakSpots.map((id) => (
                          <li key={id} className="text-[12px] font-medium text-prussian" data-part="cram-weak-spot" data-objective={id}>
                            {objectiveName(id)} <span className="text-wisteria-deep">· {MASTERY_LABEL[statusOf.get(id) ?? "unseen"]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One column of the schedule: the weekday, date and hours, then its topics with their minutes
 * (tinted by their covered state). Today is highlighted; a past day is muted and, when the minutes
 * studied on it are known, marked met or short.
 */
function ScheduleDay({ day, topicName, covered }: { day: CramPlanDay; topicName: (id: string) => string; covered: (id: string) => CramCovered }) {
  const frame = day.today ? "bg-wisteria/15 ring-wisteria" : day.past ? "bg-parchment ring-alice-deep opacity-60" : "bg-parchment ring-alice-deep";
  const mark = !day.past ? null : day.met === null ? "Not tracked" : day.met ? "Met" : "Short";
  return (
    <li
      className={`flex w-[128px] shrink-0 flex-col gap-[6px] rounded-[14px] px-[10px] py-[8px] ring-2 ring-inset ${frame}`}
      data-part="cram-day-col"
      data-day={day.day}
      data-today={day.today ? "1" : undefined}
      data-past={day.past ? "1" : undefined}
      data-met={day.met === null ? undefined : day.met ? "1" : "0"}
      data-hours={day.hours}
    >
      <div className="flex flex-col">
        <p className="text-[13px] font-bold text-prussian">{dayChip(day.day)}</p>
        <p className="text-[12px] font-semibold text-wisteria-deep" data-part="cram-day-col-hours">
          {day.hours > 0 ? `${hoursText(day.hours)} h` : "Day off"}
          {day.today ? " · today" : ""}
        </p>
      </div>
      {day.topics.length > 0 ? (
        <ul className="flex flex-col gap-[4px]">
          {day.topics.slice(0, 4).map((t) => {
            const state = covered(t.topicId);
            return (
              <li key={t.topicId} className={`rounded-[8px] px-[6px] py-[3px] text-[12px] font-semibold leading-tight ${state === "done" ? "bg-wisteria/25 text-prussian" : state === "in-progress" ? "bg-periwinkle/40 text-prussian" : "bg-alice text-prussian"}`} data-part="cram-day-topic" data-topic={t.topicId} data-covered={state}>
                <span className="line-clamp-2 block">{topicName(t.topicId)}</span>
                <span className="text-wisteria-deep">{t.minutes} min</span>
              </li>
            );
          })}
          {day.topics.length > 4 && (
            <li className="px-[6px] text-[12px] font-semibold text-wisteria-deep" data-part="cram-day-more">
              +{day.topics.length - 4} more
            </li>
          )}
        </ul>
      ) : (
        <p className="text-[12px] font-medium text-wisteria-deep">{day.hours > 0 ? "Nothing planned" : ""}</p>
      )}
      {mark && (
        <p className={`mt-auto text-[12px] font-bold ${day.met ? "text-wisteria-deep" : day.met === false ? "text-prussian" : "text-wisteria-deep"}`} data-part="cram-day-col-mark">
          {mark}
          {day.spentMinutes !== null ? ` · ${minutesText(day.spentMinutes)}` : ""}
        </p>
      )}
    </li>
  );
}

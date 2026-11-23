"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cardExam, daysUntil, examObjectives } from "@/lib/course/exam-card";
import { examMap, rulesLine } from "@/lib/course/exam-map";
import { READINESS_LABEL, type ExamReadiness } from "@/lib/course/readiness";
import type { SessionLine } from "@/lib/connector/mcp";
import type { ExamScope, QuizResult } from "@/lib/data";
import type { CramCovered, CramPlan, CramPlanDay, CramPlanInput, SpentMinutes } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { useCourse, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { Screen } from "@/components/layout/Screen";
import { IconUpload } from "@/components/icons";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CramSetup } from "@/components/course/CramSetup";
import { useCramTheme } from "@/components/course/CramTheme";
import { useConnectorStatus, useCramPlan, useStudyLog, type StudySplit } from "@/components/course/useCram";
import { CramProgress } from "@/components/course/CramProgress";
import { WeakSpotBubbles } from "@/components/course/WeakSpotBubbles";
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
 * minutes, today highlighted, past days muted with the minutes studied, practice tests on their days), the scope as topic rows
 * with their covered state and weak spots, today, the practice test, the vault, Study with Claude,
 * Edit scope and Stop cramming. The plan is computed here from the store, as the exam card's line
 * is; nothing about it is stored.
 */
export default function CramPage({ params, searchParams }: PageProps<"/course/[slug]/cram">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const { hydrated, exams, objectives, materials, results, updateExam } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const nowMs = useNow();
  // Edit scope (here or on the card, `?edit=1`) reopens the setup prefilled.
  const [editing, setEditing] = useState(sp.edit === "1");
  const [tab, setTab] = useState<CramTab>(sp.tab === "progress" ? "progress" : "today");
  const today = dayKey(new Date(nowMs).toISOString());
  const exam = course ? cardExam(exams, course.id, today) : null;
  const m = course ? mastery[course.id] : undefined;
  const log = useStudyLog(course?.id, exam?.id);
  const planned = useCramPlan(course, exam, m, log);
  const connected = useConnectorStatus(Boolean(exam?.cramming));
  // Cram mode's dark look (owner, 2026-11-22) while the shown exam is being crammed for (cardExam only returns ones not yet past).
  useCramTheme(exam?.cramming === true);

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
  const latest = results.filter((r) => r.courseId === course.id).reduce<QuizResult | null>((a, r) => (!a || r.finishedAt > a.finishedAt ? r : a), null);
  const lastQuiz: LastQuiz | null = latest && { topic: latest.topicId ? (course.topics.find((t) => t.id === latest.topicId)?.name ?? null) : null, mode: latest.mode, correct: latest.correct, total: latest.total, minutes: latest.seconds / 60, day: dayKey(latest.finishedAt) };

  return (
    <Screen bg="ocean" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton href={`/course/${course.slug}`} />
        <div>
          <div className="flex items-center gap-[12px]">
            <h1 className="text-[40px] font-bold leading-none text-prussian">
              {cramming ? "Cramming for " : "Cram for "}
              {exam.title}
            </h1>
            {/* The page's one way to add a past or practice exam (held back), in the setup and while cramming. */}
            <Link
              href={`/add-material?course=${course.slug}&type=Practice%20exam&holdBack=1`}
              aria-label={ADD_EXAM_LABEL}
              title={ADD_EXAM_LABEL}
              data-part="cram-add-material"
              className="pressable inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[15px] border-2 border-alice-deep bg-parchment text-prussian lip-3 lip-alice"
            >
              <IconUpload size={20} />
            </Link>
          </div>
          <p className="mt-[5px] text-[14px] font-medium text-wisteria-deep">
            {course.name} · {daysText(days)}
          </p>
        </div>
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex items-start gap-[12px] px-[24px] pb-[28px] pt-[20px]" data-part="cram-page" data-cramming={exam.cramming ? "1" : undefined}>
        {cramming ? (
          <CrammingView course={course} today={today} plan={planned.plan} topics={planned.topics} spentMinutes={planned.spentMinutes} split={planned.split} examDate={exam.date} lastQuiz={lastQuiz} tab={tab} onTab={setTab} objectiveName={(id) => catalogue[id]?.name ?? planned.plan.topics.find((t) => t.id === id)?.name ?? id} vault={vault.map((v) => ({ id: v.id, filename: v.filename }))} lastSession={log?.sessions[0] ?? null} readiness={planned.readiness} scope={exam.scope} onReserve={(id) => updateExam(exam.id, { scope: reserveIn(exam.scope, id) })} connected={connected} onEdit={() => setEditing(true)} onStop={() => updateExam(exam.id, { cramming: false })} />
        ) : (
          <motion.div variants={fadeUp} className="w-[600px]">
            <Card className="px-[28px] pb-[24px] pt-[24px]">
              {/* Mounted fresh per exam, so its fields start from the exam as it is then. */}
              <CramSetup key={exam.id} exam={exam} course={course} candidates={candidates} materials={mine} catalogue={catalogue} mastery={m} today={today} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
              {exam.cramming && !planned && <p className="mt-[12px] text-[13px] font-medium text-wisteria-deep">Cramming already, with no time budget yet: confirm to set one.</p>}
            </Card>
          </motion.div>
        )}
      </motion.div>
    </Screen>
  );
}

const ADD_EXAM_LABEL = "Add a past or practice exam (kept hidden from you until you sit one)";

const isVerified = (s: ObjectiveStatus) => s === "verified" || s === "mastered";

function CrammingView({ course, today, plan, topics, spentMinutes, split, examDate, objectiveName, vault, lastSession, lastQuiz, readiness, scope, onReserve, connected, tab, onTab, onEdit, onStop }: { lastSession: SessionLine | null; lastQuiz: LastQuiz | null; readiness: ExamReadiness | null; course: { slug: string }; today: string; plan: CramPlan; topics: CramPlanInput["topics"]; spentMinutes: SpentMinutes; split: StudySplit; examDate: string; objectiveName: (id: string) => string; vault: Array<{ id: string; filename: string }>; scope: ExamScope | null; onReserve: (materialId: string | null) => void; connected: boolean | null; tab: CramTab; onTab: (tab: CramTab) => void; onEdit: () => void; onStop: () => void }) {
  void today;
  const studied = spentMinutes.beforeToday + spentMinutes.today;
  const topicName = new Map(plan.topics.map((t) => [t.id, t.name]));
  const coveredOf = new Map(plan.topics.map((t) => [t.id, t.covered]));
  const statusOf = new Map(topics.flatMap((t) => t.objectives.map((o) => [o.id, o.status] as const)));
  const [scopeOpen, setScopeOpen] = useState(false);
  return (
    <div className="flex w-full flex-col gap-[12px]">
      {/* Two tabs (owner, 2026-11-22): Today (the plan, where you left off, the weak spots) and Your Progress (the dashboard); Edit and Stop beside them. */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-[8px]" data-part="cram-header">
        <div role="tablist" aria-label="Cram views" className="flex gap-[6px] rounded-pill bg-alice p-[4px] ring-2 ring-inset ring-alice-deep">
          {CRAM_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)} data-part={`cram-tab-${t.id}`} className={`rounded-pill px-[16px] py-[6px] text-[15px] font-bold transition-colors ${tab === t.id ? "bg-parchment text-prussian lip-2 lip-alice" : "text-wisteria-deep"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-[8px]">
          <button type="button" onClick={onEdit} data-part="cram-edit" className="text-[13px] font-bold text-wisteria-deep underline">
            Edit
          </button>
          <Button size="xs" variant="secondary" onClick={onStop} data-part="cram-stop">
            Stop cramming
          </Button>
        </span>
      </motion.div>

      {tab === "progress" ? (
        <CramProgress plan={plan} topics={topics} studied={studied} studiedToday={spentMinutes.today} split={split} examDate={examDate} />
      ) : (
        <>
          <div className="flex items-stretch gap-[12px]">
            <div className="flex w-[380px] shrink-0 flex-col">
          <motion.div variants={fadeUp} className="flex-1">
            <Card className="flex h-full flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="cram-today">
              <h2 className="text-[20px] font-bold text-prussian">Today</h2>
              {plan.daysLeft === 0 ? (
                <p className="text-[14px] font-medium text-wisteria-deep">Light review only, nothing new.</p>
              ) : plan.today.length === 0 && !plan.diagnostic && !plan.mockToday ? (
                <p className="text-[14px] font-medium text-wisteria-deep">Nothing planned today.</p>
              ) : (
                // A queue, in order: the sweep first while nothing's been answered, today's practice test, then one topic after another.
                <ol className="flex flex-col gap-[4px]">
                  {plan.diagnostic && (
                    <li className="flex justify-between gap-[8px] text-[15px] font-semibold text-prussian" data-part="cram-today-sweep">
                      <span className="truncate">{plan.unit === "problem-type" ? "Cold start: one exam-style problem per kind" : "Quick sweep: one question per topic"}</span>
                      <span className="shrink-0 text-wisteria-deep">{plan.diagnostic.minutes} min</span>
                    </li>
                  )}
                  {plan.mockToday && (
                    <li className="flex justify-between gap-[8px] text-[15px] font-semibold text-prussian" data-part="cram-today-mock">
                      <span className="truncate">Practice test: {plan.mockToday.name}</span>
                      <span className="shrink-0 text-wisteria-deep">{plan.mockToday.minutes} min</span>
                    </li>
                  )}
                  {plan.today.map((t, i) => (
                    <li key={t.topicId} className="flex justify-between gap-[8px] text-[15px] font-semibold text-prussian" data-part="cram-today-topic" data-topic={t.topicId}>
                      <span className="truncate">
                        {i > 0 || plan.diagnostic || plan.mockToday ? <span className="font-medium text-wisteria-deep">then </span> : null}
                        {topicName.get(t.topicId) ?? t.topicId}
                      </span>
                      <span className="shrink-0 text-wisteria-deep">{t.minutes} min</span>
                    </li>
                  ))}
                </ol>
              )}
              {plan.cut.length > 0 && plan.daysLeft > 0 && (
                <p className="text-[13px] font-medium text-wisteria-deep" data-part="cram-cut">
                  If time runs short: {plan.cut.map((id) => topicName.get(id) ?? id).join(", ")}
                </p>
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
            </div>
            <motion.div variants={fadeUp} className="min-w-0 flex-1">
              <LeftOff lastSession={lastSession} lastQuiz={lastQuiz} connected={connected} />
            </motion.div>
          </div>
          <motion.div variants={fadeUp}>
            <Card radius={24} lip={5} className="px-[22px] pb-[18px] pt-[18px]">
              <WeakSpotBubbles plan={plan} topics={topics} slug={course.slug} objectiveName={objectiveName} />
            </Card>
          </motion.div>
        </>
      )}

      {/* Under both tabs: what the exam asks and the practice test, then the schedule. */}
      <div className="flex items-start gap-[12px]">
        <motion.div variants={fadeUp} className="min-w-0 flex-1">
          <ExamMapCard scope={scope} readiness={readiness} vaultNames={new Map(vault.map((v) => [v.id, v.filename]))} hasVault={vault.length > 0} />
        </motion.div>
        <div className="w-[340px] shrink-0">
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[4px] px-[22px] pb-[16px] pt-[16px]" data-part="cram-mock">
              <h2 className="text-[17px] font-bold text-prussian">Practice test</h2>
              {vault.length ? (
                <>
                  <ul className="flex flex-col" data-part="cram-vault">
                    {vault.map((v) => {
                      const reserved = scope?.reservedMaterialId === v.id;
                      return (
                        <li key={v.id} className="flex items-center justify-between gap-[8px] text-[13px] font-semibold text-prussian" data-part="cram-vault-item" data-reserved={reserved ? "1" : undefined}>
                          <span className="truncate">{v.filename}</span>
                          {/* One exam can stay unread, even by Claude, until it's sat timed: the cram's measured score. */}
                          {vault.length > 1 && (
                            <button type="button" onClick={() => onReserve(reserved ? null : v.id)} data-part="cram-reserve" aria-pressed={reserved} className="shrink-0 text-[12px] font-bold text-wisteria-deep underline">
                              {reserved ? "Reserved" : "Reserve"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[13px] font-medium text-wisteria-deep" data-part="cram-mock-when">
                    {(() => {
                      const next = plan.days.find((d) => d.mock && !d.past);
                      return next ? `Held back. Sit it timed on ${dayChip(next.day)}${next.today ? " (today)" : ""}: it's on the schedule.` : "Held back. No study day left to sit it on.";
                    })()}
                  </p>
                  <p className="text-[12px] font-medium text-wisteria-deep">
                    Claude reads these to plan, and never shows you the problems.{vault.length > 1 ? " Reserve one and Claude leaves it unread until you sit it timed." : ""}
                  </p>
                </>
              ) : (
                <p className="text-[13px] font-medium text-wisteria-deep">No practice test yet.</p>
              )}
            </Card>
          </motion.div>
        </div>
      </div>
      <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[12px] px-[22px] pb-[18px] pt-[18px]">
            <div className="flex items-baseline justify-between gap-[12px]">
              <h2 className="text-[20px] font-bold text-prussian">The schedule</h2>
              <button type="button" onClick={() => setScopeOpen(true)} data-part="cram-scope-open" className="text-[13px] font-bold text-wisteria-deep underline">
                See all {plan.topics.length} {plan.unit === "problem-type" ? "kinds of problem" : "topics"}
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

      <ScopePanel open={scopeOpen} onClose={() => setScopeOpen(false)} plan={plan} topics={topics} objectiveName={objectiveName} statusOf={statusOf} />
    </div>
  );
}

type CramTab = "today" | "progress";
const CRAM_TABS: Array<{ id: CramTab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "progress", label: "Your Progress" },
];

/** The course's latest finished session in the app: the other half of "where you left off". */
interface LastQuiz {
  topic: string | null;
  mode: QuizResult["mode"];
  correct: number;
  total: number;
  minutes: number;
  day: string;
}

const MODE_NAME: Record<QuizResult["mode"], string> = { topic: "Topic quiz", quick: "Quick review", deep: "Dive", requiz: "Re-quiz" };

/**
 * Where you left off (owner, 2026-11-22: always on the Today tab): the last sitting with Claude
 * (its bookmark and next steps, what a new chat opens with) and the last session in the app; before
 * either, how it fills in.
 */
function LeftOff({ lastSession, lastQuiz, connected }: { lastSession: SessionLine | null; lastQuiz: LastQuiz | null; connected: boolean | null }) {
  return (
    <Card radius={24} lip={5} className="flex h-full flex-col gap-[8px] px-[22px] pb-[16px] pt-[18px]" data-part="cram-last-session" data-empty={lastSession || lastQuiz ? undefined : "1"}>
      <div className="flex items-baseline justify-between gap-[8px]">
        <h2 className="text-[20px] font-bold text-prussian">Where you left off</h2>
        {lastSession && (
          <span className="shrink-0 text-[12px] font-medium text-wisteria-deep" data-part="cram-last-when">
            With Claude · {dayChip(lastSession.day)} · {minutesText(lastSession.minutes)}
          </span>
        )}
      </div>
      {lastSession ? (
        <>
          <p className="text-[14px] font-medium leading-snug text-prussian" data-part="cram-bookmark">
            {lastSession.bookmark ?? lastSession.summary}
          </p>
          {lastSession.next.length > 0 && (
            <div className="flex flex-col gap-[2px]">
              <p className="text-[13px] font-bold text-wisteria-deep">Next</p>
              <ol className="flex list-decimal flex-col gap-[2px] pl-[18px] text-[13px] font-semibold text-prussian" data-part="cram-next-steps">
                {lastSession.next.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}
        </>
      ) : (
        <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-last-empty">
          No sittings with Claude yet. Study with Claude and it picks up here next time.
        </p>
      )}
      {lastQuiz && (
        <p className="mt-auto border-t border-alice-deep pt-[8px] text-[13px] font-semibold text-prussian" data-part="cram-last-quiz">
          In Orca: {MODE_NAME[lastQuiz.mode]}
          {lastQuiz.topic ? ` · ${lastQuiz.topic}` : ""}
          <span className="font-medium text-wisteria-deep">
            {" "}· {lastQuiz.correct}/{lastQuiz.total} right · {minutesText(lastQuiz.minutes)} · {dayChip(lastQuiz.day)}
          </span>
        </p>
      )}
      {lastSession && connected && <p className="text-[12px] font-medium text-wisteria-deep">A new chat with Claude opens from here.</p>}
    </Card>
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
 * (tinted by their covered state) and a practice test placed on it. Today is highlighted; a past day
 * is muted and shows the minutes studied on it when known (owner, 2026-11-16: nothing is late, so
 * no "short" marks).
 */
function ScheduleDay({ day, topicName, covered }: { day: CramPlanDay; topicName: (id: string) => string; covered: (id: string) => CramCovered }) {
  const frame = day.today ? "bg-wisteria/15 ring-wisteria" : day.past ? "bg-parchment ring-alice-deep opacity-60" : "bg-parchment ring-alice-deep";
  const mark = !day.past || day.spentMinutes === null ? null : `Studied ${minutesText(day.spentMinutes)}`;
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
      {day.mock && (
        <p className="rounded-[8px] bg-periwinkle px-[6px] py-[3px] text-[12px] font-bold leading-tight text-prussian" data-part="cram-day-mock">
          Practice test · {day.mock.minutes} min
        </p>
      )}
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
        <p className="mt-auto text-[12px] font-bold text-wisteria-deep" data-part="cram-day-col-mark">
          {mark}
        </p>
      )}
    </li>
  );
}

/** The scope with one held-back exam reserved (null clears it); an exam without a scope gets an empty one to hold it. */
function reserveIn(scope: ExamScope | null, materialId: string | null): ExamScope {
  const { reservedMaterialId: _was, ...rest } = scope ?? { objectives: [], sources: [] };
  void _was;
  return materialId ? { ...rest, reservedMaterialId: materialId } : rest;
}

/**
 * The exam map (plan 2026-11-22, Phase 1): the exam's rules and the kinds of problem its past exams
 * ask, most recurrent first, as the student's Claude mapped them. Until it's mapped, it says how.
 */
function ExamMapCard({ scope, readiness, vaultNames, hasVault }: { scope: ExamScope | null; readiness: ExamReadiness | null; vaultNames: ReadonlyMap<string, string>; hasVault: boolean }) {
  const map = examMap(scope);
  const stateOf = new Map((readiness?.types ?? []).map((t) => [t.id, t]));
  const rules = rulesLine(scope?.rules);
  return (
    <Card className="flex flex-col gap-[8px] px-[22px] pb-[16px] pt-[16px]" data-part="cram-exam-map" data-mapped={map ? "1" : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-[12px]">
        <h2 className="text-[20px] font-bold text-prussian">What the exam asks</h2>
        {(rules || scope?.rules?.text) && (
          <p className="text-[13px] font-semibold text-wisteria-deep" data-part="cram-rules">
            {[rules, scope?.rules?.text].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {map ? (
        <>
          <ul className="flex flex-col gap-[3px]" data-part="cram-problem-types">
            {map.types.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-[10px] text-[14px] font-semibold text-prussian" data-part="cram-problem-type" data-type={t.id} title={t.note}>
                <span className="truncate">{t.name}</span>
                <span className="flex shrink-0 items-baseline gap-[8px] text-[13px] font-medium text-wisteria-deep">
                  on {t.exams} of {map.examsMapped} {map.examsMapped === 1 ? "exam" : "exams"}
                  {/* Ready only after a cold solve: the exam-level measure. */}
                  <span className={`rounded-full px-[8px] py-[1px] text-[12px] font-bold ${stateOf.get(t.id)?.state === "ready" ? "bg-wisteria text-parchment" : stateOf.get(t.id)?.state === "untested" || !stateOf.get(t.id) ? "bg-alice text-prussian" : "bg-periwinkle text-prussian"}`} data-part="cram-type-state" data-state={stateOf.get(t.id)?.state ?? "untested"} title={stateOf.get(t.id)?.lastError ?? undefined}>
                    {READINESS_LABEL[stateOf.get(t.id)?.state ?? "untested"]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {readiness?.measured && (
            <p className="text-[14px] font-bold text-prussian" data-part="cram-measured">
              Timed score: {readiness.measured.points} / {readiness.measured.outOf}
              <span className="font-medium text-wisteria-deep"> · {vaultNames.get(readiness.measured.materialId) ?? "the reserved exam"}</span>
            </p>
          )}
          {map.uncertain && (
            <p className="text-[12px] font-medium text-wisteria-deep" data-part="cram-map-uncertain">
              From {map.examsMapped} {map.examsMapped === 1 ? "exam" : "exams"}: a kind of problem on none of them can still come up.
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] font-medium text-wisteria-deep" data-part="cram-map-empty">
          {hasVault
            ? "Not mapped yet. Ask Claude to map the exam: it reads your past exams and lists the kinds of problem they ask."
            : "Not mapped yet. Upload every past exam you have, then ask Claude to map the exam."}
        </p>
      )}
    </Card>
  );
}

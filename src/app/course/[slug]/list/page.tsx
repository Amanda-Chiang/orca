"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { DiveModal } from "@/components/quiz/DiveModal";
import { durationSeconds } from "@/lib/mastery/session";
import { weakSpotStatus, type WeakSpotStatus } from "@/lib/mastery/progress";
import { isInRotation } from "@/lib/mastery/flags";
import { StatusSlider } from "@/components/course/StatusSlider";
import { Button } from "@/components/ui/Button";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { UploadsLink } from "@/components/course/UploadsLink";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DEFAULT_CONFIG, trailTopics } from "@/lib/data";
import { useCourse, useCramming, useMasteryByCourse, useOrca } from "@/lib/store";
import { CramBanner } from "@/components/course/CramBanner";
import { useCramTheme } from "@/components/course/CramTheme";
import { fadeUp, popIn, stagger } from "@/lib/motion";

/**
 * List (owner, 2026-11-10): every topic with weak spots, in course order, with its status (needs
 * review, in progress, mastered; colours from the Atlas) and a play button that opens its dive.
 * The status is a 3-stop slider (owner, 2026-11-22): moving it to Mastered marks the topic's weak
 * spots mastered (MarkEvent, rules v5), to Needs review flags them hard again; a pop-up confirms.
 */
export default function ListPage({ params }: PageProps<"/course/[slug]/list">) {
  const { slug } = use(params);
  const [diving, setDiving] = useState<{ id: string; name: string } | null>(null);
  const closeDive = useCallback(() => setDiving(null), []);
  const router = useRouter();
  const { hydrated, configs, markMastered, flagObjectives } = useOrca();
  // A status the student dragged a topic to, waiting for the pop-up's answer.
  const [pending, setPending] = useState<{ topicId: string; name: string; to: WeakSpotStatus; ids: string[] } | null>(null);
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  // Cram mode (owner, 2026-11-22): only the exam's topics, the rest behind "Show N other topics".
  const cram = useCramming(course?.id);
  useCramTheme(!!cram);
  const [showOthers, setShowOthers] = useState(false);

  if (!course) {
    return (
      <AppShell bg="ocean">
        <div className="flex h-full flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </AppShell>
    );
  }
  const m = mastery[course.id];
  if (!m) throw new Error(`No mastery computed for course ${course.id}`);

  const allRows = trailTopics(course).flatMap((topic) => {
    const ids = m.topicObjectives.get(topic.id) ?? [];
    const status = weakSpotStatus(ids, m.objectives);
    const progress = m.topics.get(topic.id);
    if (!progress) throw new Error(`No progress computed for topic ${topic.id}`);
    const weakSpots = ids.flatMap((id) => {
      const s = m.objectives.get(id);
      if (!s) throw new Error(`No state computed for objective ${id}`);
      return isInRotation(s.status) || s.status === "check-due" ? [s] : [];
    });
    return status ? [{ topic, status, progress, weakSpots, offExam: !!cram && !cram.topics.has(topic.id) }] : [];
  });
  const others = allRows.filter((r) => r.offExam);
  const rows = cram && !showOthers ? allRows.filter((r) => !r.offExam) : allRows;
  const counted = allRows.length - others.length;

  // The same header as Path (title, line, progress bar, then the pills), so the pills sit at the same height on every tab.
  const trail = trailTopics(course).map((t) => {
    const p = m.topics.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  });
  const weak = trail.reduce((sum, p) => sum + p.weak, 0);
  const pct = weak ? trail.reduce((sum, p) => sum + p.mastered, 0) / weak : 0;

  return (
    <AppShell bg="ocean" sidebar={!cram}>
      {cram && <CramBanner course={course} exam={cram.exam} />}
      <div className={`absolute inset-0 overflow-auto px-[28px] pb-[28px] ${cram ? "pt-[76px]" : "pt-[28px]"}`}>
        {/* The list sits in the header's column, so it lines up with the title and the Path pill. */}
        <div className="flex items-start gap-[16px]">
          <motion.div variants={fadeUp} initial="hidden" animate="show">
            <BackButton href={`/course/${course.slug}`} />
          </motion.div>
          <div className="flex min-w-0 max-w-[720px] flex-1 flex-col">
            <motion.header variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[6px] pt-[2px]">
              <motion.h1 variants={fadeUp} className="text-[34px] font-bold leading-none text-prussian">
                {course.name}
              </motion.h1>
              <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep" data-part="list-summary">
                {cram
                  ? `${counted} exam topic${counted === 1 ? "" : "s"} with weak spots`
                  : rows.length
                    ? `${rows.length} topic${rows.length === 1 ? "" : "s"} with weak spots`
                    : "No weak spots flagged yet"}
              </motion.p>
              <motion.div variants={fadeUp} className="mt-[6px] w-[240px]">
                <ProgressBar value={pct} height={12} label="Course progress" track="parchment" />
              </motion.div>
              <motion.div variants={fadeUp} className="mt-[4px] flex items-center gap-[10px]">
                <AtlasSwitch slug={course.slug} current="list" />
                <UploadsLink course={course} />
              </motion.div>
            </motion.header>

            {rows.length === 0 ? (
              <p className="mt-[40px] text-[16px] text-wisteria-deep" data-part="list-empty">
                Flag what&apos;s hard, or miss a question, and its topic shows up here.
              </p>
            ) : (
              <motion.ul variants={stagger()} initial="hidden" animate="show" className="mt-[24px] flex flex-col gap-[12px]" data-part="weak-list">
                {rows.map(({ topic, status, progress, weakSpots, offExam }) => (
                  <motion.li
                    key={topic.id}
                    variants={fadeUp}
                    data-part="weak-row"
                    data-status={status}
                    data-topic={topic.id}
                    data-off-exam={offExam ? "1" : undefined}
                    // Faint through its children: the entrance animation drives the row's own opacity.
                    className={`${offExam ? "[&>*]:opacity-40 " : ""}flex items-center gap-[16px] rounded-[20px] bg-parchment px-[22px] py-[14px] lip-4 lip-alice`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[19px] font-bold text-prussian">{topic.name}</p>
                      <p className="text-[14px] text-wisteria-deep">
                        {progress.mastered} of {progress.weak} weak spot{progress.weak === 1 ? "" : "s"} mastered
                        {weakSpots.some((s) => s.markedByStudent) && <span data-part="marked-by-you"> · marked by you</span>}
                      </p>
                    </div>
                    <StatusSlider
                      status={status}
                      pending={pending?.topicId === topic.id ? pending.to : null}
                      label={`${topic.name} status`}
                      // Mastered marks what isn't held yet; Needs review flags every weak spot again. In progress
                      // is where answers take a topic, not a place to put it by hand.
                      canPick={(to) => to !== "in-progress"}
                      onPick={(to) =>
                        setPending({
                          topicId: topic.id,
                          name: topic.name,
                          to,
                          ids: weakSpots.filter((s) => to === "needs-review" || !(s.status === "mastered" || s.status === "retired")).map((s) => s.objectiveId),
                        })
                      }
                    />
                    {!offExam && <button
                      type="button"
                      onClick={() => setDiving({ id: topic.id, name: topic.name })}
                      aria-label={`Dive into ${topic.name}`}
                      data-part="weak-row-play"
                      className="pressable flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-wisteria text-parchment lip-3 lip-wisteria"
                    >
                      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
                        <path d="M2 1.5v13l11-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                    </button>}
                  </motion.li>
                ))}
              </motion.ul>
            )}
            {cram && others.length > 0 && (
              <div className="mt-[16px]">
                <Button size="sm" variant="ghost" onClick={() => setShowOthers((v) => !v)} data-part="list-show-all">
                  {showOthers ? "Show exam topics only" : `Show ${others.length} other topic${others.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {pending && (
          <motion.div
            key="status-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-prussian/20 p-[20px]"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="status-confirm-title"
            data-part="status-confirm"
          >
            <motion.div variants={popIn} initial="hidden" animate="show" exit="exit" className="w-full max-w-[26rem] rounded-[20px] border-2 border-alice-deep bg-parchment p-[22px] text-prussian lip-4 lip-alice">
              <h2 id="status-confirm-title" className="text-[19px] font-bold">
                {pending.to === "mastered" ? `Mark ${pending.name} as mastered?` : `Move ${pending.name} back to Needs review?`}
              </h2>
              <p className="mt-[6px] text-[15px] text-prussian/80">
                {pending.to === "mastered"
                  ? `${pending.ids.length === 1 ? "Its weak spot counts" : `Its ${pending.ids.length} weak spots count`} as mastered now. Orca checks back in a week.`
                  : "Its weak spots start over and come back in your reviews."}
              </p>
              <div className="mt-[16px] flex justify-end gap-[10px]">
                <Button size="sm" variant="secondary" onClick={() => setPending(null)} data-part="status-discard">
                  Discard
                </Button>
                <Button
                  size="sm"
                  autoFocus
                  onClick={() => {
                    if (pending.to === "mastered") markMastered(course.id, pending.ids);
                    else flagObjectives(course.id, pending.ids);
                    setPending(null);
                  }}
                  data-part="status-confirm-yes"
                >
                  {pending.to === "mastered" ? "Mark mastered" : "Move back"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <DiveModal
        topic={diving}
        initialMinutes={durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60}
        onStart={(topicId, minutes) => router.push(`/session/${course.slug}?kind=deep&topic=${topicId}&minutes=${minutes}`)}
        onClose={closeDive}
      />
    </AppShell>
  );
}

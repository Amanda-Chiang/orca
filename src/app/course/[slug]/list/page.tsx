"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { DiveModal } from "@/components/quiz/DiveModal";
import { durationSeconds } from "@/lib/mastery/session";
import { weakSpotStatus, type WeakSpotStatus } from "@/lib/mastery/progress";
import { isInRotation } from "@/lib/mastery/flags";
import { StatusSlider } from "@/components/course/StatusSlider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { UploadsLink } from "@/components/course/UploadsLink";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DEFAULT_CONFIG, trailTopics } from "@/lib/data";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { fadeUp, popIn, stagger } from "@/lib/motion";

/**
 * List (owner, 2026-11-10): every topic with weak spots, in course order, with its status (needs
 * review, in progress, mastered; colours from the Atlas) and a play button that opens its dive.
 * The status is a 3-stop slider (owner, 2026-11-22): moving it to Mastered marks the topic's weak
 * spots mastered (MarkEvent, rules v5), to Needs review flags them hard again; a pop-up confirms.
 * Current and Previous tabs (owner, 2026-11-22): mastered topics move to Previous, with the day they
 * were mastered.
 */
export default function ListPage({ params }: PageProps<"/course/[slug]/list">) {
  const { slug } = use(params);
  const [diving, setDiving] = useState<{ id: string; name: string } | null>(null);
  const closeDive = useCallback(() => setDiving(null), []);
  const router = useRouter();
  const { hydrated, configs, markMastered, flagObjectives } = useOrca();
  // A status the student dragged a topic to: waiting for the pop-up's answer, then (confirmed) held on
  // the slider until the server's snapshots say the same, since status is read from them, not from
  // the event the browser just sent.
  const [pending, setPending] = useState<{ topicId: string; name: string; to: WeakSpotStatus; ids: string[]; confirmed: boolean } | null>(null);
  const [tab, setTab] = useState<"current" | "previous">("current");
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const m = course ? mastery[course.id] : undefined;
  const settled = pending?.confirmed && m ? weakSpotStatus(m.topicObjectives.get(pending.topicId) ?? [], m.objectives) === pending.to : false;
  useEffect(() => {
    if (!pending?.confirmed) return;
    // The server's state arrived; or the save failed and won't (the store says so): show what's true.
    const t = setTimeout(() => setPending(null), settled ? 0 : 10_000);
    return () => clearTimeout(t);
  }, [pending, settled]);

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
  if (!m) throw new Error(`No mastery computed for course ${course.id}`);

  const rows = trailTopics(course).flatMap((topic) => {
    const ids = m.topicObjectives.get(topic.id) ?? [];
    const status = weakSpotStatus(ids, m.objectives);
    const progress = m.topics.get(topic.id);
    if (!progress) throw new Error(`No progress computed for topic ${topic.id}`);
    const weakSpots = ids.flatMap((id) => {
      const s = m.objectives.get(id);
      if (!s) throw new Error(`No state computed for objective ${id}`);
      return isInRotation(s.status) || s.status === "check-due" ? [s] : [];
    });
    // When the topic became mastered: the last of its weak spots to get there (from the evidence; null if the log doesn't show it).
    const days = weakSpots.map((s) => m.masteredAt.get(s.objectiveId) ?? null);
    const masteredOn = status === "mastered" && days.length && days.every((d) => d !== null) ? days.reduce((a, b) => (a! > b! ? a : b)) : null;
    // A confirmed change shows at once (the slider holds it), so the row changes tab with it.
    const shown = pending?.confirmed && pending.topicId === topic.id ? pending.to : status;
    return status ? [{ topic, status, shown, progress, weakSpots, masteredOn }] : [];
  });
  const current = rows.filter((r) => r.shown !== "mastered");
  const previous = rows.filter((r) => r.shown === "mastered");
  const listed = tab === "current" ? current : previous;

  // The same header as Path (title, line, progress bar, then the pills), so the pills sit at the same height on every tab.
  const trail = trailTopics(course).map((t) => {
    const p = m.topics.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  });
  const weak = trail.reduce((sum, p) => sum + p.weak, 0);
  const pct = weak ? trail.reduce((sum, p) => sum + p.mastered, 0) / weak : 0;

  return (
    <AppShell bg="ocean">
      <div className="absolute inset-0 overflow-auto px-[28px] pb-[28px] pt-[28px]">
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
                {rows.length ? `${rows.length} topic${rows.length === 1 ? "" : "s"} with weak spots` : "No weak spots flagged yet"}
              </motion.p>
              <motion.div variants={fadeUp} className="mt-[6px] w-[240px]">
                <ProgressBar value={pct} height={12} label="Course progress" track="parchment" />
              </motion.div>
              <motion.div variants={fadeUp} className="mt-[4px] flex items-center gap-[10px]">
                <AtlasSwitch slug={course.slug} current="list" />
                <UploadsLink course={course} />
              </motion.div>
            </motion.header>

            {rows.length > 0 && (
              <div role="tablist" aria-label="Which topics" className="mt-[24px] flex justify-end gap-[6px]" data-part="list-tabs">
                {(
                  [
                    ["current", "Current", current.length],
                    ["previous", "Previous", previous.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    data-part="list-tab"
                    data-tab={key}
                    className={cn(
                      "pressable flex cursor-pointer items-center gap-[6px] rounded-pill px-[14px] py-[6px] text-[13px] font-bold lip-2",
                      tab === key ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
                    )}
                  >
                    {label}
                    <span className={cn("text-[12px]", tab === key ? "text-parchment/80" : "text-prussian/50")}>{count}</span>
                  </button>
                ))}
              </div>
            )}

            {rows.length === 0 || listed.length === 0 ? (
              <p className="mt-[40px] text-[16px] text-wisteria-deep" data-part="list-empty">
                {rows.length === 0
                  ? "Flag what's hard, or miss a question, and its topic shows up here."
                  : tab === "current"
                    ? "Nothing to work on right now. Topics you've mastered are under Previous."
                    : "Topics you master show up here."}
              </p>
            ) : (
              <motion.ul key={tab} variants={stagger()} initial="hidden" animate="show" className="mt-[12px] flex flex-col gap-[12px]" data-part="weak-list">
                {listed.map(({ topic, status, shown, progress, weakSpots, masteredOn }) => (
                  <motion.li
                    key={topic.id}
                    variants={fadeUp}
                    data-part="weak-row"
                    data-status={status}
                    className="flex items-center gap-[16px] rounded-[20px] bg-parchment px-[22px] py-[14px] lip-4 lip-alice"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[19px] font-bold text-prussian">{topic.name}</p>
                      <p className="text-[14px] text-wisteria-deep">
                        {shown === "mastered" ? (
                          <span data-part="mastered-on">{masteredOn ? `Mastered ${new Date(masteredOn).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Mastered"}</span>
                        ) : (
                          <>
                            {progress.mastered} of {progress.weak} weak spot{progress.weak === 1 ? "" : "s"} mastered
                          </>
                        )}
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
                          confirmed: false,
                          ids: weakSpots.filter((s) => to === "needs-review" || !(s.status === "mastered" || s.status === "retired")).map((s) => s.objectiveId),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setDiving({ id: topic.id, name: topic.name })}
                      aria-label={`Dive into ${topic.name}`}
                      data-part="weak-row-play"
                      className="pressable flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-wisteria text-parchment lip-3 lip-wisteria"
                    >
                      <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
                        <path d="M2 1.5v13l11-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {pending && !pending.confirmed && (
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
                    setPending({ ...pending, confirmed: true });
                  }}
                  data-part="status-confirm-yes"
                >
                  Confirm
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

"use client";

import { useEffect, useState } from "react";
import type { Material, PipelineRun } from "@/lib/data";
import { hiddenNote, pauseUploads, removeMaterial, retryUpload, stopUpload } from "@/lib/uploads";
import { progressMessage } from "@/lib/pipeline/progress-text";
import { isFinished, useRun } from "@/hooks/useRun";
import { useOrca } from "@/lib/store";
import { Card } from "@/components/ui/Card";
import { HardSlides } from "@/components/review/HardSlides";
import { DeleteUploadDialog } from "@/components/review/DeleteUploadDialog";
import { FileName } from "@/components/review/FileName";
import { WhatItAdded } from "@/components/review/WhatItAdded";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * The bar, step by step (owner, 2026-11-24). Each step's span is its share of a typical upload's time,
 * measured on 15 staged uploads of 5–12 handwritten pages: reading ~45 s, mapping ~80 s, writing
 * questions ~50 s when there are any (most files write none, and that step takes a second, so it gets
 * the last tenth). Inside a step the bar eases toward the step's end as time passes (1 - e^(-2t/typical):
 * about 85% of the way at the typical time), stopping short of it,
 * so it keeps moving without claiming a step is done; a known sub-stage (objectives after mapping)
 * sets a floor. It never goes back: waiting between steps holds the end of the step before.
 */
const STEPS = {
  prepare: { from: 0.02, to: 0.35, typicalS: 45 },
  structure: { from: 0.35, to: 0.9, typicalS: 80 },
  questions: { from: 0.9, to: 1, typicalS: 50 },
} as const;
type Step = keyof typeof STEPS;
/** Older (unstaged) runs report only a stage: the step it belongs to. */
const STEP_OF_STAGE: Record<string, Step> = { prepare: "prepare", transcribing: "prepare", "figures-reading": "prepare", structure: "structure", mapping: "structure", objectives: "structure", matching: "structure", questions: "questions", writing: "questions", figures: "questions" };
/** Sub-stages inside mapping: finding objectives starts about a third of the way in (after the map call). */
const STAGE_FLOOR: Record<string, number> = { objectives: 0.5 };

function progressShare(run: Pick<PipelineRun, "phase" | "progress" | "status" | "startedAt">, now: number): number {
  const step: Step | undefined = run.phase && run.phase in STEPS ? (run.phase as Step) : STEP_OF_STAGE[run.progress?.stage ?? ""];
  if (!step) return STEPS.prepare.from;
  const { from, to, typicalS } = STEPS[step];
  // Queued for this step: the bar holds where the step before ended.
  if (run.status !== "running") return from;
  // A staged run's startedAt is when this step started; an older run's is when the whole job did, so it doesn't ease.
  const elapsedS = run.phase && run.startedAt ? Math.max(0, (now - Date.parse(run.startedAt)) / 1000) : 0;
  const eased = from + (to - from) * 0.95 * (1 - Math.exp((-2 * elapsedS) / typicalS));
  return Math.max(eased, STAGE_FLOOR[run.progress?.stage ?? ""] ?? 0);
}

/** The current time, every second while `on` (the bar's easing); frozen otherwise. */
function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** A staged upload partway through (read, or topics added) and waiting for its next step: queued, but not back at the start. */
export const isBetweenSteps = (run: Pick<PipelineRun, "protocolVersion" | "status" | "phase">) =>
  run.protocolVersion === 2 && run.status === "queued" && (run.phase === "structure" || run.phase === "questions");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** When an upload started, as "Oct 17, 3:04 PM". */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * One upload's job: building (live progress), waiting (why), queued, failed (why), or done (what it
 * added and what was left out). An unfinished one follows its run on the server. `focused` is the
 * upload the page was opened for (`?run=`): the page already follows it (one Realtime channel per
 * run), and its parts keep the names the browser tests use.
 */
export function UploadCard({ run: stored, material, focused = false, openSlides = false }: { run: PipelineRun; material: Material | undefined; focused?: boolean; openSlides?: boolean }) {
  // Only an unfinished run is followed (a finished one won't change), and never twice.
  // After Try again, Stop, Pause or Resume the card follows its run live (Realtime, with a poll as
  // backstop) and shows each change as it lands (owner, 2026-11-24), instead of waiting for the store's
  // full reload: Retrying… → Queued → Building → Added.
  const [follow, setFollow] = useState(false);
  const { run: live } = useRun(focused || (!follow && isFinished(stored)) ? null : stored.id);
  // A finished stored row wins unless the card was told to follow: useRun keeps its last live row when it stops following, which would show a stopped run as still building.
  const run = follow && live ? live : isFinished(stored) ? stored : (live ?? stored);
  // Try again clicked: shows "Retrying…" until the run leaves the failure it was retried from.
  const [retryingFrom, setRetryingFrom] = useState<string | null>(null);
  const retrying = retryingFrom !== null && run.status === "failed" && (run.error ?? "") === retryingFrom;
  const { courses, refresh } = useOrca();
  const [pickingSlides, setPickingSlides] = useState(openSlides);
  const name = material?.filename ?? "An upload";
  const course = material ? courses.find((c) => c.id === material.courseId) : undefined;
  // Pause a queued upload (it leaves the queue), put a paused one back in line, stop a running one,
  // or remove the material. Stop and Remove ask once more before acting.
  const [pausing, setPausing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"remove" | null>(null);
  // A built upload's Delete: the pop-up stays open saying "Deleting…" until the file is gone and the
  // course has reloaded (a few seconds), and shows the error there if it fails.
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteFile = async () => {
    if (!material || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeMaterial(material.id);
      await refresh();
      setConfirming(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete the file.");
    } finally {
      setDeleting(false);
    }
  };
  const act = async (what: "stop" | "remove" | "retry") => {
    setConfirming(null);
    setPausing(null);
    if (what === "retry") setRetryingFrom(run.error ?? "");
    try {
      if (what === "stop") await stopUpload(run.id);
      else if (what === "retry" && material) await retryUpload(material.id);
      else if (material) await removeMaterial(material.id);
      if (what === "remove") await refresh();
      else {
        // The card follows the run itself from here; the store catches up in the background.
        setFollow(true);
        void refresh();
      }
    } catch (e) {
      setRetryingFrom(null);
      setPausing(e instanceof Error ? e.message : "Couldn't change the upload.");
    }
  };
  // A queued or paused upload hasn't been built: deleting it takes it out of the queue (its job is
  // cancelled) and removes the file, the same soft delete as removing built material.
  const unbuilt = run.protocolVersion === 2 ? !run.structureCommittedAt : run.status === "queued" || run.status === "paused";
  // Every state's Delete (queued, paused, waiting, running-then-stopped, failed, built) opens the same
  // pop-up (owner, 2026-11-24): it stays open saying "Deleting…" and the card goes when it closes.
  const deleteDialog = material && (
    <DeleteUploadDialog open={confirming === "remove"} filename={material.filename} built={!unbuilt} deleting={deleting} error={deleteError} onConfirm={() => void deleteFile()} onClose={() => !deleting && (setConfirming(null), setDeleteError(null))} />
  );
  const removeOffer = material && (
    <span className="flex flex-wrap items-center gap-[10px]" data-part="remove-offer">
      <button type="button" onClick={() => setConfirming("remove")} className="pressable shrink-0 cursor-pointer rounded-pill bg-bad px-[10px] py-[3px] text-[12px] font-bold text-parchment lip-2 lip-bad" data-part="remove-material">
        Delete
      </button>
      {deleteDialog}
    </span>
  );
  const setPaused = async (paused: boolean) => {
    setPausing(null);
    try {
      await pauseUploads({ runId: run.id }, paused);
      setFollow(true);
      void refresh();
    } catch (e) {
      setPausing(e instanceof Error ? e.message : "Couldn't change the upload.");
    }
  };
  // A staged upload between steps (read and waiting for the course's mapping turn, or topics added
  // and waiting to write questions) is back in the queue but not "Queued": it has its own badge.
  const between = isBetweenSteps(run);
  const now = useTick(run.status === "running");
  const badge = retrying ? RETRYING : between ? (run.phase === "questions" ? BETWEEN.questions : BETWEEN.structure) : STATUS[run.status];
  const part = (legacy: string) => (focused ? legacy : "upload-card");
  const head = (
    <span className="flex flex-wrap items-center gap-[8px]">
      <FileName material={material} fallback={name} />
      <span className={`rounded-pill px-[9px] py-[4px] text-[11px] font-bold ${badge.look}`} data-part="upload-status">
        {badge.label}
      </span>
      <span className="text-[13px] font-medium text-prussian/60">{when(run.at)}</span>
      {/* Hold-back (contract section 5): kept for a practice test, so no questions are written from it. */}
      {material?.heldBack && (
        <span className="rounded-pill bg-alice px-[9px] py-[4px] text-[11px] font-bold text-prussian" data-part="held-back" title="Kept hidden for a practice test: Orca writes no questions from it.">
          Held back
        </span>
      )}
    </span>
  );

  // The card's actions at the top right, as on a finished upload (owner, 2026-11-24): Pause, Resume or
  // Stop, then Delete. Stop acts at once (owner, 2026-11-24); a running upload has no Delete (stop it first).
  const pill = "pressable shrink-0 cursor-pointer rounded-pill px-[10px] py-[3px] text-[12px] font-bold lip-2";
  const stopButton = (
    <button type="button" onClick={() => void act("stop")} className={`${pill} bg-alice text-prussian lip-alice`} data-part="stop-upload">
      Stop
    </button>
  );
  const headWith = (actions: React.ReactNode, withDelete = true) => (
    <div className="flex items-center justify-between gap-[12px]">
      {head}
      <span className="flex shrink-0 items-center gap-[8px]">
        {actions}
        {withDelete && removeOffer}
      </span>
    </div>
  );
  if (run.status === "waiting") {
    // Held by a limit (a staged run's message says which, and when it continues): it resumes by itself, but the student can stop it or remove the file
    // meanwhile (2026-11-08; before, a waiting card offered nothing).
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-waiting")} data-status={run.status} role="status">
        {headWith(stopButton)}
        <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)}{run.protocolVersion === 2 ? "" : ` ${run.structureCommittedAt ? "Your topics are saved; the remaining questions appear when allowance is available." : "Nothing to do: Orca builds the topics and questions when the limit resets, and they appear here."}`}</span>
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "paused") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-paused")} data-status={run.status} role="status">
        {headWith(
          <button type="button" onClick={() => void setPaused(false)} className={`${pill} bg-wisteria text-parchment lip-wisteria`} data-part="resume-upload">
            Resume
          </button>,
        )}
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "queued" || run.status === "running") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-progress")} data-status={run.status} role="status">
        {run.status === "queued"
          ? headWith(
              <button type="button" onClick={() => void setPaused(true)} className={`${pill} bg-alice text-prussian lip-alice`} data-part="pause-upload">
                Pause
              </button>,
            )
          : headWith(stopButton, false)}
        <ProgressBar value={run.status === "running" || between ? progressShare(run, now) : 0} height={10} label="Building" />
        {between && <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)}</span>}
        {run.status === "running" && <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)}</span>}
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "failed") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part={part("run-failed")} data-status={run.status} role="alert">
        {headWith(
          material && (
            <button type="button" onClick={() => void act("retry")} disabled={retrying} className={`${pill} bg-wisteria text-parchment lip-wisteria disabled:opacity-70`} data-part="retry-upload">
              {retrying ? "Retrying…" : run.structureCommittedAt ? "Retry remaining work" : "Try again"}
            </button>
          ),
        )}
        <span className="text-[15px] font-semibold text-prussian">{run.structureCommittedAt ? "Topics were added; the remaining work failed." : `Nothing was added from ${material?.filename ?? "this upload"}.`}</span>
        <span className="text-[15px] text-prussian/80">{run.error}</span>
        <span className="text-[14px] text-prussian/70">The file is saved.</span>
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }

  const hidden = hiddenNote(run.hiddenText ?? material?.hiddenText);
  const aimed = run.security && (run.security.screen.some((h) => h.severity !== "weak") || run.security.instructionsFound.length > 0);
  return (
    <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part={part("run-summary")} data-status={run.status}>
      {/* Weak points first (Plan C): "Identify weak spots" (owner, 2026-11-10) opens the slide picker. Only a stored PDF or .pptx has pages to show.
          Delete sits to its left (owner, 2026-11-24), behind a pop-up that says what deleting does. */}
      <div className="flex items-center justify-between gap-[12px]">
        {head}
        <span className="flex shrink-0 items-center gap-[8px]">
          {material && (
            <button
              type="button"
              onClick={() => setConfirming("remove")}
              className="pressable shrink-0 cursor-pointer rounded-pill bg-bad px-[10px] py-[3px] text-[12px] font-bold text-parchment lip-2 lip-bad"
              data-part="remove-material"
            >
              Delete
            </button>
          )}
          {material?.storagePath && /\.(pdf|pptx)$/i.test(material.filename) && course && (
            <>
              <button
                type="button"
                onClick={() => setPickingSlides(true)}
                className="pressable shrink-0 cursor-pointer rounded-pill bg-wisteria px-[10px] py-[3px] text-[12px] font-bold text-parchment lip-2 lip-wisteria"
                data-part="hard-slides"
              >
                Identify weak spots
              </button>
              <HardSlides course={course} material={material} open={pickingSlides} onClose={() => setPickingSlides(false)} />
            </>
          )}
        </span>
      </div>
      {deleteDialog}
      <span className="text-[15px] text-prussian/80">
        {plural(run.topicsCreated.length, "new topic")}, {plural(run.objectivesCreated.length, "new objective")}, {run.objectivesAttached.length} existing objective
        {run.objectivesAttached.length === 1 ? "" : "s"} covered again
        {run.questionsAdded > 0 ? `, ${plural(run.questionsAdded, "question")} added.` : "."}
      </span>
      {course && <WhatItAdded run={run} course={course} />}
      {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      {hidden && (
        <span className="text-[14px] font-semibold text-prussian" data-part="hidden-text">
          {hidden} Check what this upload added.
        </span>
      )}
      {aimed && (
        <span className="text-[14px] font-semibold text-prussian" role="alert" data-part="security-warning">
          This file contains text aimed at an AI; check what it added.
          {run.security!.refused > 0 ? ` ${run.security!.refused} item${run.security!.refused === 1 ? " was" : "s were"} left out by Orca's checks (listed below).` : ""}
        </span>
      )}
      {run.dropped.length > 0 && (
        <details className="text-[14px] text-prussian/80">
          <summary className="cursor-pointer font-semibold text-wisteria-deep">{plural(run.dropped.length, "item")} left out</summary>
          <ul className="mt-[8px] flex flex-col gap-[6px]">
            {run.dropped.map((d, i) => (
              <li key={i}>
                <span className="font-semibold text-prussian">{d.prompt}</span> — {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

const STATUS: Record<PipelineRun["status"], { label: string; look: string }> = {
  queued: { label: "Queued", look: "bg-alice text-prussian" },
  paused: { label: "Paused", look: "bg-alice text-prussian" },
  running: { label: "Building", look: "bg-wisteria text-parchment" },
  waiting: { label: "Waiting", look: "bg-warn-tint text-warn-text" },
  done: { label: "Added", look: "bg-good-tint text-good-text" },
  failed: { label: "Failed", look: "bg-bad-tint text-bad-text" },
};

/** Try again clicked, until the run's new state arrives. */
const RETRYING = { label: "Retrying", look: "bg-wisteria text-parchment" };

/** A staged upload partway through, waiting for its next step (not back at the start of the queue). */
const BETWEEN = {
  structure: { label: "Waiting to map", look: "bg-periwinkle text-prussian" },
  questions: { label: "Topics added", look: "bg-periwinkle text-prussian" },
};

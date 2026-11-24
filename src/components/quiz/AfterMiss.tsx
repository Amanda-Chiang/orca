"use client";

import { motion } from "motion/react";
import type { GradeResult } from "@/lib/grading";
import type { ErrorType } from "@/lib/mastery/types";
import { ERROR_LABEL, SPOT_CHOICES, nudgeFor, spotVerdict } from "@/lib/quiz/after-miss";
import { MathText } from "@/components/ui/MathText";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

/**
 * The steps between a miss and its solution (src/lib/quiz/after-miss.ts). RetryPrompt asks for a
 * second try with a nudge that gives nothing away (the grader's kind of mistake, the ideas the answer
 * already had), never the grader's feedback, which may name the answer. SpotMistake shows the key
 * and asks what went wrong; the pick is shown against the grader's, not saved.
 */
export function RetryPrompt({ grade }: { grade: GradeResult | null }) {
  const nudge = nudgeFor(grade?.errorType);
  const had = grade?.outcome === "partial" ? (grade.satisfied ?? []) : [];
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="show"
      data-part="retry-prompt"
      aria-label="Try again"
      className="mt-[24px] flex flex-col gap-[8px] rounded-[24px] border-2 border-alice-deep bg-card px-[28px] py-[22px] lip-4 lip-alice"
    >
      <h2 className="text-[22px] font-bold text-prussian">{grade?.outcome === "partial" ? "Almost. One more try?" : "Not quite. One more try?"}</h2>
      <p className="text-[16px] font-medium leading-[24px] text-[#4a5578]">
        {nudge ?? (grade?.outcome === "partial" ? "Part of it is right." : "Think it through again before the solution shows.")} This try is practice: your first answer is what counts.
      </p>
      {had.length > 0 && (
        <p className="text-[15px] font-semibold text-wisteria-deep" data-part="retry-had">
          You already have: <MathText text={had.join(" · ")} />
        </p>
      )}
    </motion.section>
  );
}

export function SpotMistake({ keyText, graderError, picked, onPick }: { keyText: string; graderError: ErrorType | null; picked: ErrorType | "unknown" | null; onPick: (p: ErrorType | "unknown") => void }) {
  const verdict = picked ? spotVerdict(picked, graderError) : null;
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="show"
      data-part="spot-mistake"
      aria-label="What went wrong"
      className="mt-[24px] flex flex-col gap-[14px] rounded-[24px] border-2 border-alice-deep bg-card px-[28px] py-[22px] lip-4 lip-alice"
    >
      {keyText && (
        <p className="inline-flex max-w-full flex-wrap gap-x-[10px] self-start rounded-[12px] bg-alice px-[14px] py-[8px] text-[16px] font-semibold text-prussian" data-part="spot-key">
          <span className="font-bold">Answer</span>
          <span className="text-wisteria-deep">
            <MathText text={keyText} />
          </span>
        </p>
      )}
      <h2 className="text-[20px] font-bold text-prussian">What went wrong?</h2>
      <div className="flex flex-wrap gap-[10px]">
        {SPOT_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            disabled={picked !== null}
            onClick={() => onPick(c)}
            data-part="spot-choice"
            data-choice={c}
            aria-pressed={picked === c}
            className={cn(
              "pressable rounded-pill border-2 px-[14px] py-[7px] text-[15px] font-bold lip-2 disabled:cursor-default",
              picked === c ? "border-wisteria-deep bg-wisteria text-parchment lip-wisteria" : "border-periwinkle-deep bg-parchment text-prussian lip-periwinkle",
              picked !== null && picked !== c && "opacity-50",
            )}
          >
            {c === "unknown" ? "I didn't know it" : ERROR_LABEL[c]}
          </button>
        ))}
      </div>
      {verdict && (
        <p className="text-[15px] font-semibold text-wisteria-deep" data-part="spot-verdict">
          {verdict}
        </p>
      )}
    </motion.section>
  );
}

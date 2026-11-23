"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Course, Exam } from "@/lib/data";
import { daysUntil } from "@/lib/course/exam-card";
import { useConnectorStatus } from "@/components/course/useCram";
import { useOrca } from "@/lib/store";
import { useToday } from "@/hooks/useToday";
import { fadeUp } from "@/lib/motion";
import { setCramSoundOn, useCramSoundOn } from "@/lib/cram-sound";
import { IconSound, IconSoundOff } from "@/components/icons";

/** Height of the banner: the course pages push their header down by this in cram mode. */
export const CRAM_BANNER_H = 48;

const daysText = (days: number) => (days === 0 ? "Exam day" : days === 1 ? "Tomorrow" : `${days} days left`);

const PILL = "pressable rounded-pill bg-parchment px-[12px] py-[5px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice";

/**
 * Cram mode's banner across the top of a course page (owner, 2026-11-22), (the exam card it replaced is gone):
 * CRAM MODE, the exam and its days left; Open plan, Study with Claude until the connector is set up,
 * and Stop cramming.
 */
export function CramBanner({ course, exam }: { course: Pick<Course, "slug">; exam: Exam }) {
  const { updateExam } = useOrca();
  const today = useToday();
  const connected = useConnectorStatus(true);
  const soundOn = useCramSoundOn();
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="absolute inset-x-0 top-0 z-20 flex items-center gap-[12px] bg-bad px-[28px] text-prussian"
      style={{ height: CRAM_BANNER_H }}
      data-part="cram-banner"
    >
      <span className="text-[14px] font-bold uppercase tracking-[1.5px]">Cram mode</span>
      <span className="truncate text-[15px] font-bold">
        {exam.title}
        {today && <span className="font-semibold"> · {daysText(daysUntil(exam.date, today))}</span>}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-[8px]">
        {/* The dive's bubbles (src/lib/cram-sound.ts): on until turned off, kept in this browser. */}
        <button
          type="button"
          onClick={() => setCramSoundOn(!soundOn)}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Turn cram mode's sound off" : "Turn cram mode's sound on"}
          title={soundOn ? "Sound on" : "Sound off"}
          data-part="cram-sound"
          className={`${PILL} flex items-center px-[8px]!`}
        >
          {soundOn ? <IconSound size={16} /> : <IconSoundOff size={16} />}
        </button>
        <Link href={`/course/${course.slug}/cram`} data-part="cram-plan" className={PILL}>
          Open plan
        </Link>
        {!connected && (
          <Link href="/settings#connector" data-part="study-with-claude" className={PILL}>
            Study with Claude
          </Link>
        )}
        <button type="button" onClick={() => updateExam(exam.id, { cramming: false })} data-part="cram-stop" className={PILL}>
          Stop cramming
        </button>
      </div>
    </motion.div>
  );
}

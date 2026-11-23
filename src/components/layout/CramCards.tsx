"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { crammingExam, daysLeftText, daysUntil, examObjectives } from "@/lib/course/exam-card";
import { useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * The sidebar's cram cards (owner, 2026-11-22), above Due today: one red card per course in cram mode
 * (only this course's on a course page), CRAM FOR the course, the exam and its days left, and the
 * share of the exam's objectives verified, opening the cram page.
 */
export function CramCards({ courses }: { courses: readonly Course[] }) {
  const { exams, objectives } = useOrca();
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const today = dayKey(new Date(useNow()).toISOString());
  const cards = courses.flatMap((course) => {
    const exam = crammingExam(exams, course.id, today);
    const m = mastery[course.id];
    if (!exam || !m) return [];
    const scope = examObjectives(exam, course.topics, objectives[course.id] ?? {});
    const verified = scope.filter((id) => {
      const status = m.objectives.get(id)?.status;
      return status === "verified" || status === "mastered";
    }).length;
    return [{ course, exam, share: scope.length ? Math.round((verified / scope.length) * 100) : 0 }];
  });
  if (!cards.length) return null;
  return (
    <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]" aria-label="Cramming">
      {cards.map(({ course, exam, share }) => (
        <motion.div key={exam.id} variants={fadeUp}>
          <Link
            href={`/course/${course.slug}/cram`}
            data-part="cram-card"
            data-course={course.id}
            className="pressable flex flex-col gap-[6px] rounded-[18px] bg-cram px-[16px] py-[12px] text-parchment lip-4 lip-cram"
          >
            <span className="break-words text-[11px] font-bold uppercase tracking-[1.4px]">Cram for {course.name}</span>
            <span className="flex items-baseline justify-between gap-[10px]">
              <span className="truncate text-[17px] font-bold">{exam.title}</span>
              <span className="shrink-0 text-[13px] font-bold" data-part="cram-card-days">
                {daysLeftText(daysUntil(exam.date, today))}
              </span>
            </span>
            <span className="flex items-center gap-[10px]">
              <span className="h-[8px] flex-1 overflow-hidden rounded-pill bg-cram-deep" aria-hidden>
                <span className="block h-full rounded-pill bg-parchment" style={{ width: `${share}%` }} />
              </span>
              <span className="shrink-0 text-[13px] font-semibold" data-part="cram-card-progress">
                {share}% ready
              </span>
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.section>
  );
}

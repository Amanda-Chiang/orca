"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { DiveModal } from "@/components/quiz/DiveModal";
import { askableQuestions } from "@/lib/askable";
import { canFlagHard } from "@/lib/mastery/flags";
import { warmUpCandidates } from "@/lib/mastery/warmup";
import { durationSeconds } from "@/lib/mastery/session";
import { useAgenda, useCourse, useCramming, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { KnowledgePath } from "@/components/path/KnowledgePath";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { ExamsModal } from "@/components/config/ExamsModal";
import { CramBanner } from "@/components/course/CramBanner";
import { cardExam } from "@/lib/course/exam-card";
import { UploadsLink } from "@/components/course/UploadsLink";
import { fadeUp, stagger } from "@/lib/motion";
import { COURSE_NAME_MAX, DEFAULT_CONFIG, trailTopics } from "@/lib/data";
import { useNow } from "@/hooks/useNow";
import Link from "next/link";

export default function CoursePage({ params }: PageProps<"/course/[slug]">) {
  const { slug } = use(params);
  // A topic's dive: its popup ("Dive into [topic]") picks the length, then the session starts.
  const [diving, setDiving] = useState<{ id: string; name: string } | null>(null);
  const closeDive = useCallback(() => setDiving(null), []);
  const [editingExams, setEditingExams] = useState(false);
  const closeExams = useCallback(() => setEditingExams(false), []);
  const router = useRouter();
  const { hydrated, objectives, renameCourse, configs, flagObjectives, questionBank, feedback } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const agendas = useAgenda();
  // Cram mode (owner, 2026-11-22): the exam being crammed for and its topics; null otherwise.
  const cram = useCramming(course?.id);
  const { exams } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  // The exam "Enter cram mode" opens the setup for: the course's next one (cardExam).
  const nextExam = course ? cardExam(exams, course.id, dayKey(new Date(nowMs).toISOString())) : null;

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
  const topics = trailTopics(course);
  // Weak points first: the header counts the course's weak points (objectives in rotation) mastered.
  const progressOf = (topicId: string) => {
    const p = m.topics.get(topicId);
    if (!p) throw new Error(`No progress computed for topic ${topicId}`);
    return p;
  };
  const weak = topics.reduce((sum, t) => sum + progressOf(t.id).weak, 0);
  const held = topics.reduce((sum, t) => sum + progressOf(t.id).mastered, 0);
  const pct = weak ? held / weak : 0;
  const flaggable = (topicId: string) => (m.topicObjectives.get(topicId) ?? []).filter((id) => canFlagHard(m.objectives.get(id)!.status));
  const agenda = agendas[course.id];
  if (!agenda) throw new Error(`No agenda computed for course ${course.id}`);
  // Nothing flagged yet, but questions to try: the trail's START (src/lib/mastery/warmup.ts).
  const warm = agenda.dueToday.length === 0 ? warmUpCandidates(agenda.ranked, askableQuestions(course, questionBank[course.id], objectives[course.id] ?? {}, feedback).byObjective) : [];
  const warmUp = !cram && warm.length ? { topicName: course.topics.find((t) => t.id === warm[0].topicId)?.name ?? course.name, href: `/session/${course.slug}?kind=quick&warmup=1`, questions: warm.length } : null;

  return (
    <AppShell bg="ocean" cram={!!cram}>
      {cram && <CramBanner course={course} exam={cram.exam} />}
      {topics.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">This island is uncharted.</p>
          <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will map its topics.</p>
          <Button size="sm" onClick={() => router.push(`/add-material?course=${course.slug}`)} data-part="uncharted-add">
            Add material
          </Button>
        </div>
      ) : (
        <KnowledgePath course={course} progress={m.topics} onStart={(t) => setDiving({ id: t.id, name: t.name })} warmUp={warmUp} examTopics={cram?.topics ?? null} />
      )}

      <motion.header variants={stagger()} initial="hidden" animate="show" className={`absolute left-[28px] flex items-start gap-[16px] ${cram ? "top-[76px]" : "top-[28px]"}`}>
        <motion.div variants={fadeUp}>
          <BackButton />
        </motion.div>
        <div className="flex flex-col gap-[6px] pt-[2px]">
          <motion.h1
            variants={fadeUp}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Course name"
            spellCheck={false}
            onBlur={(e) => {
              // At most COURSE_NAME_MAX characters: a longer name is cut there, and the heading shows what was kept.
              const name = (e.currentTarget.textContent?.trim() ?? "").slice(0, COURSE_NAME_MAX).trim();
              e.currentTarget.textContent = name || course.name;
              if (name && name !== course.name) renameCourse(course.id, name);
              else e.currentTarget.textContent = course.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.currentTarget.textContent = course.name;
                e.currentTarget.blur();
              }
            }}
            className="text-[34px] font-bold leading-none text-prussian outline-none"
          >
            {course.name}
          </motion.h1>
          {/* No count line under the name (owner, 2026-11-22): the bar says how much of the weak spots is mastered. */}
          <motion.div variants={fadeUp} className="mt-[6px] w-[240px]" data-part={topics.length > 0 ? "weak-count" : undefined}>
            <ProgressBar value={pct} height={12} label="Course progress" track="parchment" />
          </motion.div>
          <motion.nav variants={fadeUp} aria-label="Course structure" className="mt-[4px] flex items-center gap-[10px]">
            <AtlasSwitch slug={course.slug} current="path" />
            <UploadsLink course={course} />
          </motion.nav>
        </div>
      </motion.header>

      <motion.div variants={fadeUp} initial="hidden" animate="show" role="group" aria-label="Practice" className={`absolute right-[28px] flex items-center gap-[10px] ${cram ? "top-[80px]" : "top-[32px]"}`}>
        <button type="button" onClick={() => setEditingExams(true)} data-part="edit-exams" className="pressable rounded-pill bg-prussian px-[14px] py-[7px] text-[13px] font-bold text-parchment lip-2 lip-ink">
          Edit Exams
        </button>
        {/* Cram mode is entered by hand (owner, 2026-11-22): the cram page's setup for the next exam, which Confirm turns on. */}
        {!cram && nextExam && (
          <Link href={`/course/${course.slug}/cram`} data-part="enter-cram" className="pressable rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice">
            Enter cram mode
          </Link>
        )}
      </motion.div>
      <ExamsModal course={editingExams ? course : null} onClose={closeExams} />
      <DiveModal
        topic={diving}
        initialMinutes={durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60}
        onStart={(topicId, minutes) => router.push(`/session/${course.slug}?kind=deep&topic=${topicId}&minutes=${minutes}`)}
        onClose={closeDive}
        onFlagTopic={
          // Every objective in the topic, except ones already being learned; no button when that's none. A flag on one with no questions writes them (requestFlagTopUp).
          diving && flaggable(diving.id).length
            ? (topicId) => {
                flagObjectives(course.id, flaggable(topicId));
                closeDive();
              }
            : undefined
        }
      />
    </AppShell>
  );
}

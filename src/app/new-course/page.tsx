"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useOrca } from "@/lib/store";
import { COURSE_NAME_MAX, type ClassMeeting } from "@/lib/data";
import { ClassMeetings, meetingProblem } from "@/components/config/ClassMeetings";
import { classCadence } from "@/lib/mastery/review-days";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Island } from "@/components/brand/Island";
import { Wave } from "@/components/brand/Decor";
import { LabelPill } from "@/components/map/LabelPill";
import { InfoTip } from "@/components/ui/InfoTip";
import { fadeUp, popIn, stagger } from "@/lib/motion";

export default function NewCoursePage() {
  const router = useRouter();
  const { addCourse, defaultConfig } = useOrca();
  const [name, setName] = useState("");
  const [meetings, setMeetings] = useState<ClassMeeting[]>([]);
  const trimmed = name.trim();
  const timesProblem = meetingProblem(meetings);

  const create = () => {
    if (!trimmed || timesProblem) return;
    // With class times, a daily quick review becomes one the day before class (owner, 2026-10-27), as the course's own setting.
    const follows = classCadence(meetings);
    const config = follows && defaultConfig.quick.cadence === "Daily" ? { ...defaultConfig, quick: { ...defaultConfig.quick, cadence: follows } } : null;
    addCourse(trimmed, meetings.length > 0 ? { meetings, quickDays: null, deepDays: null } : null, config);
    router.push("/");
  };

  return (
    // Fits the window: one column of the form beside the island, nothing below the fold.
    <Screen bg="ocean" className="h-screen-below-bar max-h-screen-below-bar">
      <header className="shrink-0 px-[28px] pt-[20px]">
        <BackButton />
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="relative flex min-h-0 flex-1"
      >
        <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="z-10 flex min-h-0 w-[600px] max-w-full flex-col overflow-y-auto px-[72px] [&>:first-child]:mt-auto [&>:last-child]:mb-auto pb-[48px] lg:px-[100px]">
          <motion.span variants={fadeUp} className="eyebrow">
            New island
          </motion.span>
          <motion.h1 variants={fadeUp} className="mt-[10px] whitespace-nowrap text-[40px] font-bold leading-[1.05] text-prussian">
            What are you studying?
          </motion.h1>

          <motion.label variants={fadeUp} className="mt-[28px] flex flex-col gap-[8px]">
            <span className="text-[14px] font-semibold text-wisteria-deep">Course Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={COURSE_NAME_MAX}
              placeholder="Advanced Logic Design"
              className="h-[60px] w-[440px] max-w-full rounded-[22px] border-[3.5px] border-wisteria bg-parchment px-[20px] text-[22px] font-semibold text-prussian lip-5 lip-periwinkle placeholder:font-medium placeholder:text-alice-deep focus:border-wisteria-deep focus:outline-none"
            />
          </motion.label>
          {/* The other ways in: a whole course from Canvas, or pages from Notion. */}
          <motion.div variants={fadeUp} className="mt-[14px] flex flex-wrap items-center gap-[8px] text-[13px] font-semibold text-wisteria-deep">
            Or import:
            <Link href="/import/canvas" className="pressable rounded-pill bg-alice px-[12px] py-[5px] font-bold text-prussian lip-2 lip-alice" data-part="import-from-canvas">
              Canvas course
            </Link>
            <Link href="/import/notion" className="pressable rounded-pill bg-alice px-[12px] py-[5px] font-bold text-prussian lip-2 lip-alice" data-part="import-from-notion">
              Notion pages
            </Link>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-[26px] flex w-[560px] max-w-full flex-col gap-[10px]">
            <span className="flex items-center gap-[6px] text-[14px] font-semibold text-wisteria-deep">
              When does it meet? (optional)
              <InfoTip label="About class times">Quick reviews and dives land the day before class. You can change this in the course&apos;s settings.</InfoTip>
            </span>
            <ClassMeetings meetings={meetings} onChange={setMeetings} />
            {timesProblem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{timesProblem}</span>}
          </motion.div>

          <motion.div variants={fadeUp} className="mt-[24px] flex items-center gap-[14px]">
            <Button type="submit" disabled={!trimmed || timesProblem !== null}>
              Create Course
            </Button>
            <Button variant="secondary" onClick={() => router.push("/")}>
              Cancel
            </Button>
          </motion.div>
        </motion.div>

        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[620px] md:block" aria-hidden>
          <Wave tone="light" x={20} y={120} width={70} seed={1} />
          <Wave tone="light" x={80} y={460} width={60} seed={2} />
          {/* Sized and placed to leave the label clear of the bottom edge of a 1280×800 laptop's window. */}
          <motion.div variants={popIn} initial="hidden" animate="show" className="absolute" style={{ left: 90, top: 40 }}>
            <Island variant="ald" level="growing" scale={1.6} float seed={2} />
            <div className="absolute left-[224px] -translate-x-1/2" style={{ top: 320 }}>
              <LabelPill interactive={false} className="text-[16px]">
                {trimmed || "Your course"}
              </LabelPill>
            </div>
          </motion.div>
        </div>
      </form>
    </Screen>
  );
}

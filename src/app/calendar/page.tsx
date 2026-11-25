"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { fadeSwap } from "@/lib/motion";
import type { CalendarEvent } from "@/lib/data";
import { useAgenda, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { reviewDates } from "@/lib/mastery/calendar";
import { crammingExam } from "@/lib/course/exam-card";
import { courseColors } from "@/lib/course/colors";
import {
  type CalendarFilter as Filter,
  type CalendarView,
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES,
  NO_FILTER,
  activeFilters,
  filterEntries,
  monthDays,
  readFilter,
  shiftAnchor,
  weekDays,
  writeFilter,
} from "@/lib/course/calendar-view";
import { useToday } from "@/hooks/useToday";
import { IconBack, IconNext } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { RoundButton } from "@/components/ui/RoundButton";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { CalendarEntry } from "@/components/calendar/CalendarEntry";
import { CalendarFilter, TypeMark } from "@/components/calendar/CalendarFilter";
import { cn } from "@/lib/cn";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "November" (with the year when it isn't this year's), or "Nov 22 – 28" for a week. */
function heading(view: CalendarView, anchor: string, days: readonly string[], today: string) {
  const year = (iso: string) => iso.slice(0, 4);
  if (view === "month") {
    const d = parseDay(anchor);
    return { main: d.toLocaleString("en-US", { month: "long" }), year: year(anchor) !== year(today) ? year(anchor) : null };
  }
  const first = parseDay(days[0]);
  const last = parseDay(days[6]);
  const short = (d: Date) => d.toLocaleString("en-US", { month: "short" });
  const main = first.getMonth() === last.getMonth() ? `${short(first)} ${first.getDate()} – ${last.getDate()}` : `${short(first)} ${first.getDate()} – ${short(last)} ${last.getDate()}`;
  return { main, year: year(days[6]) !== year(today) ? year(days[6]) : null };
}

export default function CalendarPage() {
  const { events, exams, courses } = useOrca();
  const agendas = useAgenda();
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const today = useToday();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Stored entries (homework due dates), each course's exams, and the scheduled reviews derived from its agenda.
  const shown = useMemo(() => {
    if (!today) return [];
    const reviews = reviewDates(
      // A course in cram mode has its reviews paused (owner, 2026-11-22).
      courses.filter((c) => !crammingExam(exams, c.id, today)).map((c) => {
        const agenda = agendas[c.id];
        const m = mastery[c.id];
        if (!agenda || !m) throw new Error(`No agenda computed for course ${c.id}`);
        return { id: c.id, agenda, objectives: m.objectives };
      }),
      today,
      dayKey,
    );
    const examEntries = exams.map((e) => ({ id: e.id, date: e.date, kind: "exam" as const, title: e.title, courseId: e.courseId }));
    // Exams first in a day, then homework, then reviews and dives.
    const order = { exam: 0, hw: 1, lab: 1, rev: 2, dive: 3 } as const;
    return [...events, ...examEntries, ...reviews].sort((a, b) => order[a.kind] - order[b.kind]);
  }, [events, exams, courses, agendas, mastery, dayKey, today]);

  // Courses in cram mode and the exams they cram for: the exam is red (owner, 2026-11-22).
  const cram = useMemo(() => {
    const crammed = today ? courses.flatMap((c) => crammingExam(exams, c.id, today) ?? []) : [];
    return { courses: new Set(crammed.map((e) => e.courseId)), exams: new Set(crammed.map((e) => e.id)) };
  }, [courses, exams, today]);
  const colors = useMemo(() => courseColors(courses), [courses]);
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  // The view and the filter live in the URL, so Back and a reload keep them.
  const view: CalendarView = params.get("view") === "week" ? "week" : "month";
  const filter = useMemo(() => readFilter(params, courses.map((c) => c.id)), [params, courses]);
  const setParams = useCallback(
    (next: URLSearchParams) => {
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const setFilter = (f: Filter) => setParams(writeFilter(f, new URLSearchParams(params)));
  const setView = (v: CalendarView) => {
    const next = new URLSearchParams(params);
    if (v === "month") next.delete("view");
    else next.set("view", v);
    setParams(next);
  };

  const visible = useMemo(() => filterEntries(shown, filter), [shown, filter]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [visible]);

  // null = follow today; set once the student pages away.
  const [picked, setPicked] = useState<string | null>(null);
  // Until the client clock is known, render the empty sea rather than a wrong month.
  if (!today) return <Screen bg="ocean" />;
  const anchor = picked ?? today;
  const days = view === "month" ? monthDays(anchor) : weekDays(anchor);
  const title = heading(view, anchor, days, today);
  const showsToday = days.includes(today) && (view === "week" || anchor.slice(0, 7) === today.slice(0, 7));

  const entry = (e: CalendarEvent, compact: boolean) => {
    const course = e.courseId ? byId.get(e.courseId) : undefined;
    const cramming = cram.exams.has(e.id) ? "exam" : e.courseId && cram.courses.has(e.courseId) ? "course" : undefined;
    return <CalendarEntry event={e} course={course} color={e.courseId ? colors.get(e.courseId) : undefined} cramming={cramming} compact={compact} />;
  };

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[24px]">
        <BackButton />
        <AnimatePresence mode="wait">
          <motion.h1 key={`${view}-${days[0]}`} variants={fadeSwap} initial="hidden" animate="show" exit="exit" className="min-w-[230px] text-[40px] font-bold leading-none text-prussian">
            {title.main}
            {title.year && <span className="ml-3 text-[24px] font-semibold text-wisteria-deep">{title.year}</span>}
          </motion.h1>
        </AnimatePresence>
        <div role="group" aria-label="View" className="flex rounded-pill bg-alice p-[3px]" data-part="view-switch">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
              className={cn("rounded-pill px-[16px] py-[7px] text-[14px] font-bold text-prussian", view === v.id ? "bg-card shadow-[0_1px_0_var(--color-alice-deep)]" : "opacity-70 hover:opacity-100")}
            >
              {v.label}
            </button>
          ))}
        </div>
        {courses.length > 0 && <CalendarFilter filter={filter} onChange={setFilter} courses={courses} colors={colors} cramming={cram.courses} />}
        <div className="ml-auto flex items-center gap-[10px]">
          {!showsToday && (
            <button type="button" onClick={() => setPicked(null)} className="pressable h-[40px] rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[14px] text-[15px] font-bold text-prussian lip-3 lip-periwinkle">
              Today
            </button>
          )}
          <RoundButton size={44} label={view === "month" ? "Previous month" : "Previous week"} onClick={() => setPicked(shiftAnchor(anchor, view, -1))}>
            <IconBack size={20} />
          </RoundButton>
          <RoundButton size={44} label={view === "month" ? "Next month" : "Next week"} onClick={() => setPicked(shiftAnchor(anchor, view, 1))}>
            <IconNext size={20} />
          </RoundButton>
        </div>
      </header>

      <div className="px-[28px] pb-[32px] pt-[20px]">
        {activeFilters(filter) > 0 && visible.length === 0 && (
          <p className="mb-[12px] flex items-center gap-[10px] text-[15px] font-semibold text-prussian" data-part="filter-empty">
            Nothing matches these filters.
            <button type="button" onClick={() => setFilter(NO_FILTER)} className="font-bold text-wisteria-deep hover:underline">
              Clear
            </button>
          </p>
        )}
        {view === "month" ? (
          <MonthGrid days={days} month={anchor.slice(0, 7)} today={today} byDate={byDate} entry={entry} />
        ) : (
          <WeekGrid days={days} today={today} byDate={byDate} entry={entry} />
        )}
        <div className="mt-[12px] flex flex-wrap items-center gap-x-[18px] gap-y-[6px] text-[13px] font-semibold text-prussian" aria-label="Key" data-part="calendar-key">
          {ENTRY_TYPES.map((t) => (
            <span key={t} className="inline-flex items-center gap-[6px]">
              <TypeMark type={t} />
              {ENTRY_TYPE_LABELS[t]}
            </span>
          ))}
          {cram.courses.size > 0 && (
            <span className="inline-flex items-center gap-[6px]" data-part="cram-legend">
              <span aria-hidden className="h-[16px] w-[16px] rounded-[4px] bg-cram" />
              Cramming
            </span>
          )}
          <span className="text-muted">Colour = course</span>
        </div>
      </div>
    </Screen>
  );
}

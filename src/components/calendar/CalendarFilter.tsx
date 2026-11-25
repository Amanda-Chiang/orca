"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconDown } from "@/components/icons";
import { type CalendarFilter as Filter, ENTRY_TYPE_LABELS, ENTRY_TYPES, type EntryType, activeFilters, toggle } from "@/lib/course/calendar-view";
import type { CourseColor } from "@/lib/course/colors";
import { useDismiss } from "@/hooks/useDismiss";
import { popIn } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { ENTRY_MARKS } from "./CalendarEntry";

/** Filter button and its pop-up: courses and kinds of entry, combined (an entry shows when both are ticked). */
export function CalendarFilter({
  filter,
  onChange,
  courses,
  colors,
  cramming,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  courses: readonly { id: string; name: string }[];
  colors: ReadonlyMap<string, CourseColor>;
  cramming: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);
  const count = activeFilters(filter);
  const courseIds = courses.map((c) => c.id);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        data-part="calendar-filter"
        className={cn(
          "pressable inline-flex h-[40px] w-[128px] items-center justify-between rounded-[12px] border-2 px-[14px] text-[15px] font-bold text-prussian lip-3",
          count > 0 ? "border-wisteria-deep bg-alice lip-wisteria" : "border-periwinkle-deep bg-parchment lip-periwinkle",
        )}
      >
        Filter
        {/* Room for a two-digit count kept whether or not it shows, so the button never changes width. */}
        <span className="flex min-w-[26px] justify-center">
          {count > 0 && <span className="rounded-pill bg-wisteria-deep px-[7px] py-[1px] text-[12px] text-parchment">{count}</span>}
        </span>
        <IconDown size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Filter the calendar"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            data-part="filter-panel"
            className="absolute left-0 top-[50px] z-30 flex w-[280px] flex-col gap-[14px] rounded-[18px] border border-line bg-card p-[16px] shadow-[0_12px_32px_-6px_rgb(21_29_58/0.3)]"
          >
            <Group title="Courses" all={filter.courses === null} none={filter.courses?.size === 0} onAll={() => onChange({ ...filter, courses: null })} onNone={() => onChange({ ...filter, courses: new Set() })}>
              {courses.map((c) => (
                <Check key={c.id} checked={filter.courses?.has(c.id) ?? true} onChange={() => onChange({ ...filter, courses: toggle(filter.courses, c.id, courseIds) })}>
                  <span aria-hidden className={cn("h-[10px] w-[10px] shrink-0 rounded-full", colors.get(c.id)?.bg)} />
                  <span className="min-w-0 truncate" title={c.name}>{c.name}</span>
                  {cramming.has(c.id) && <span className="shrink-0 text-[12px] font-bold text-cram">· cramming</span>}
                </Check>
              ))}
            </Group>
            <Group title="Types" all={filter.types === null} none={filter.types?.size === 0} onAll={() => onChange({ ...filter, types: null })} onNone={() => onChange({ ...filter, types: new Set() })}>
              {ENTRY_TYPES.map((t) => (
                <Check key={t} checked={filter.types?.has(t) ?? true} onChange={() => onChange({ ...filter, types: toggle<EntryType>(filter.types, t, ENTRY_TYPES) })}>
                  <TypeMark type={t} />
                  {ENTRY_TYPE_LABELS[t]}
                </Check>
              ))}
            </Group>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The shape a type has on the grid, in neutral colour (the key and the filter). */
export function TypeMark({ type }: { type: EntryType }) {
  if (type === "exam") return <span aria-hidden className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] bg-prussian text-[9px] text-parchment">{ENTRY_MARKS.exam}</span>;
  if (type === "hw") return <span aria-hidden className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border-2 border-prussian text-[9px] text-prussian">{ENTRY_MARKS.hw}</span>;
  return (
    <span aria-hidden className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
      <span className={cn("h-[8px] w-[8px] rounded-full", type === "dive" ? "border-2 border-prussian" : "bg-prussian")} />
    </span>
  );
}

/** A group of checkboxes with Select all and Deselect all (each greyed out when it would change nothing). */
function Group({ title, all, none, onAll, onNone, children }: { title: string; all: boolean; none: boolean; onAll: () => void; onNone: () => void; children: React.ReactNode }) {
  const action = "text-[12px] font-bold text-wisteria-deep hover:underline disabled:cursor-default disabled:text-muted/60 disabled:no-underline";
  return (
    <fieldset className="flex min-w-0 flex-col gap-[6px]" data-group={title.toLowerCase()}>
      <div className="flex items-center gap-[10px]">
        <legend className="eyebrow mr-auto text-[12px] text-wisteria-deep">{title}</legend>
        <button type="button" onClick={onAll} disabled={all} data-part="select-all" className={action}>
          Select all
        </button>
        <button type="button" onClick={onNone} disabled={none} data-part="deselect-all" className={action}>
          Deselect all
        </button>
      </div>
      {children}
    </fieldset>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-[8px] rounded-[8px] px-[4px] py-[3px] text-[14px] font-semibold text-prussian hover:bg-alice/50">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-[16px] w-[16px] shrink-0 accent-wisteria-deep" />
      {children}
    </label>
  );
}

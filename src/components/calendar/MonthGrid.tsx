"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Box } from "@/lib/anchor-geometry";
import { AnchoredBubble } from "@/components/ui/AnchoredBubble";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@/lib/cn";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** At most this many entries a day before "+n more"; fewer when the rows are short (they share the window's height). */
const MAX_SHOWN = 4;
/** A compact entry's height with the gap under it, and what a day spends on its padding and date. */
const ENTRY_PX = 24;
const DAY_CHROME_PX = 40;

/** How many entries fit in a row `height` px tall: at least 1, at most MAX_SHOWN. */
function entriesThatFit(height: number) {
  return Math.max(1, Math.min(MAX_SHOWN, Math.floor((height - DAY_CHROME_PX) / ENTRY_PX)));
}

/** "Wednesday, Nov 12" for a local ISO day. */
export function dayTitle(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/**
 * The month: its weeks on one hairline grid. A day shows its first few entries; "+n more", or a
 * click anywhere on the day, opens a pop-up with all of them, so rows never change height. The weeks
 * share the height they're given (the calendar fits the window), and a day shows as many entries as fit.
 */
export function MonthGrid<E extends { id: string }>({
  days,
  month,
  today,
  byDate,
  entry,
}: {
  /** Whole weeks of local ISO days, Sunday first. */
  days: readonly string[];
  /** "YYYY-MM" of the month shown; other days are faded. */
  month: string;
  today: string;
  byDate: ReadonlyMap<string, E[]>;
  entry: (e: E, compact: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState<{ day: string; box: Box } | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(popover, open !== null, close, { inside: "[data-part=day-popover]", onScroll: true });
  const grid = useRef<HTMLDivElement>(null);
  const weeks = Math.max(1, days.length / 7);
  const [shown, setShown] = useState(MAX_SHOWN);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => setShown(entriesThatFit(el.clientHeight / weeks));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [weeks]);
  const openDay = (day: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen((o) => (o?.day === day ? null : { day, box: { left: r.left, top: r.top, width: r.width, height: r.height } }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border border-line bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-[8px] text-center text-[12px] font-semibold uppercase tracking-[1px] text-wisteria-deep">
            {w}
          </span>
        ))}
      </div>
      <div ref={grid} className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }} data-part="month-weeks">
        {days.map((iso, i) => {
          const inMonth = iso.startsWith(month);
          const isToday = iso === today;
          const evs = byDate.get(iso) ?? [];
          return (
            <div
              key={iso}
              data-day={iso}
              data-today={isToday || undefined}
              onClick={(e) => evs.length > 0 && openDay(iso, e.currentTarget)}
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-[3px] overflow-hidden border-line p-[6px]",
                i % 7 !== 6 && "border-r",
                i < days.length - 7 && "border-b",
                !inMonth && "bg-page",
                evs.length > 0 && "cursor-pointer hover:bg-alice/40",
              )}
            >
              <span
                className={cn(
                  "mb-[1px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-pill text-[13px] font-bold",
                  isToday ? "bg-wisteria text-parchment" : inMonth ? "text-prussian" : "text-muted/60",
                )}
              >
                {Number(iso.slice(8))}
              </span>
              <div className={cn("flex min-h-0 flex-col gap-[3px]", !inMonth && "opacity-50")}>
                {evs.slice(0, evs.length > shown ? shown - 1 : shown).map((e) => (
                  <div key={e.id}>{entry(e, true)}</div>
                ))}
                {evs.length > shown && (
                  <button
                    type="button"
                    data-part="more"
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDay(iso, e.currentTarget.closest("[data-day]") as HTMLElement);
                    }}
                    className="self-start rounded-[6px] px-[6px] text-[11.5px] font-bold text-wisteria-deep hover:underline"
                  >
                    +{evs.length - (shown - 1)} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AnimatePresence>
        {open && (
          <DayPopover key={open.day} ref={popover} day={open.day} box={open.box} onClose={close}>
            {(byDate.get(open.day) ?? []).map((e) => (
              <div key={e.id}>{entry(e, false)}</div>
            ))}
          </DayPopover>
        )}
      </AnimatePresence>
    </div>
  );
}

function DayPopover({ ref, day, box, onClose, children }: { ref: React.Ref<HTMLDivElement>; day: string; box: Box; onClose: () => void; children: ReactNode }) {
  return (
    <AnchoredBubble target={box} width={300} preferredSide="right" onClose={onClose} closeLabel="Close day" label={dayTitle(day)} data-part="day-popover" className="px-[16px] pb-[14px] pt-[16px]">
      <div ref={ref} className="flex flex-col gap-[6px]">
        <h2 className="pr-[28px] text-[15px] font-bold text-prussian">{dayTitle(day)}</h2>
        {children}
      </div>
    </AnchoredBubble>
  );
}

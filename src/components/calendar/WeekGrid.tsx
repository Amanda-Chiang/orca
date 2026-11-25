import type { ReactNode } from "react";
import type { CalendarEvent } from "@/lib/data";
import { cn } from "@/lib/cn";
import { WEEKDAYS } from "./MonthGrid";

/** The week: seven tall columns, every entry in full (course over what it is). Entries have no time of day, so no hours. */
export function WeekGrid({
  days,
  today,
  byDate,
  entry,
}: {
  days: readonly string[];
  today: string;
  byDate: ReadonlyMap<string, CalendarEvent[]>;
  entry: (e: CalendarEvent, compact: boolean) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-[20px] border border-line bg-card">
      {days.map((iso, i) => {
        const isToday = iso === today;
        const evs = byDate.get(iso) ?? [];
        return (
          <div key={iso} data-day={iso} data-today={isToday || undefined} className={cn("flex min-h-[460px] min-w-0 flex-col gap-[6px] border-line p-[8px]", i < 6 && "border-r", isToday && "bg-alice/40")}>
            <div className="mb-[4px] flex flex-col items-start">
              <span className="text-[12px] font-semibold uppercase tracking-[1px] text-wisteria-deep">{WEEKDAYS[i]}</span>
              <span className={cn("flex h-[32px] min-w-[32px] items-center justify-center rounded-pill text-[20px] font-bold", isToday ? "bg-wisteria px-[6px] text-parchment" : "text-prussian")}>
                {Number(iso.slice(8))}
              </span>
            </div>
            {evs.map((e) => (
              <div key={e.id}>{entry(e, false)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

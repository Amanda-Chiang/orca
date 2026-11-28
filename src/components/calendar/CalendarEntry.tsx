import type { CalendarEvent } from "@/lib/data";
import type { GoogleEntry } from "@/lib/google/events";
import type { CourseColor } from "@/lib/course/colors";
import { entryType } from "@/lib/course/calendar-view";
import { cn } from "@/lib/cn";

/** The mark before each kind of entry (shape says the type; colour says the course). */
export const ENTRY_MARKS = { exam: "★", hw: "✎" } as const;

/**
 * One calendar entry. Colour is its course; shape is its type, louder the rarer and weightier it is:
 * an exam is a solid bar, homework an outline, a quick review or a dive a dot and text. The exam a
 * course is cramming for is solid red. `compact` (the month grid) is one line with the course's short
 * name; otherwise two lines, the course's full name over what it is.
 */
export function CalendarEntry({
  event,
  course,
  color,
  cramming,
  compact,
}: {
  event: CalendarEvent;
  course?: { name: string; short: string };
  color?: CourseColor;
  cramming?: "exam" | "course";
  compact?: boolean;
}) {
  const type = entryType(event.kind);
  const mark = type === "exam" || type === "hw" ? ENTRY_MARKS[type] : null;
  const look =
    type === "exam"
      ? cramming === "exam"
        ? "bg-cram text-parchment"
        : color
          ? cn(color.bg, "text-prussian")
          : "bg-prussian text-parchment"
      : type === "hw"
        ? cn("border-2 bg-card text-prussian", color?.border ?? "border-alice-deep")
        : "text-prussian";
  const lead = mark ? (
    <span aria-hidden className="shrink-0 text-[10px]">
      {mark}
    </span>
  ) : (
    // A quick review is a filled dot, a dive a ring.
    <span aria-hidden className={cn("h-[8px] w-[8px] shrink-0 rounded-full", type === "dive" ? cn("border-2", color?.border ?? "border-wisteria") : (color?.bg ?? "bg-wisteria"))} />
  );
  return (
    <div
      data-part="event"
      data-kind={type}
      data-cramming={cramming}
      title={course ? `${course.name} · ${event.title}` : event.title}
      className={cn("flex min-w-0 rounded-[7px] font-bold leading-[1.2]", compact ? "items-center gap-[5px] px-[6px] py-[3px] text-[11.5px]" : "gap-[6px] px-[8px] py-[6px] text-[12.5px]", look)}
    >
      <span className={cn("flex", !compact && "pt-[4px]")}>{lead}</span>
      {compact ? (
        <span className="truncate">{course ? `${course.short} · ${event.title}` : event.title}</span>
      ) : (
        <span className="flex min-w-0 flex-col">
          {course && <span className="break-words">{course.name}</span>}
          <span className={cn("break-words", course && "font-medium opacity-80")}>{event.title}</span>
        </span>
      )}
    </div>
  );
}

/** One of the student's Google Calendar events (read only, 2026-11-28): quiet, so Orca's own entries lead. */
export function GoogleCalendarEntry({ event, compact }: { event: GoogleEntry; compact?: boolean }) {
  const label = event.time ? `${event.time} ${event.title}` : event.title;
  return (
    <div
      data-part="google-event"
      title={`${event.calendar} · ${label}`}
      className={cn("flex min-w-0 items-center rounded-[7px] border border-dashed border-line font-semibold leading-[1.2] text-muted", compact ? "gap-[5px] px-[6px] py-[2px] text-[11.5px]" : "gap-[6px] px-[8px] py-[5px] text-[12.5px]")}
    >
      <span className={compact ? "truncate" : "break-words"}>{label}</span>
    </div>
  );
}

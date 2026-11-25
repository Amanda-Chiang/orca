/**
 * The calendar's views and filters (pure): which days a month or week view shows, the four kinds of
 * entry a student filters by, and the filter kept in the page's URL. Dates are local ISO days.
 */
import type { CalendarEvent, EventKind } from "../data.ts";

export type CalendarView = "month" | "week";

/** What the filter calls each kind of entry ("lab" is homework's old twin). */
export type EntryType = "exam" | "hw" | "rev" | "dive";
export const ENTRY_TYPES: readonly EntryType[] = ["exam", "hw", "rev", "dive"];
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = { exam: "Exams", hw: "Homework", rev: "Quick reviews", dive: "Dives" };

export function entryType(kind: EventKind): EntryType {
  return kind === "lab" ? "hw" : kind;
}

/** null = every course (or every type): nothing filtered. An empty set hides them all. */
export interface CalendarFilter {
  courses: ReadonlySet<string> | null;
  types: ReadonlySet<EntryType> | null;
}

export const NO_FILTER: CalendarFilter = { courses: null, types: null };

/** Entries whose course and type both pass. An entry without a course passes the course filter only when it's off. */
export function filterEntries<E extends CalendarEvent>(events: readonly E[], f: CalendarFilter): E[] {
  return events.filter(
    (e) => (f.courses === null || (e.courseId !== undefined && f.courses.has(e.courseId))) && (f.types === null || f.types.has(entryType(e.kind))),
  );
}

/** How many of the two filters are on (for the button's count). */
export function activeFilters(f: CalendarFilter): number {
  return (f.courses === null ? 0 : 1) + (f.types === null ? 0 : 1);
}

/**
 * The filter from the URL: `courses` and `types` are comma lists; absent means all, empty means none.
 * Unknown types and courses that no longer exist are dropped; a list left empty that way means all
 * again, so a stale link never hides everything.
 */
export function readFilter(params: { get(name: string): string | null }, courseIds: readonly string[]): CalendarFilter {
  const list = (name: string) => {
    const raw = params.get(name);
    return raw === null ? null : raw.split(",").filter(Boolean);
  };
  // An empty list is "none" (Deselect all); a list whose every item is gone is "all".
  const pick = <T extends string>(raw: string[] | null, valid: (v: string) => v is T): ReadonlySet<T> | null => {
    if (raw === null) return null;
    if (raw.length === 0) return new Set();
    const kept = raw.filter(valid);
    return kept.length > 0 ? new Set(kept) : null;
  };
  return {
    courses: pick(list("courses"), (id): id is string => courseIds.includes(id)),
    types: pick(list("types"), (t): t is EntryType => (ENTRY_TYPES as readonly string[]).includes(t)),
  };
}

/** The filter as URL params (only the parts that are on). */
export function writeFilter(f: CalendarFilter, params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(params);
  out.delete("courses");
  out.delete("types");
  if (f.courses !== null) out.set("courses", [...f.courses].join(","));
  if (f.types !== null) out.set("types", [...f.types].join(","));
  return out;
}

/**
 * Tick or untick one course (or type) in the filter. Unticking from "all" leaves every other one;
 * ticking the last missing one goes back to all; unticking the last one left is none.
 */
export function toggle<T extends string>(current: ReadonlySet<T> | null, value: T, all: readonly T[]): ReadonlySet<T> | null {
  const next = new Set(current ?? all);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size === all.length ? null : next;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** The month grid around `anchor`'s month: whole weeks from Sunday, only those holding a day of the month (4 to 6). */
export function monthDays(anchor: string): string[] {
  const a = parse(anchor);
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const length = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + length) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay() + i)));
}

/** The 7 days, Sunday first, of the week containing `anchor`. */
export function weekDays(anchor: string): string[] {
  const a = parse(anchor);
  return Array.from({ length: 7 }, (_, i) => iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay() + i)));
}

/** The anchor one page on: a month (to its 1st) or a week. */
export function shiftAnchor(anchor: string, view: CalendarView, n: number): string {
  const a = parse(anchor);
  return iso(view === "month" ? new Date(a.getFullYear(), a.getMonth() + n, 1) : new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * n));
}

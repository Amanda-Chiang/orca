/**
 * The student's Google Calendar events on Orca's calendar (owner, 2026-11-28: Orca reads their
 * calendars, read only), pure: Google's event resources trimmed to what the page shows, and each
 * placed on the local days it falls on. Server code: `googleEvents` in `src/lib/server/google.ts`.
 */

/** The fields Orca asks Google for. */
export interface RawGoogleEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  transparency?: string;
}

/** One event as the API route answers it: all-day events by date (end exclusive), others by instant. */
export interface GoogleCalendarEvent {
  id: string;
  calendar: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
}

/** null for a cancelled or malformed event. A title-less event is "Busy", as Google shows one it can't name. */
export function fromGoogleEvent(e: RawGoogleEvent, calendar: string): GoogleCalendarEvent | null {
  if (e.status === "cancelled") return null;
  const allDay = Boolean(e.start?.date);
  const start = allDay ? e.start?.date : e.start?.dateTime;
  const end = allDay ? e.end?.date : e.end?.dateTime;
  if (!start || !end) return null;
  return { id: e.id, calendar, title: e.summary?.trim() || "Busy", allDay, start, end };
}

/** A Google event on one day of Orca's calendar. */
export interface GoogleEntry {
  id: string;
  date: string;
  kind: "google";
  title: string;
  calendar: string;
  /** "9:05 AM" for a timed event (its local start), null for an all-day one. */
  time: string | null;
}

function localDayAndTime(instant: string, timeZone: string): { day: string; time: string } {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a time: ${instant}`);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  return { day, time };
}

/**
 * The entries for `days` (local ISO days, in order): an all-day event on each day it covers, a timed
 * one on the local day it starts, sorted all-day first, then by start.
 */
export function googleEntries(events: readonly GoogleCalendarEvent[], days: readonly string[], timeZone: string): GoogleEntry[] {
  const shown = new Set(days);
  const out: { entry: GoogleEntry; sort: string }[] = [];
  for (const e of events) {
    if (e.allDay) {
      for (const day of days) if (day >= e.start && day < e.end) out.push({ entry: { id: `g:${e.id}@${day}`, date: day, kind: "google", title: e.title, calendar: e.calendar, time: null }, sort: "" });
    } else {
      const { day, time } = localDayAndTime(e.start, timeZone);
      if (shown.has(day)) out.push({ entry: { id: `g:${e.id}@${day}`, date: day, kind: "google", title: e.title, calendar: e.calendar, time }, sort: new Date(e.start).toISOString() });
    }
  }
  // Two calendars can share an event (an invitation on both): keep one.
  const seen = new Set<string>();
  return out
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map((o) => o.entry)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

/**
 * The Orca calendar in the student's Google Calendar (2026-11-27), pure: Orca's events
 * (`orcaEvents`, the same ones the subscription feed serves) as Google Calendar event resources,
 * and the plan that brings the calendar in line with them. Event ids are derived from Orca's stable
 * uids, so a sync updates instead of duplicating; each event carries a hash of its content, so an
 * unchanged event isn't written again.
 */
import { createHash } from "node:crypto";
import type { OrcaCalendarEvent } from "../calendar/ics.ts";

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  recurrence?: string[];
  transparency: "opaque" | "transparent";
  extendedProperties: { private: { orca: string; h: string } };
}

/** A Google event id for an Orca uid: base32hex characters only (lowercase a–v, 0–9), as Google requires. */
export function googleEventId(uid: string): string {
  return `orca${createHash("sha256").update(uid).digest("hex").slice(0, 32)}`;
}

function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Not a day: ${day}`);
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

export function toGoogleEvent(e: OrcaCalendarEvent, timeZone: string): GoogleEvent {
  const body = {
    summary: e.summary,
    ...(e.description ? { description: e.description } : {}),
    start: e.times ? { dateTime: `${e.day}T${e.times.start}:00`, timeZone } : { date: e.day },
    end: e.times ? { dateTime: `${e.day}T${e.times.end}:00`, timeZone } : { date: nextDay(e.day) },
    ...(e.weekly !== undefined ? { recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[e.weekly]}`] } : {}),
    // Class meetings block time; all-day reminders don't.
    transparency: (e.times ? "opaque" : "transparent") as GoogleEvent["transparency"],
  };
  const h = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { id: googleEventId(e.uid), ...body, extendedProperties: { private: { orca: "1", h } } };
}

export interface ExistingEvent {
  id: string;
  /** The content hash Orca wrote, if any. */
  h: string | null;
}

export interface SyncPlan {
  /** Events missing from the calendar or changed since they were written. */
  write: GoogleEvent[];
  /** Ids on the calendar that Orca no longer has. */
  remove: string[];
}

export function syncPlan(wanted: readonly GoogleEvent[], existing: readonly ExistingEvent[]): SyncPlan {
  const have = new Map(existing.map((e) => [e.id, e.h]));
  const wantedIds = new Set(wanted.map((e) => e.id));
  return {
    write: wanted.filter((e) => have.get(e.id) !== e.extendedProperties.private.h),
    remove: existing.filter((e) => !wantedIds.has(e.id)).map((e) => e.id),
  };
}

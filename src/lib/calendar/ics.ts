/**
 * The calendar feed (owner, 2026-11-25), pure: a student's exams, due dates, class meetings and
 * review days as an iCalendar file that Google Calendar or Apple Calendar subscribes to. Exams and
 * due dates are all-day events; meetings repeat weekly at their local time (TZID = the student's
 * timezone); review days repeat weekly as all-day events, from `from` on. UIDs are stable, so a
 * feed polled again updates events instead of duplicating them.
 */
import type { ClassMeeting, CourseSchedule, Weekday } from "../data.ts";

export interface FeedCourse {
  id: string;
  name: string;
  short: string;
  schedule: CourseSchedule | null;
}

export interface FeedExam {
  id: string;
  courseId: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface FeedEvent {
  id: string;
  courseId: string | null;
  kind: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface FeedInput {
  courses: readonly FeedCourse[];
  exams: readonly FeedExam[];
  events: readonly FeedEvent[];
  /** The first day the recurring events run from, YYYY-MM-DD (today). */
  from: string;
  /** IANA name; the meetings' times are in it. */
  timezone: string;
  /** When the feed was built (DTSTAMP). */
  now: Date;
}

const BYDAY: Record<Weekday, string> = { 0: "SU", 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA" };

const DAY_MS = 86_400_000;

function utcDate(day: string): Date {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Not a day: ${day}`);
  return new Date(t);
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/** The first day on or after `from` that falls on `weekday`, YYYYMMDD. */
export function firstOnOrAfter(from: string, weekday: Weekday): string {
  const d = utcDate(from);
  const delta = (weekday - d.getUTCDay() + 7) % 7;
  return dayStr(new Date(d.getTime() + delta * DAY_MS));
}

/** The weekdays a course's quick reviews fall on: its setting, else the day before each class. */
export function reviewDays(schedule: CourseSchedule | null): Weekday[] {
  if (!schedule) return [];
  if (schedule.quickDays) return [...new Set(schedule.quickDays)].sort();
  return [...new Set(schedule.meetings.map((m) => ((m.day + 6) % 7) as Weekday))].sort();
}

/** iCalendar text: backslash, comma and semicolon escaped, newlines as \n. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 §3.1). */
export function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.byteLength <= 75) return line;
  const out: string[] = [];
  let start = 0;
  while (start < bytes.byteLength) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.byteLength);
    // Never cut inside a UTF-8 sequence.
    while (end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return out.join("\r\n");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function meetingTime(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  return `${h.padStart(2, "0")}${m.padStart(2, "0")}00`;
}

export function buildIcs(input: FeedInput): string {
  const byId = new Map(input.courses.map((c) => [c.id, c]));
  const ds = stamp(input.now);
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orca//Study calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Orca", "X-WR-TIMEZONE:" + icsText(input.timezone)];
  const event = (uid: string, summary: string, body: string[], description?: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@orca`, `DTSTAMP:${ds}`, `SUMMARY:${icsText(summary)}`, ...body);
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    lines.push("END:VEVENT");
  };
  const allDay = (day: string) => {
    const start = utcDate(day);
    return [`DTSTART;VALUE=DATE:${dayStr(start)}`, `DTEND;VALUE=DATE:${dayStr(new Date(start.getTime() + DAY_MS))}`];
  };

  for (const e of input.exams) {
    const c = byId.get(e.courseId);
    event(`exam-${e.id}`, `${e.title} · ${c?.short ?? "Exam"}`, allDay(e.date), c ? `${c.name}: ${e.title}` : e.title);
  }
  for (const e of input.events) {
    const c = e.courseId ? byId.get(e.courseId) : undefined;
    event(`event-${e.id}`, c ? `${e.title} · ${c.short}` : e.title, allDay(e.date), c ? `${c.name}: ${e.title}` : undefined);
  }
  for (const c of input.courses) {
    const s = c.schedule;
    if (!s) continue;
    s.meetings.forEach((m: ClassMeeting, i) => {
      const first = firstOnOrAfter(input.from, m.day);
      event(`meeting-${c.id}-${i}`, `${c.short} class`, [
        `DTSTART;TZID=${input.timezone}:${first}T${meetingTime(m.start)}`,
        `DTEND;TZID=${input.timezone}:${first}T${meetingTime(m.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[m.day]}`,
      ], c.name);
    });
    for (const d of reviewDays(s)) {
      const first = firstOnOrAfter(input.from, d);
      event(`review-${c.id}-${d}`, `Orca review · ${c.short}`, [`DTSTART;VALUE=DATE:${first}`, `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[d]}`], `${c.name}: quick review day. Open Orca, or ask your AI with the Orca connector.`);
    }
    for (const d of s.deepDays ?? []) {
      const first = firstOnOrAfter(input.from, d);
      event(`dive-${c.id}-${d}`, `Orca dive · ${c.short}`, [`DTSTART;VALUE=DATE:${first}`, `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[d]}`], `${c.name}: dive day.`);
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * The calendar feed (owner, 2026-11-25): a secret per student (`profiles.calendar_feed_token`,
 * server-set) in a link that Google Calendar or Apple Calendar subscribes to. The link answers the
 * student's exams, due dates, class meetings and review days as iCalendar (`src/lib/calendar/ics.ts`).
 * Making a new link replaces the old one; clearing it stops the feed at once.
 */
import { randomBytes } from "node:crypto";
import { type FeedCourse, buildIcs } from "@/lib/calendar/ics";
import { CourseScheduleSchema } from "@/lib/supabase/app-rows";
import type { OrcaSupabase } from "@/lib/supabase/server";

export interface FeedStatus {
  connected: boolean;
  /** The subscription URL, only when just made (the token is shown once, as the connector's link is). */
  url: string | null;
}

export async function feedStatus(db: OrcaSupabase, ownerId: string): Promise<FeedStatus> {
  const { data, error } = await db.from("profiles").select("calendar_feed_token").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the calendar feed: ${error.message}`);
  return { connected: Boolean(data?.calendar_feed_token), url: null };
}

/** A new token (the old one stops working), and the link to subscribe to. */
export async function mintFeed(db: OrcaSupabase, ownerId: string, siteUrl: string): Promise<{ url: string }> {
  const token = randomBytes(24).toString("base64url");
  const { error } = await db.from("profiles").update({ calendar_feed_token: token }).eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't make the calendar feed: ${error.message}`);
  return { url: `${siteUrl.replace(/\/$/, "")}/api/calendar/feed/${token}.ics` };
}

export async function revokeFeed(db: OrcaSupabase, ownerId: string): Promise<void> {
  const { error } = await db.from("profiles").update({ calendar_feed_token: null }).eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't stop the calendar feed: ${error.message}`);
}

/** The feed for a token, or null when no account holds it. Days are the student's (their timezone). */
export async function feedForToken(db: OrcaSupabase, token: string, now = new Date()): Promise<string | null> {
  const { data: profile, error } = await db.from("profiles").select("owner_id, timezone").eq("calendar_feed_token", token).maybeSingle();
  if (error) throw new Error(`Couldn't read the calendar feed: ${error.message}`);
  if (!profile) return null;
  const owner = profile.owner_id;
  const [courses, exams, events] = await Promise.all([
    db.from("courses").select("id, name, short, schedule").eq("owner_id", owner).is("deleted_at", null),
    db.from("exams").select("id, course_id, title, date").eq("owner_id", owner),
    db.from("calendar_events").select("id, course_id, kind, title, date").eq("owner_id", owner),
  ]);
  if (courses.error) throw new Error(`Couldn't read the courses: ${courses.error.message}`);
  if (exams.error) throw new Error(`Couldn't read the exams: ${exams.error.message}`);
  if (events.error) throw new Error(`Couldn't read the calendar: ${events.error.message}`);
  const feedCourses: FeedCourse[] = courses.data.map((c) => {
    const parsed = c.schedule === null ? null : CourseScheduleSchema.safeParse(c.schedule);
    return { id: c.id, name: c.name, short: c.short, schedule: parsed && parsed.success ? parsed.data : null };
  });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return buildIcs({
    courses: feedCourses,
    exams: exams.data.map((e) => ({ id: e.id, courseId: e.course_id, title: e.title, date: e.date })),
    events: events.data.map((e) => ({ id: e.id, courseId: e.course_id, kind: e.kind, title: e.title, date: e.date })),
    from: today,
    timezone: profile.timezone,
    now,
  });
}

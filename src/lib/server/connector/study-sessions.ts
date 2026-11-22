/**
 * The session record (plan `docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md`, Phase 2):
 * sittings the student's Claude logs with log_session. Their minutes count as study on the student's
 * day, and the latest one's bookmark and next steps open the next chat (`course_state.lastSession`)
 * and the cram page. Only the server writes them (`study_sessions`, migration `20261122090000`).
 */
import type { SessionEntry, SessionLine, SessionWork } from "@/lib/connector/mcp";
import { dayKeyIn } from "@/lib/mastery/objective-state";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";

type Row = Database["public"]["Tables"]["study_sessions"]["Row"];

export const sessionLine = (r: Pick<Row, "id" | "at" | "day" | "minutes" | "summary" | "worked" | "bookmark" | "next_steps">): SessionLine => ({
  id: r.id,
  at: r.at,
  day: r.day,
  minutes: r.minutes,
  summary: r.summary,
  worked: (r.worked as unknown as SessionWork[] | null) ?? [],
  bookmark: r.bookmark,
  next: (r.next_steps as unknown as string[] | null) ?? [],
});

const COLUMNS = "id, at, day, minutes, summary, worked, bookmark, next_steps";

export async function logSession(db: OrcaSupabase, ownerId: string, courseId: string, entry: SessionEntry, now: () => Date = () => new Date()): Promise<SessionLine | { error: string }> {
  const { data: course, error } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`Couldn't read the course: ${error.message}`);
  if (!course) return { error: "No such course." };
  if (entry.examId) {
    const { data: exam, error: examError } = await db.from("exams").select("id").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", entry.examId).maybeSingle();
    if (examError) throw new Error(`Couldn't read the exam: ${examError.message}`);
    if (!exam) return { error: "No such exam in this course; use an id from course_state, or leave examId out." };
  }
  const at = now();
  const { data: profile } = await db.from("profiles").select("timezone").eq("owner_id", ownerId).maybeSingle();
  const day = dayKeyIn(profile?.timezone ?? "UTC")(at.toISOString());
  const { data, error: insertError } = await db
    .from("study_sessions")
    .insert({ owner_id: ownerId, course_id: courseId, exam_id: entry.examId ?? null, at: at.toISOString(), day, minutes: entry.minutes, summary: entry.summary, worked: entry.worked as unknown as NonNullable<Json>, bookmark: entry.bookmark ?? null, next_steps: (entry.next ?? []) as unknown as NonNullable<Json> })
    .select(COLUMNS)
    .single();
  if (insertError) throw new Error(`Couldn't save the sitting: ${insertError.message}`);
  return sessionLine(data);
}

/** The course's latest sittings, newest first. */
export async function recentSessions(db: OrcaSupabase, ownerId: string, courseId: string, limit = 5): Promise<SessionLine[]> {
  const { data, error } = await db.from("study_sessions").select(COLUMNS).eq("owner_id", ownerId).eq("course_id", courseId).order("at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Couldn't read the sittings: ${error.message}`);
  return (data ?? []).map(sessionLine);
}

/** Minutes logged on each day (the student's) at or after `since`. */
export async function loggedMinutesByDay(db: OrcaSupabase, ownerId: string, courseId: string, since: string): Promise<Record<string, number>> {
  const { data, error } = await db.from("study_sessions").select("day, minutes").eq("owner_id", ownerId).eq("course_id", courseId).gte("at", since);
  if (error) throw new Error(`Couldn't read the sittings: ${error.message}`);
  const byDay: Record<string, number> = {};
  for (const r of data ?? []) byDay[r.day] = (byDay[r.day] ?? 0) + r.minutes;
  return byDay;
}

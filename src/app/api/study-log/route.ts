import { recentSessions } from "@/lib/server/connector/study-sessions";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The course's session record for the cram page (plan 2026-11-22, Phase 2).
 * GET ?courseId= → { sessions: the latest five sittings, newest first, minutesByDay: minutes logged
 * on each of the student's days over the last 60 }. Read under the student's own session (RLS), so a
 * course that isn't theirs has none.
 */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const courseId = new URL(request.url).searchParams.get("courseId") ?? "";
    if (!UUID.test(courseId)) return reply(400, { error: "courseId is a course id." });
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const [sessions, days] = await Promise.all([recentSessions(db, student.id, courseId), db.from("study_sessions").select("day, minutes, at").eq("owner_id", student.id).eq("course_id", courseId).gte("at", since)]);
    if (days.error) throw new Error(`Couldn't read the sittings: ${days.error.message}`);
    return reply(200, { sessions, sittings: (days.data ?? []).map((r) => ({ day: r.day, minutes: r.minutes, at: r.at })) });
  });
}

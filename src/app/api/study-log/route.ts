import { attemptsFor } from "@/lib/server/connector/problem-attempts";
import { recentSessions } from "@/lib/server/connector/study-sessions";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The course's session record for the cram page (plan 2026-11-22, Phase 2).
 * GET ?courseId=&examId= → { sessions: the latest five sittings, newest first; sittings: each
 * sitting's day and minutes over the last 60 days; attempts: the exam-style problems attempted for
 * that exam's problem types (none without examId) }. Read under the student's own session (RLS), so a
 * course that isn't theirs has none.
 */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const courseId = new URL(request.url).searchParams.get("courseId") ?? "";
    if (!UUID.test(courseId)) return reply(400, { error: "courseId is a course id." });
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const examId = new URL(request.url).searchParams.get("examId");
    if (examId !== null && !UUID.test(examId)) return reply(400, { error: "examId is an exam id." });
    const [sessions, days, attempts] = await Promise.all([
      recentSessions(db, student.id, courseId),
      db.from("study_sessions").select("day, minutes, at").eq("owner_id", student.id).eq("course_id", courseId).gte("at", since),
      examId ? attemptsFor(db, student.id, courseId, examId) : Promise.resolve([]),
    ]);
    if (days.error) throw new Error(`Couldn't read the sittings: ${days.error.message}`);
    return reply(200, { sessions, sittings: (days.data ?? []).map((r) => ({ day: r.day, minutes: r.minutes, at: r.at })), attempts });
  });
}

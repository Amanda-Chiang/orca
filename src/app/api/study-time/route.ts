import { forStudent, reply } from "@/lib/server/student";
import type { StudyTimer } from "@/lib/study-timer";

/**
 * The study time only the server holds (owner, 2026-11-22), for the progress page and the timer:
 * GET → { running: the running study timer or null, timers: finished timers, sittings: what the
 * student's Claude logged per sitting (log_session) as { courseId, day, minutes } }. The rest of the
 * record (finished sessions in Orca, Claude's connector evidence) is already in the store. Deleted
 * courses' time leaves with them.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const [courses, timers, sittings] = await Promise.all([
      db.from("courses").select("id").eq("owner_id", student.id).is("deleted_at", null),
      db.from("study_timers").select("id, course_id, exam_id, started_at, ended_at").eq("owner_id", student.id).order("started_at").limit(5000),
      db.from("study_sessions").select("course_id, day, minutes").eq("owner_id", student.id).limit(5000),
    ]);
    for (const r of [courses, timers, sittings]) if (r.error) throw new Error(`Couldn't read your study time: ${r.error.message}`);
    const live = new Set((courses.data ?? []).map((c) => c.id));
    const all: StudyTimer[] = (timers.data ?? []).filter((t) => live.has(t.course_id)).map((t) => ({ id: t.id, courseId: t.course_id, examId: t.exam_id, startedAt: t.started_at, endedAt: t.ended_at }));
    return reply(200, {
      running: all.find((t) => t.endedAt === null) ?? null,
      timers: all.filter((t) => t.endedAt !== null),
      sittings: (sittings.data ?? []).filter((s) => live.has(s.course_id)).map((s) => ({ courseId: s.course_id, day: s.day, minutes: s.minutes })),
    });
  });
}

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";
import { timerEnd, type StudyTimer } from "@/lib/study-timer";

/**
 * The study timer (owner, 2026-11-22). POST { action: "start", courseId, examId? } starts one (409 when
 * one is already running); { action: "stop" } stops the running one and records its time (a timer
 * under a minute is dropped: nothing to count); { action: "discard" } drops the running one unrecorded.
 * Answers { running: StudyTimer | null, recorded?: StudyTimer }. Only this route writes `study_timers`.
 */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, course_id, exam_id, started_at, ended_at";

const timerOf = (r: { id: string; course_id: string; exam_id: string | null; started_at: string; ended_at: string | null }): StudyTimer => ({
  id: r.id,
  courseId: r.course_id,
  examId: r.exam_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const body = (await request.json().catch(() => null)) as { action?: unknown; courseId?: unknown; examId?: unknown } | null;
    const action = body?.action;
    if (action !== "start" && action !== "stop" && action !== "discard") return reply(400, { error: 'action is "start", "stop" or "discard".' });
    const verdict = await rateLimit(db, student.id, "timer");
    if (!verdict.ok) return tooManyRequests(verdict);

    const { data: running, error } = await db.from("study_timers").select(COLUMNS).eq("owner_id", student.id).is("ended_at", null).maybeSingle();
    if (error) throw new Error(`Couldn't read the timer: ${error.message}`);

    if (action === "start") {
      if (running) return reply(409, { error: "A study session is already running. Stop it first.", running: timerOf(running) });
      const courseId = typeof body?.courseId === "string" ? body.courseId : "";
      if (!UUID.test(courseId) || !(await ownsCourse(db, student.id, courseId))) return reply(400, { error: "Pick one of your courses." });
      const examId = body?.examId === undefined || body?.examId === null ? null : String(body.examId);
      if (examId !== null) {
        if (!UUID.test(examId)) return reply(400, { error: "examId is an exam id." });
        const { data: exam, error: examError } = await db.from("exams").select("id").eq("owner_id", student.id).eq("course_id", courseId).eq("id", examId).maybeSingle();
        if (examError) throw new Error(`Couldn't read the exam: ${examError.message}`);
        if (!exam) return reply(400, { error: "That exam isn't in this course." });
      }
      const { data, error: insertError } = await db.from("study_timers").insert({ owner_id: student.id, course_id: courseId, exam_id: examId }).select(COLUMNS).single();
      // Two starts at once: the one-running index refuses the second.
      if (insertError?.code === "23505") return reply(409, { error: "A study session is already running. Stop it first." });
      if (insertError) throw new Error(`Couldn't start the timer: ${insertError.message}`);
      return reply(200, { running: timerOf(data) });
    }

    if (!running) return reply(200, { running: null });
    const end = timerEnd(running.started_at, new Date());
    if (action === "discard" || end.getTime() - Date.parse(running.started_at) < 60_000) {
      const { error: deleteError } = await db.from("study_timers").delete().eq("owner_id", student.id).eq("id", running.id);
      if (deleteError) throw new Error(`Couldn't drop the timer: ${deleteError.message}`);
      return reply(200, { running: null });
    }
    const { data, error: updateError } = await db.from("study_timers").update({ ended_at: end.toISOString() }).eq("owner_id", student.id).eq("id", running.id).select(COLUMNS).single();
    if (updateError) throw new Error(`Couldn't stop the timer: ${updateError.message}`);
    return reply(200, { running: null, recorded: timerOf(data) });
  });
}

/**
 * Problem attempts (plan `docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md`, Phase 3):
 * exam-style problems the student attempted with their Claude (log_problem), by problem type.
 * Readiness is derived from them (`src/lib/course/readiness.ts`). Only the server writes them
 * (`problem_attempts`, migration `20261122100000`).
 */
import { examReadiness, type AttemptOutcome, type ExamReadiness, type ProblemAttempt } from "@/lib/course/readiness";
import type { ExamScope } from "@/lib/data";
import type { OrcaSupabase } from "@/lib/supabase/server";

const COLUMNS = "type_id, at, outcome, cold, minutes, error_note, mock_material_id, points, out_of";

type Row = { type_id: string; at: string; outcome: string; cold: boolean; minutes: number | null; error_note: string | null; mock_material_id: string | null; points: number | null; out_of: number | null };
const attemptOf = (r: Row): ProblemAttempt => ({ typeId: r.type_id, at: r.at, outcome: r.outcome as AttemptOutcome, cold: r.cold, minutes: r.minutes, errorNote: r.error_note, mockMaterialId: r.mock_material_id, points: r.points, outOf: r.out_of });

/** The attempts on one exam's problem types, oldest first. */
export async function attemptsFor(db: OrcaSupabase, ownerId: string, courseId: string, examId: string): Promise<ProblemAttempt[]> {
  const { data, error } = await db.from("problem_attempts").select(COLUMNS).eq("owner_id", ownerId).eq("course_id", courseId).eq("exam_id", examId).order("at");
  if (error) throw new Error(`Couldn't read the problem attempts: ${error.message}`);
  return (data ?? []).map(attemptOf);
}

export async function logProblem(db: OrcaSupabase, ownerId: string, courseId: string, examId: string, attempt: Omit<ProblemAttempt, "at">, now: () => Date = () => new Date()): Promise<{ recorded: true; typeId: string; state: string; ready: number; total: number } | { error: string }> {
  const { data: exam, error } = await db.from("exams").select("id, scope, courses!inner(deleted_at)").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", examId).is("courses.deleted_at", null).maybeSingle();
  if (error) throw new Error(`Couldn't read the exam: ${error.message}`);
  if (!exam) return { error: "No such exam in this course; use ids from course_state." };
  const scope = exam.scope as unknown as ExamScope | null;
  const types = scope?.problemTypes ?? [];
  if (!types.some((t) => t.id === attempt.typeId)) return { error: `"${attempt.typeId}" isn't a kind of problem on this exam's map. Its kinds: ${types.map((t) => t.id).join(", ") || "none yet (write scope.problemTypes with set_exam first)"}.` };
  // A mock's problem comes from a held-back exam of this course.
  if (attempt.mockMaterialId) {
    const { data: material, error: materialError } = await db.from("materials").select("id, held_back").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", attempt.mockMaterialId).maybeSingle();
    if (materialError) throw new Error(`Couldn't read the material: ${materialError.message}`);
    if (!material?.held_back) return { error: "mockMaterialId must be a held-back exam from course_state's vault." };
  }
  const { error: insertError } = await db.from("problem_attempts").insert({
    owner_id: ownerId,
    course_id: courseId,
    exam_id: examId,
    type_id: attempt.typeId,
    at: now().toISOString(),
    outcome: attempt.outcome,
    cold: attempt.cold,
    minutes: attempt.minutes ?? null,
    error_note: attempt.errorNote ?? null,
    mock_material_id: attempt.mockMaterialId ?? null,
    points: attempt.points ?? null,
    out_of: attempt.outOf ?? null,
  });
  if (insertError) throw new Error(`Couldn't save the attempt: ${insertError.message}`);
  const readiness = examReadiness(types, await attemptsFor(db, ownerId, courseId, examId));
  return { recorded: true, typeId: attempt.typeId, state: readiness.types.find((t) => t.id === attempt.typeId)!.state, ready: readiness.ready, total: readiness.total };
}

/** Readiness for an exam with a map; null without one. */
export async function readinessFor(db: OrcaSupabase, ownerId: string, courseId: string, exam: { id: string; scope?: ExamScope | null }): Promise<{ readiness: ExamReadiness; attempts: ProblemAttempt[] } | null> {
  const types = exam.scope?.problemTypes ?? [];
  if (!types.length) return null;
  const attempts = await attemptsFor(db, ownerId, courseId, exam.id);
  return { readiness: examReadiness(types, attempts), attempts };
}

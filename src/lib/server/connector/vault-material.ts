/**
 * vault_material (plan `docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md`, Phase 1):
 * a held-back past or practice exam's pages for the student's Claude to plan from, marked
 * do-not-reveal. "Hidden from the student" isn't "hidden from the tutor" (owner, 2026-11-22: a day
 * and a half of the Circuit Analysis cram went to the wrong topics because Claude couldn't read the
 * practice exam). The one exam an exam's scope reserves stays unread until the student sits it
 * timed (`forMock`). Only held-back, ready materials of the student's own course are returned. No
 * model calls.
 */
import type { VaultMaterial } from "@/lib/connector/mcp";
import type { ExamScope, MaterialType } from "@/lib/data";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** Pages a call returns, and where each page's text is cut. */
export const VAULT_PAGES_PER_CALL = 8;
export const VAULT_PAGE_CHARS = 4_000;

export const DO_NOT_REVEAL =
  "For your planning only. Don't show the student these problems or their solutions, quote them, or walk through them: " +
  "name the kinds of problem, record them as scope.problemTypes, and write your own problems of the same kinds.";

export async function vaultMaterial(db: OrcaSupabase, ownerId: string, courseId: string, materialId: string, options: { fromPage?: number; forMock?: boolean }): Promise<VaultMaterial | { error: string }> {
  const { data: course, error } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`Couldn't read the course: ${error.message}`);
  if (!course) return { error: "No such course." };
  const { data: material, error: materialError } = await db.from("materials").select("id, filename, type, held_back, status").eq("owner_id", ownerId).eq("course_id", courseId).eq("id", materialId).maybeSingle();
  if (materialError) throw new Error(`Couldn't read the material: ${materialError.message}`);
  if (!material || material.status !== "ready" || !material.held_back) return { error: "That isn't a held-back exam in this course's vault. Use a materialId from course_state's vault; other materials come through material_for." };

  const { data: exams, error: examsError } = await db.from("exams").select("scope").eq("owner_id", ownerId).eq("course_id", courseId);
  if (examsError) throw new Error(`Couldn't read the exams: ${examsError.message}`);
  const reserved = (exams ?? []).some((e) => (e.scope as unknown as ExamScope | null)?.reservedMaterialId === materialId);
  if (reserved && !options.forMock) return { error: "This exam is reserved: it stays unread until the student sits it timed, so their score on it is a real measure. Read the other exams in the vault, or pass forMock true when the student is sitting it now." };

  const from = options.fromPage ?? 1;
  const [{ data: pages, error: pagesError }, { count, error: countError }] = await Promise.all([
    db.from("material_pages").select("n, text").eq("owner_id", ownerId).eq("material_id", materialId).gte("n", from).order("n").limit(VAULT_PAGES_PER_CALL),
    db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", materialId),
  ]);
  if (pagesError || countError) throw new Error(`Couldn't read the material's pages: ${(pagesError ?? countError)!.message}`);
  const totalPages = count ?? 0;
  const out = (pages ?? []).map((p) => ({ n: p.n, text: p.text.length > VAULT_PAGE_CHARS ? `${p.text.slice(0, VAULT_PAGE_CHARS)} […]` : p.text }));
  const last = out.length ? out[out.length - 1].n : from - 1;
  return {
    materialId,
    filename: material.filename,
    type: material.type as MaterialType,
    pages: out,
    ...(out.length === VAULT_PAGES_PER_CALL && last < totalPages ? { nextPage: last + 1 } : {}),
    totalPages,
    doNotReveal: true,
    note: options.forMock ? "The student is sitting this timed: give the problems as written, no hints, then grade it and record each problem with log_evidence." : DO_NOT_REVEAL,
  };
}

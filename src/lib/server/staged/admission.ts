import type { OrcaSupabase } from "@/lib/supabase/server";
import { type Admission, type AdmissionItem, PipelineDeferred } from "@/lib/jobs/staged/types";
import { pipelineRpc } from "./db";

export const ADMISSIONS_CLOSED = "Orca isn't taking new material for a few minutes while uploads are switched over. Try again shortly.";

/**
 * Admits items to the staged pipeline. With the flag on but the database gate off (a rollback in
 * progress, docs/UPLOAD-PIPELINE.md), new material is refused with a plain retry-later message, never
 * sent down the old path; routes answer it as 429 (`forStudent`), the connector as the tool's error.
 */
export async function admit(db: OrcaSupabase, ownerId: string, courseId: string, batchId: string, items: AdmissionItem[], source = "browser"): Promise<Admission> {
  const { data: gate, error } = await db.from("pipeline_control").select("enabled").eq("id", true).maybeSingle();
  if (error) throw new Error(`Couldn't read the upload gate: ${error.message}`);
  if (!gate?.enabled) throw new PipelineDeferred("admissions-closed", ADMISSIONS_CLOSED);
  return pipelineRpc(db, "admit", { ownerId, courseId, batchId, items, source });
}
export async function singleton(db: OrcaSupabase, ownerId: string, courseId: string, itemId: string, name: string, source = "browser", metadata: Record<string, unknown> = {}) {
  return admit(db, ownerId, courseId, itemId, [{ id: itemId, name, metadata }], source);
}

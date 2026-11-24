import type { RunDeps, WriteInput, WriteTarget } from "@/lib/pipeline/run";
import { promptKey } from "@/lib/pipeline/questions";
import { questionToRow } from "@/lib/supabase/app-rows";
import type { QuizQuestion } from "@/lib/data";
import type { OrcaSupabase } from "@/lib/supabase/server";
import type { StageJob } from "@/lib/jobs/staged/types";
import { PipelineDeferred } from "@/lib/jobs/staged/types";
import { pipelineRpc } from "./db";

export interface WritingLease { ownerId: string; runId: string; token: string; taskId?: string; policy: "upload" | "top-up" | "deep-review" }
export function coordinateWriting(db: OrcaSupabase, lease: WritingLease, desired?: ReadonlyMap<string, number>): NonNullable<RunDeps["claimWriting"]> {
  return async (input: WriteInput): Promise<WriteTarget[]> => {
    try {
      const claimed = await pipelineRpc<Array<{ objectiveId: string; need: number }>>(db, "claim_questions", { ...lease, deep: !!input.deep, targets: input.targets.map((t) => ({ objectiveId: t.objective.id, need: t.need, desired: desired?.get(t.objective.id) ?? t.existing.length + t.need })) });
      const needed = new Map(claimed.map((t) => [t.objectiveId, t.need]));
      return input.targets.flatMap((t) => { const need = needed.get(t.objective.id); return need ? [{ ...t, need }] : []; });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "55P03" || error.code === "40001")) throw new PipelineDeferred("question-stock", "Another writer changed this objective. Resuming with fresh question stock.");
      throw error;
    }
  };
}
/**
 * Reserve stock again for questions written by an earlier attempt of this task. The claims die with
 * a failed attempt (pipeline_fail), and the commit only honours claims under the live token, so a
 * retry resumed from the `written` checkpoint must claim before it commits, or every paid question
 * would be discarded as an expired reservation.
 */
export async function reclaimWriting(db: OrcaSupabase, lease: WritingLease, targets: ReadonlyArray<{ objectiveId: string; desired: number }>): Promise<void> {
  if (!targets.length) return;
  try {
    await pipelineRpc(db, "claim_questions", { ...lease, deep: false, targets: targets.map((t) => ({ objectiveId: t.objectiveId, need: t.desired, desired: t.desired })) });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "55P03" || error.code === "40001")) throw new PipelineDeferred("question-stock", "Another writer changed this objective. Resuming with fresh question stock.");
    throw error;
  }
}
export function questionRows(bank: Readonly<Record<string, QuizQuestion[]>>) {
  return Object.entries(bank).flatMap(([topicId, qs]) => qs.map((q, index) => ({ ...questionToRow(q, topicId, index), prompt_key: promptKey(q.prompt) })));
}
export function writingLease(job: StageJob, runId: string): WritingLease { return { ...job, runId, policy: "upload" }; }

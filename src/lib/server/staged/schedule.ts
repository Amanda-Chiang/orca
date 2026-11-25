import { recoverIngestion } from "./recover";
import { after } from "next/server";
import { configure, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import type { stagedUploadTask } from "@/trigger/jobs";
import type { OrcaSupabase } from "@/lib/supabase/server";
import type { StageJob } from "@/lib/jobs/staged/types";
import { pipelineRpc } from "./db";

/** The students with an upload loop running in this server (inline jobs). */
const LOOPS = new Map<string, { again: boolean }>();
/** Failed claims in a row before a loop gives up. */
const CLAIM_TRIES = 5;

/** Claims are durable outbox entries. A failed handoff is reclaimed after its lease, not lost. */
export async function scheduleStages(db: OrcaSupabase, ownerId: string, mode: "after-response" | "now" = "after-response") {
  await recoverIngestion(db, ownerId);
  if (process.env.ORCA_JOBS === "trigger") {
    configure({ previewBranch: "" });
    for (let i = 0; i < 8; i++) {
      const job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId });
      if (!job) break;
      const key = await idempotencyKeys.create(`upload-stage:${job.taskId}:${job.token}`, { scope: "global" });
      await tasks.trigger<typeof stagedUploadTask>("staged-upload", job, { idempotencyKey: key });
    }
    return;
  }
  // One loop per student in this server (2026-11-24): every upload, Try again, Stop, Delete and each
  // open page's check used to start another, and a dozen loops at once took every connection the
  // Supabase API had. A request while one runs only asks it to look again before it ends.
  const loop = LOOPS.get(ownerId);
  if (loop) { loop.again = true; return; }
  const state = { again: false };
  LOOPS.set(ownerId, state);
  const work = async () => {
    try {
      const { runPipelineStage } = await import("./run");
      // Each pass runs up to ~4 minutes; a request to look again that arrives while a pass is
      // finishing its last tasks starts one more pass (checked with no await before the loop is
      // dropped from LOOPS, so no request falls between the two).
      do {
        state.again = false;
        const until = Date.now() + 230_000;
        const active = new Set<Promise<void>>();
        let failures = 0;
        while (Date.now() < until) {
          while (active.size < 4) {
            let job: StageJob | null;
            try {
              job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId });
              failures = 0;
            } catch (error) {
              // The database didn't answer (e.g. its connections are all taken): wait longer each
              // time, and give up after a few; the sweep and the pages' checks start it again later.
              if (++failures >= CLAIM_TRIES) { console.error(`Upload loop for ${ownerId} stopped: ${error instanceof Error ? error.message : String(error)}`); await Promise.all(active); return; }
              await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * 2 ** (failures - 1))));
              break;
            }
            if (!job) break;
            const running = runPipelineStage(job).finally(() => { active.delete(running); });
            active.add(running);
          }
          if (!active.size) {
            if (failures > 0) continue; // backed off: try the claim again
            if (state.again) { state.again = false; continue; } // asked to look again while it ran
            break;
          }
          await Promise.race(active);
        }
        await Promise.all(active);
      } while (state.again);
    } finally {
      LOOPS.delete(ownerId);
    }
  };
  if (mode === "after-response") after(work); else await work();
}

import { checkRuns } from "@/lib/server/jobs/start";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → check the signed-in student's runs. Called by a page following a run that has been going
 * longer than its job could take: the server marks such runs failed by its own clock ("Orca's job
 * stopped without finishing…"), never on the browser's say-so, and starts their next queued job.
 * 200 { started: runId | null }.
 */
export const runtime = "nodejs";
// With ORCA_JOBS=inline a queued job behind the dead one runs after the response, within this budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    // Each check can claim and hand off queued phases, so it is bounded per student.
    const rate = await rateLimit(db, student.id, "runsCheck");
    if (!rate.ok) return tooManyRequests(rate);
    const next = await checkRuns(db, student.id);
    return reply(200, { started: next?.job.runId ?? null });
  });
}

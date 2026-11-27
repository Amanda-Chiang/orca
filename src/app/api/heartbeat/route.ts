import { after } from "next/server";
import { syncCalendarIfStale } from "@/lib/server/google";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → 204: the browser's "still here", sent at most once every 5 minutes while a signed-in tab
 * is open (src/components/layout/Heartbeat.tsx). Sets `profiles.last_active_at` for the verified
 * user, which the admin view shows as "last active", and marks today in `activity_days`
 * (`touch_activity`, 2026-11-25), from which the admin view sees who dropped off and who came back.
 * Nothing waits on it; a 429 is harmless. After answering, it keeps a connected Google Calendar in
 * sync (at most every 30 minutes; `syncCalendarIfStale`, 2026-11-27).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const verdict = await rateLimit(db, student.id, "heartbeat");
    if (!verdict.ok) return tooManyRequests(verdict);
    const { error } = await db.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("owner_id", student.id);
    if (error) return reply(500, { error: "Orca couldn't record the heartbeat." });
    const marked = await db.rpc("touch_activity", { p_owner: student.id });
    if (marked.error) return reply(500, { error: "Orca couldn't record the heartbeat." });
    after(() => syncCalendarIfStale(db, student.id));
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}

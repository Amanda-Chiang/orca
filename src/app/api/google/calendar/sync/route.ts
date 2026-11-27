import { GoogleError, syncCalendar } from "@/lib/server/google";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → { written, removed, total, syncedAt }: brings the Orca calendar in Google Calendar in line
 * now (Settings → Sync now, 2026-11-27). It also syncs by itself from the heartbeat, at most every
 * 30 minutes while Orca is open. 409 when Calendar isn't connected (or Google dropped the access).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const rate = await rateLimit(db, student.id, "googleSync");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      const result = await syncCalendar(db, student.id);
      return reply(200, { ...result, syncedAt: new Date().toISOString() });
    } catch (e) {
      if (e instanceof GoogleError) return reply(e.status, { error: e.message, reconnect: e.reconnect });
      throw e;
    }
  });
}

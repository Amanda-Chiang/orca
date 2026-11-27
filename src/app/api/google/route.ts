import { z } from "zod";
import { disconnectGoogle, googleStatus } from "@/lib/server/google";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's Google connection (Settings → Connections, 2026-11-27).
 * GET → GoogleStatus (configured, pickerReady, email, calendar, drive, needsReconnect).
 * DELETE { removeCalendar } → { disconnected: true }: revokes Orca's access at Google, and deletes
 * the Orca calendar there when asked. Connecting is GET /api/google/connect.
 */
export const runtime = "nodejs";

const Body = z.object({ removeCalendar: z.boolean().optional() }).nullable();

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await googleStatus(db, student.id)));
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    await disconnectGoogle(db, student.id, { removeCalendar: parsed.success ? (parsed.data?.removeCalendar ?? false) : false });
    return reply(200, { disconnected: true });
  });
}

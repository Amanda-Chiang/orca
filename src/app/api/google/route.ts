import { disconnectGoogle, googleStatus } from "@/lib/server/google";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's Google connection (Settings → Connections, 2026-11-27).
 * GET → GoogleStatus (configured, pickerReady, email, calendar, drive, needsReconnect).
 * DELETE → { disconnected: true }: revokes Orca's access at Google and forgets the connection.
 * Connecting is GET /api/google/connect.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await googleStatus(db, student.id)));
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    await disconnectGoogle(db, student.id);
    return reply(200, { disconnected: true });
  });
}

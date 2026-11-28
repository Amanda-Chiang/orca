import { googleConfig, GoogleError, googleEvents, googleStatus } from "@/lib/server/google";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → { connected, events }: the student's Google Calendar events
 * for the days Orca's calendar shows (`to` exclusive, at most 45 days), read from Google now and not
 * stored (owner, 2026-11-28: Calendar is read only). Days are padded by one each side for time
 * zones; the page places each event on the student's local day (`googleEntries`). Without Calendar
 * connected: `{ connected: false, events: [] }`. 409 with `reconnect` when Google dropped the access.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 45;

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_DAYS * 86_400_000) {
      return reply(400, { error: `from and to are days (YYYY-MM-DD), to after from, at most ${MAX_DAYS} days apart.` });
    }
    if (!googleConfig() || !(await googleStatus(db, student.id)).calendar.connected) return reply(200, { connected: false, events: [] });
    const rate = await rateLimit(db, student.id, "googleEvents");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      const events = await googleEvents(db, student.id, new Date(start - 86_400_000).toISOString(), new Date(end + 86_400_000).toISOString());
      return reply(200, { connected: true, events });
    } catch (e) {
      if (e instanceof GoogleError) return reply(e.status, { error: e.message, reconnect: e.reconnect });
      throw e;
    }
  });
}

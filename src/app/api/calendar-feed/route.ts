import { feedStatus, mintFeed, revokeFeed } from "@/lib/server/calendar-feed";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's calendar feed (Settings → Calendar, 2026-11-25).
 * GET → { connected }. POST → 201 { url }: a new subscription link (the old one stops working; the
 * link is shown once). DELETE → { disconnected: true }.
 */
export const runtime = "nodejs";

function siteUrl(request: Request): string {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await feedStatus(db, student.id)));
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const rate = await rateLimit(db, student.id, "calendarFeed");
    if (!rate.ok) return tooManyRequests(rate);
    return reply(201, await mintFeed(db, student.id, siteUrl(request)));
  });
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    await revokeFeed(db, student.id);
    return reply(200, { disconnected: true });
  });
}

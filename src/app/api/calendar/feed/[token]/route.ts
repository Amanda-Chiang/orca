import { SupabaseNotConfiguredError } from "@/lib/supabase/env";
import { adminClient } from "@/lib/supabase/server";
import { feedForToken } from "@/lib/server/calendar-feed";

/**
 * GET /api/calendar/feed/<token>.ics → the student's calendar as iCalendar (2026-11-25). The token
 * is the only credential (as the connector's link is): a calendar app polls it with no sign-in.
 * An unknown token answers 404 with no body, so the route doesn't say what it is.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const raw = (await ctx.params).token;
  const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return new Response(null, { status: 404 });
  let ics: string | null;
  try {
    ics = await feedForToken(adminClient(), token);
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return new Response(null, { status: 503 });
    throw e;
  }
  if (ics === null) return new Response(null, { status: 404 });
  return new Response(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="orca.ics"',
      "cache-control": "private, max-age=300",
    },
  });
}

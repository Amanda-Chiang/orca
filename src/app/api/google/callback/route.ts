import { NextResponse } from "next/server";
import { readOAuthCookie, safeNext, withOutcome } from "@/lib/google/oauth";
import { GoogleError, finishConsent, redirectUri, syncCalendar } from "@/lib/server/google";
import { forStudent } from "@/lib/server/student";

/**
 * Google's redirect after the consent screen (2026-11-27): checks the state against the cookie
 * `/api/google/connect` set (same student, same request), trades the code for tokens, saves the
 * refresh token encrypted, and for Calendar makes and fills the Orca calendar at once. Then back to
 * the page the student came from, with `?google=connected|denied|error|reconnect`.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE = "orca_google_oauth";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const url = new URL(request.url);
    const cookie = readOAuthCookie(request.headers.get("cookie")?.match(/(?:^|;\s*)orca_google_oauth=([^;]+)/)?.[1]);
    const next = cookie?.next ?? safeNext(null);
    const done = (outcome: string) => {
      const res = NextResponse.redirect(new URL(withOutcome(next, outcome, cookie?.feature), url.origin), 303);
      res.cookies.set(COOKIE, "", { path: "/api/google", maxAge: 0 });
      return res;
    };
    if (!cookie || cookie.owner !== student.id || url.searchParams.get("state") !== cookie.state) return done("error");
    if (url.searchParams.get("error")) return done("denied");
    const code = url.searchParams.get("code");
    if (!code) return done("error");
    try {
      const { features } = await finishConsent(db, student.id, code, cookie.verifier, redirectUri(request));
      // A student can untick a permission on Google's screen; then the feature they asked for isn't granted.
      if (!features.includes(cookie.feature)) return done("denied");
      if (cookie.feature === "calendar") {
        try {
          await syncCalendar(db, student.id);
        } catch {
          // Connected; the error is on the connection and Settings offers Sync now.
        }
      }
      return done("connected");
    } catch (e) {
      if (e instanceof GoogleError) return done(e.reconnect ? "reconnect" : "error");
      throw e;
    }
  });
}

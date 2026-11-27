import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { consentUrl, isFeature, safeNext, withOutcome, writeOAuthCookie } from "@/lib/google/oauth";
import { googleConfig, redirectUri } from "@/lib/server/google";
import { rateLimit } from "@/lib/server/rate-limit";
import { forStudent } from "@/lib/server/student";

/**
 * GET ?feature=calendar|drive&next=/path → a redirect to Google's consent screen (2026-11-27). A
 * browser navigation, not a fetch: the state, the PKCE verifier, the feature, where to come back to
 * and the student's id go in a short-lived httpOnly cookie that `/api/google/callback` checks.
 */
export const runtime = "nodejs";

const COOKIE = "orca_google_oauth";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const url = new URL(request.url);
    const next = safeNext(url.searchParams.get("next"));
    const back = (outcome: string) => NextResponse.redirect(new URL(withOutcome(next, outcome), url.origin), 303);
    const feature = url.searchParams.get("feature");
    if (!isFeature(feature)) return back("error");
    const config = googleConfig();
    if (!config) return back("unconfigured");
    const rate = await rateLimit(db, student.id, "googleConnect");
    if (!rate.ok) return back("busy");
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const { data } = await db.from("google_connections").select("google_email").eq("owner_id", student.id).maybeSingle();
    const res = NextResponse.redirect(consentUrl({ clientId: config.clientId, redirectUri: redirectUri(request), feature, state, codeChallenge: challenge, loginHint: data?.google_email }), 303);
    res.cookies.set(COOKIE, writeOAuthCookie({ state, verifier, feature, next, owner: student.id }), {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/api/google",
      maxAge: 600,
    });
    return res;
  });
}

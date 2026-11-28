/**
 * Google sign-in for Calendar and Drive (2026-11-27), pure: the scopes each feature asks for, the
 * consent-screen URL, and the checks on what comes back. Server code is `src/lib/server/google.ts`.
 *
 * Each feature asks only for its own scopes (incremental authorization), so a student who only picks
 * Drive files never sees a calendar permission. Calendar is read only (owner, 2026-11-28: Orca reads
 * the student's calendars, it doesn't write one): `calendar.events.readonly` for the events and
 * `calendar.calendarlist.readonly` to find the calendars they're on. Drive is `drive.file`: only the
 * files the student picks in Google's picker (a non-sensitive scope).
 */
export type GoogleFeature = "calendar" | "drive";

export const GOOGLE_SCOPES: Record<GoogleFeature, readonly string[]> = {
  calendar: ["https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
  drive: ["https://www.googleapis.com/auth/drive.file"],
};

/** Asked with every feature, to show which Google account is connected. */
export const IDENTITY_SCOPES = ["openid", "email"];

export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export function isFeature(value: unknown): value is GoogleFeature {
  return value === "calendar" || value === "drive";
}

/** Which features a granted scope list covers (every scope a feature needs). */
export function grantedFeatures(scopes: readonly string[]): GoogleFeature[] {
  return (Object.keys(GOOGLE_SCOPES) as GoogleFeature[]).filter((f) => GOOGLE_SCOPES[f].every((s) => scopes.includes(s)));
}

export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  feature: GoogleFeature;
  state: string;
  /** PKCE S256 challenge of the verifier kept in the student's cookie. */
  codeChallenge: string;
  /** The Google account already connected, so the chooser starts on it. */
  loginHint?: string | null;
}

export function consentUrl(req: ConsentRequest): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", req.clientId);
  url.searchParams.set("redirect_uri", req.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...IDENTITY_SCOPES, ...GOOGLE_SCOPES[req.feature]].join(" "));
  // A refresh token every time, so a reconnect after Google dropped one always works.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", req.state);
  url.searchParams.set("code_challenge", req.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (req.loginHint) url.searchParams.set("login_hint", req.loginHint);
  return url.toString();
}

/**
 * Where to send the student after Google: a path on this site only (never another origin, so the
 * callback can't be used as an open redirect). Anything else goes to Settings → Connections.
 */
export function safeNext(next: unknown): string {
  const fallback = "/settings?section=connections";
  if (typeof next !== "string" || next.length > 500) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  if (next.startsWith("/api/")) return fallback;
  return next;
}

/** `next` with `google=<outcome>` added (and the feature), for the page to say what happened. */
export function withOutcome(next: string, outcome: string, feature?: GoogleFeature): string {
  const url = new URL(next, "https://orca.invalid");
  url.searchParams.set("google", outcome);
  if (feature) url.searchParams.set("googleFeature", feature);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The email in a Google ID token's payload (from Google's token endpoint over TLS, so unsigned reading is enough). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** The state cookie's content: what the callback checks against Google's answer. */
export interface OAuthCookie {
  state: string;
  verifier: string;
  feature: GoogleFeature;
  next: string;
  owner: string;
}

export function readOAuthCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    if (typeof v.state !== "string" || typeof v.verifier !== "string" || !isFeature(v.feature) || typeof v.owner !== "string") return null;
    return { state: v.state, verifier: v.verifier, feature: v.feature, next: safeNext(v.next), owner: v.owner };
  } catch {
    return null;
  }
}

export function writeOAuthCookie(c: OAuthCookie): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

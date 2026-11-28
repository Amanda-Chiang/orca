import assert from "node:assert/strict";
import { test } from "node:test";
import { fromGoogleEvent, googleEntries } from "../../src/lib/google/events.ts";
import { GOOGLE_SCOPES, consentUrl, emailFromIdToken, grantedFeatures, readOAuthCookie, safeNext, withOutcome, writeOAuthCookie } from "../../src/lib/google/oauth.ts";

test("each feature asks only for its own narrow scope, offline, with PKCE", () => {
  const url = new URL(consentUrl({ clientId: "cid", redirectUri: "https://orca.test/api/google/callback", feature: "drive", state: "s", codeChallenge: "c" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const scopes = url.searchParams.get("scope")!.split(" ");
  assert.deepEqual(scopes, ["openid", "email", ...GOOGLE_SCOPES.drive]);
  for (const s of GOOGLE_SCOPES.calendar) assert.ok(!scopes.includes(s));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(grantedFeatures(["openid", ...GOOGLE_SCOPES.calendar]), ["calendar"]);
  // Calendar needs both of its scopes: one alone (a box unticked on Google's screen) isn't Calendar.
  assert.deepEqual(grantedFeatures(["openid", GOOGLE_SCOPES.calendar[0]]), []);
  assert.ok(GOOGLE_SCOPES.calendar.every((s) => s.endsWith(".readonly")), "Calendar is read only");
});

test("the callback only sends the student back to a path on this site", () => {
  assert.equal(safeNext("/add-material?course=ds"), "/add-material?course=ds");
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "/api/google/connect", "javascript:alert(1)", null, "/x\r\nSet-Cookie: a"]) {
    assert.equal(safeNext(bad), "/settings?section=connections", String(bad));
  }
  assert.equal(withOutcome("/settings?section=connections", "connected", "calendar"), "/settings?section=connections&google=connected&googleFeature=calendar");
});

test("the state cookie round-trips and rejects anything malformed", () => {
  const c = { state: "st", verifier: "v", feature: "calendar" as const, next: "/settings", owner: "u1" };
  assert.deepEqual(readOAuthCookie(writeOAuthCookie(c)), c);
  assert.equal(readOAuthCookie(undefined), null);
  assert.equal(readOAuthCookie("not-json"), null);
  assert.equal(readOAuthCookie(writeOAuthCookie({ ...c, feature: "gmail" as never })), null);
  assert.equal(readOAuthCookie(writeOAuthCookie({ ...c, next: "https://evil.test" }))!.next, "/settings?section=connections");
});

test("the ID token's email is read; junk gives null", () => {
  const token = `x.${Buffer.from(JSON.stringify({ email: "s@example.edu" })).toString("base64url")}.y`;
  assert.equal(emailFromIdToken(token), "s@example.edu");
  assert.equal(emailFromIdToken("nope"), null);
  assert.equal(emailFromIdToken(undefined), null);
});

test("Google's events land on the student's local days, all-day ones on every day they cover", () => {
  const raw = [
    { id: "a", summary: "COMS 3134 Lecture", start: { dateTime: "2026-12-01T14:10:00Z" }, end: { dateTime: "2026-12-01T15:25:00Z" } },
    { id: "b", summary: "Trip", start: { date: "2026-12-02" }, end: { date: "2026-12-04" } },
    { id: "c", status: "cancelled", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } },
    { id: "d", start: { dateTime: "2026-12-03T03:30:00Z" }, end: { dateTime: "2026-12-03T04:00:00Z" } },
    { id: "e", summary: "Outside", start: { dateTime: "2026-12-20T15:00:00Z" }, end: { dateTime: "2026-12-20T16:00:00Z" } },
  ];
  const events = raw.flatMap((e) => fromGoogleEvent(e, "Classes") ?? []);
  assert.equal(events.length, 4);
  const days = ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"];
  const shown = googleEntries([...events, events[0]], days, "America/New_York");
  assert.deepEqual(
    shown.map((e) => [e.date, e.title, e.time]),
    [
      ["2026-12-02", "Trip", null],
      ["2026-12-03", "Trip", null],
      ["2026-12-01", "COMS 3134 Lecture", "9:10 AM"],
      ["2026-12-02", "Busy", "10:30 PM"],
    ],
  );
});

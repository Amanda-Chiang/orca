import assert from "node:assert/strict";
import { test } from "node:test";
import { orcaEvents } from "../../src/lib/calendar/ics.ts";
import { googleEventId, syncPlan, toGoogleEvent } from "../../src/lib/google/calendar.ts";
import { GOOGLE_SCOPES, consentUrl, emailFromIdToken, grantedFeatures, readOAuthCookie, safeNext, withOutcome, writeOAuthCookie } from "../../src/lib/google/oauth.ts";

test("each feature asks only for its own narrow scope, offline, with PKCE", () => {
  const url = new URL(consentUrl({ clientId: "cid", redirectUri: "https://orca.test/api/google/callback", feature: "drive", state: "s", codeChallenge: "c" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const scopes = url.searchParams.get("scope")!.split(" ");
  assert.deepEqual(scopes, ["openid", "email", GOOGLE_SCOPES.drive]);
  assert.ok(!scopes.includes(GOOGLE_SCOPES.calendar));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(grantedFeatures(["openid", GOOGLE_SCOPES.calendar]), ["calendar"]);
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

const input = {
  courses: [{ id: "c1", name: "Data Structures", short: "DS", schedule: { meetings: [{ day: 1 as const, start: "9:05", end: "10:20" }], quickDays: [0 as const], deepDays: null } }],
  exams: [{ id: "e1", courseId: "c1", title: "Midterm", date: "2026-12-10" }],
  events: [],
  from: "2026-11-27",
  timezone: "America/New_York",
};

test("Orca's events become Google events with valid, stable ids", () => {
  const events = orcaEvents(input).map((e) => toGoogleEvent(e, input.timezone));
  for (const e of events) assert.match(e.id, /^[a-v0-9]{5,1024}$/);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(googleEventId("exam-e1"), events.find((e) => e.summary.startsWith("Midterm"))!.id);
  const exam = events.find((e) => e.summary === "Midterm · DS")!;
  assert.deepEqual(exam.start, { date: "2026-12-10" });
  assert.deepEqual(exam.end, { date: "2026-12-11" });
  const meeting = events.find((e) => e.summary === "DS class")!;
  assert.deepEqual(meeting.start, { dateTime: "2026-11-30T09:05:00", timeZone: "America/New_York" });
  assert.deepEqual(meeting.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  assert.equal(meeting.transparency, "opaque");
  const review = events.find((e) => e.summary === "Orca review · DS")!;
  assert.deepEqual(review.start, { date: "2026-11-29" });
  assert.deepEqual(review.end, { date: "2026-11-30" });
});

test("a sync writes only what changed and removes what Orca no longer has", () => {
  const wanted = orcaEvents(input).map((e) => toGoogleEvent(e, input.timezone));
  const [first, ...rest] = wanted;
  const plan = syncPlan(wanted, [
    { id: first.id, h: first.extendedProperties.private.h },
    { id: rest[0].id, h: "stale" },
    { id: "orcagone", h: "x" },
  ]);
  assert.deepEqual(plan.write.map((e) => e.id), rest.map((e) => e.id));
  assert.deepEqual(plan.remove, ["orcagone"]);
  assert.deepEqual(syncPlan(wanted, wanted.map((e) => ({ id: e.id, h: e.extendedProperties.private.h }))), { write: [], remove: [] });
});

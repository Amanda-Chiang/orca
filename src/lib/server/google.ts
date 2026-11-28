/**
 * Google Calendar and Drive for a student (2026-11-27), against Supabase and Google's APIs. The
 * refresh token is encrypted at rest (the Canvas token's key) and never leaves the server; the
 * browser only ever gets a short-lived access token narrowed to `drive.file`, for Google's picker.
 * Calendar is read only since 2026-11-28 (owner): the student's events are read when Orca's
 * calendar page asks and never stored. Pure parts: `src/lib/google/oauth.ts` (consent URL, checks)
 * and `src/lib/google/events.ts` (Google's events as calendar entries).
 *
 * Settings: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (the OAuth web client), and for the Drive
 * picker GOOGLE_PICKER_API_KEY (a browser API key) and GOOGLE_PROJECT_NUMBER (the Cloud project's
 * number). Redirect URI: `<SITE_URL>/api/google/callback` (docs/SETUP-HOSTED.md §13).
 */
import { type GoogleCalendarEvent, type RawGoogleEvent, fromGoogleEvent } from "@/lib/google/events";
import { GOOGLE_SCOPES, type GoogleFeature, REVOKE_ENDPOINT, TOKEN_ENDPOINT, emailFromIdToken, grantedFeatures } from "@/lib/google/oauth";
import { decryptToken, encryptToken } from "@/lib/server/canvas";
import type { OrcaSupabase } from "@/lib/supabase/server";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  pickerApiKey: string | null;
  projectNumber: string | null;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, pickerApiKey: process.env.GOOGLE_PICKER_API_KEY?.trim() || null, projectNumber: process.env.GOOGLE_PROJECT_NUMBER?.trim() || null };
}

/** Where Google sends the student back; must match a redirect URI on the OAuth client exactly. */
export function redirectUri(request: Request): string {
  const base = process.env.SITE_URL?.trim() || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/api/google/callback`;
}

export class GoogleError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Google refused the stored refresh token: the student must connect again. */
    public reconnect = false,
  ) {
    super(message);
  }
}

const connections = (db: OrcaSupabase) => db.from("google_connections");

/* ── Status ── */

export interface GoogleStatus {
  /** Whether this server has a Google OAuth client at all. */
  configured: boolean;
  /** Whether the Drive picker can open (its API key and project number are set too). */
  pickerReady: boolean;
  email: string | null;
  calendar: { connected: boolean };
  drive: { connected: boolean };
  /** Google stopped accepting Orca's access: connect again. */
  needsReconnect: boolean;
}

export async function googleStatus(db: OrcaSupabase, ownerId: string): Promise<GoogleStatus> {
  const config = googleConfig();
  const { data, error } = await connections(db).select("google_email, scopes, broken_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Google connection: ${error.message}`);
  const features = data && !data.broken_at ? grantedFeatures(data.scopes) : [];
  return {
    configured: config !== null,
    pickerReady: Boolean(config?.pickerApiKey && config.projectNumber),
    email: data?.google_email ?? null,
    calendar: { connected: features.includes("calendar") },
    drive: { connected: features.includes("drive") },
    needsReconnect: Boolean(data?.broken_at),
  };
}

/* ── Tokens ── */

interface TokenReply {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(params: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new GoogleError(400, "Google no longer accepts Orca's access. Connect Google again.", true);
    throw new GoogleError(502, `Google refused the sign-in (${body.error ?? res.status}).`);
  }
  return body;
}

/** The code Google sent back, exchanged and saved. Answers which features the account now grants. */
export async function finishConsent(db: OrcaSupabase, ownerId: string, code: string, verifier: string, redirect: string): Promise<{ features: GoogleFeature[]; email: string | null }> {
  const config = googleConfig();
  if (!config) throw new GoogleError(503, "Google isn't set up on this server.");
  const t = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirect });
  const scopes = (t.scope ?? "").split(" ").filter(Boolean);
  const email = emailFromIdToken(t.id_token);
  const { data: before, error: readError } = await connections(db).select("refresh_token_enc, google_email").eq("owner_id", ownerId).maybeSingle();
  if (readError) throw new Error(`Couldn't read the Google connection: ${readError.message}`);
  const sameAccount = before !== null && before.google_email === email;
  const refresh = t.refresh_token ? encryptToken(t.refresh_token) : sameAccount ? before.refresh_token_enc : null;
  if (!refresh) throw new GoogleError(502, "Google didn't give Orca lasting access. Try connecting again.");
  const row = { owner_id: ownerId, refresh_token_enc: refresh, google_email: email, scopes, broken_at: null, last_used_at: new Date().toISOString() };
  // Another Google account replaces the old one (undefined leaves the column as it is).
  const { error } = await connections(db).upsert({ ...row, created_at: sameAccount ? undefined : new Date().toISOString() });
  if (error) throw new Error(`Couldn't save the Google connection: ${error.message}`);
  return { features: grantedFeatures(scopes), email };
}

/** A fresh access token, narrowed to the feature's scopes (Google allows a subset of what was granted). */
export async function accessToken(db: OrcaSupabase, ownerId: string, feature: GoogleFeature): Promise<{ token: string; expiresIn: number }> {
  const config = googleConfig();
  if (!config) throw new GoogleError(503, "Google isn't set up on this server.");
  const { data, error } = await connections(db).select("refresh_token_enc, scopes, broken_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Google connection: ${error.message}`);
  if (!data || data.broken_at || !GOOGLE_SCOPES[feature].every((s) => data.scopes.includes(s))) throw new GoogleError(409, feature === "drive" ? "Connect Google Drive first." : "Connect Google Calendar first.", true);
  try {
    const t = await tokenCall({ grant_type: "refresh_token", refresh_token: decryptToken(data.refresh_token_enc), client_id: config.clientId, client_secret: config.clientSecret, scope: GOOGLE_SCOPES[feature].join(" ") });
    if (!t.access_token) throw new GoogleError(502, "Google sent no access token.");
    await connections(db).update({ last_used_at: new Date().toISOString() }).eq("owner_id", ownerId);
    return { token: t.access_token, expiresIn: t.expires_in ?? 3600 };
  } catch (e) {
    if (e instanceof GoogleError && e.reconnect) await connections(db).update({ broken_at: new Date().toISOString() }).eq("owner_id", ownerId);
    throw e;
  }
}

/** Disconnect: Google's grant revoked and the row removed. Nothing Orca imported is touched. */
export async function disconnectGoogle(db: OrcaSupabase, ownerId: string): Promise<void> {
  const { data, error } = await connections(db).select("refresh_token_enc, broken_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Google connection: ${error.message}`);
  if (!data) return;
  if (!data.broken_at) {
    await fetch(REVOKE_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decryptToken(data.refresh_token_enc) }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  }
  const { error: deleteError } = await connections(db).delete().eq("owner_id", ownerId);
  if (deleteError) throw new Error(`Couldn't remove the Google connection: ${deleteError.message}`);
}

/* ── Calendar (read only) ── */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** Enough for a student's own, school and shared calendars; more are left out. */
const MAX_CALENDARS = 20;
const MAX_EVENTS_PER_CALENDAR = 250;

async function calendarGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${CALENDAR_API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new GoogleError(res.status === 401 || res.status === 403 ? 409 : 502, `Google Calendar answered ${res.status}${detail ? `: ${detail}` : ""}.`);
  }
  return (await res.json()) as T;
}

/**
 * The student's Google events between two instants, from every calendar they show in Google
 * Calendar (`selected`), read when asked and not stored. A calendar named "Orca" is skipped: that's
 * Orca's own subscription feed added to Google, already on Orca's calendar.
 */
export async function googleEvents(db: OrcaSupabase, ownerId: string, timeMin: string, timeMax: string): Promise<GoogleCalendarEvent[]> {
  const { token } = await accessToken(db, ownerId, "calendar");
  const list = await calendarGet<{ items?: { id: string; summary?: string; summaryOverride?: string; selected?: boolean; hidden?: boolean }[] }>(token, "/users/me/calendarList?fields=items(id,summary,summaryOverride,selected,hidden)&maxResults=250");
  const calendars = (list.items ?? []).filter((c) => c.selected && !c.hidden && (c.summaryOverride ?? c.summary) !== "Orca").slice(0, MAX_CALENDARS);
  const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: String(MAX_EVENTS_PER_CALENDAR), fields: "items(id,summary,status,start,end,transparency)" });
  const pages = await Promise.all(
    calendars.map(async (c) => {
      const page = await calendarGet<{ items?: RawGoogleEvent[] }>(token, `/calendars/${encodeURIComponent(c.id)}/events?${q}`);
      return (page.items ?? []).flatMap((e) => fromGoogleEvent(e, c.summaryOverride ?? c.summary ?? "Google Calendar") ?? []);
    }),
  );
  return pages.flat();
}

/* ── Drive ── */

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** Google's own formats, exported as PDF; anything else is downloaded as it is. */
export const GOOGLE_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "Google Doc",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.spreadsheet": "Google Sheet",
};

export interface DriveFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
  exported: boolean;
}

/** A file the student picked (drive.file reaches only those), as bytes. Throws GoogleError. */
export async function downloadDriveFile(db: OrcaSupabase, ownerId: string, fileId: string, maxBytes: number): Promise<DriveFile> {
  const { token } = await accessToken(db, ownerId, "drive");
  const auth = { authorization: `Bearer ${token}` };
  const id = encodeURIComponent(fileId);
  const metaRes = await fetch(`${DRIVE_API}/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (metaRes.status === 404 || metaRes.status === 403) throw new GoogleError(404, "Orca can't open that Drive file. Pick it again in the Drive picker.");
  if (!metaRes.ok) throw new GoogleError(502, `Google Drive answered ${metaRes.status}.`);
  const meta = (await metaRes.json()) as { name: string; mimeType: string; size?: string };
  const exported = meta.mimeType in GOOGLE_EXPORTS;
  if (!exported && meta.mimeType.startsWith("application/vnd.google-apps.")) throw new GoogleError(422, "Orca can read Google Docs, Slides and Sheets, PDFs, .pptx and .docx files from Drive.");
  if (!exported && Number(meta.size ?? 0) > maxBytes) throw new GoogleError(413, "That file is too big for Orca.");
  const url = exported ? `${DRIVE_API}/files/${id}/export?mimeType=application%2Fpdf` : `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    // Google exports at most 10 MB; a bigger Doc or deck has to be downloaded as PDF and uploaded.
    if (exported && res.status === 403) throw new GoogleError(413, "Google won't export a file that big. Download it as a PDF and upload that.");
    throw new GoogleError(502, `Google Drive answered ${res.status}.`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new GoogleError(413, "That file is too big for Orca.");
  const name = exported && !/\.pdf$/i.test(meta.name) ? `${meta.name}.pdf` : meta.name;
  return { bytes, name, mime: exported ? "application/pdf" : meta.mimeType, exported };
}

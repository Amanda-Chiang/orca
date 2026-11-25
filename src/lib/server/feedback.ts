/**
 * App feedback (owner, 2026-11-25): what a student says at a prompt (after a session, after an
 * upload is built, after a practice test, or in Settings), and where each prompt stands for them.
 * Server-only tables (`app_feedback`, migration 20261125110000): the browser goes through
 * `POST /api/feedback` and `GET /api/feedback`; the rows are written and read by the database
 * functions, with the service role.
 */
import { LIMITS } from "@/lib/limits";
import type { OrcaSupabase } from "@/lib/supabase/server";

export const FEEDBACK_SPOTS = ["session-end", "upload-done", "practice-test", "settings"] as const;
export type FeedbackSpot = (typeof FEEDBACK_SPOTS)[number];

export const FEEDBACK_NOTE_MAX = 1000;
export const FEEDBACK_PAGE_MAX = 200;

export interface FeedbackInput {
  spot: FeedbackSpot;
  rating: "up" | "down" | null;
  note: string | null;
  page: string | null;
  dismissed: boolean;
}

export type SpotState = Record<string, { answered: boolean; dismissed: number }>;

export async function recordFeedback(db: OrcaSupabase, owner: string, input: FeedbackInput): Promise<string> {
  // The functions' argument shapes aren't in database.types.ts yet (no local stack to regenerate it); the SQL in the migration is the contract.
  const { data, error } = await db.rpc("record_app_feedback" as never, {
    p_owner: owner,
    p_spot: input.spot,
    p_rating: input.rating,
    p_note: input.note,
    p_page: input.page,
    p_dismissed: input.dismissed,
  } as never);
  if (error) throw new Error(`Couldn't record the feedback: ${error.message}`);
  if (typeof data !== "string") throw new Error("Couldn't record the feedback: the database answered nothing");
  return data;
}

export async function feedbackSpots(db: OrcaSupabase, owner: string): Promise<SpotState> {
  const { data, error } = await db.rpc("app_feedback_spots" as never, { p_owner: owner } as never);
  if (error) throw new Error(`Couldn't read the feedback spots: ${error.message}`);
  if (!data || typeof data !== "object") return {};
  const out: SpotState = {};
  for (const [spot, v] of Object.entries(data as Record<string, unknown>)) {
    const s = v as { answered?: unknown; dismissed?: unknown };
    out[spot] = { answered: s.answered === true, dismissed: typeof s.dismissed === "number" ? s.dismissed : Number(s.dismissed ?? 0) };
  }
  return out;
}

/** Whether the prompt should still ask at this spot. */
export function spotOpen(state: SpotState, spot: FeedbackSpot): boolean {
  const s = state[spot];
  if (!s) return true;
  return !s.answered && s.dismissed < LIMITS.feedbackDismissals;
}

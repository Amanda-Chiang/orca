import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { FEEDBACK_NOTE_MAX, FEEDBACK_PAGE_MAX, FEEDBACK_SPOTS, feedbackSpots, recordFeedback } from "@/lib/server/feedback";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * App feedback (owner, 2026-11-25).
 * GET → { spots: { [spot]: { answered, dismissed } } }: where each prompt stands for this student.
 * POST { spot, rating?, note?, page?, dismissed? } → 201 { id }: an answer (a rating or a note) or a
 * dismissal at a spot. Under the `feedback` rate limit. The note is free text from the student,
 * stored as written and shown only to admins, who read it as data.
 */
export const runtime = "nodejs";

const body = z
  .object({
    spot: z.enum(FEEDBACK_SPOTS),
    rating: z.enum(["up", "down"]).nullable().optional(),
    note: z.string().max(FEEDBACK_NOTE_MAX).nullable().optional(),
    page: z.string().max(FEEDBACK_PAGE_MAX).nullable().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const spots = await feedbackSpots(db, student.id);
    return reply(200, { spots, dismissals: LIMITS.feedbackDismissals });
  });
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "That isn't a feedback message." });
    const { spot, dismissed = false } = parsed.data;
    const rating = parsed.data.rating ?? null;
    const note = parsed.data.note?.trim() || null;
    const page = parsed.data.page?.trim() || null;
    if (!dismissed && !rating && !note) return reply(400, { error: "Say something, or pick a thumb." });
    const verdict = await rateLimit(db, student.id, "feedback");
    if (!verdict.ok) return tooManyRequests(verdict);
    const id = await recordFeedback(db, student.id, { spot, rating: dismissed ? null : rating, note: dismissed ? null : note, page, dismissed });
    return reply(201, { id });
  });
}

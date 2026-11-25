import type { OrcaSupabase } from "@/lib/supabase/server";
import { LIMITS } from "@/lib/limits";
import { checkNotes } from "@/lib/pipeline/notes";
import { recordSecurityEvents } from "@/lib/server/security";
import { reply } from "@/lib/server/student";

type NotesKind = { kind: "orca_notes" | "marker_notes"; maxChars: number };
const NOTES: NotesKind = { kind: "orca_notes", maxChars: LIMITS.notesChars };

/**
 * A Notes for Orca (or the description of the student's confusion marks) being saved, from Settings or
 * the connector: cleaned, or refused with the span that tries to instruct the model. Anything the
 * screen flags is logged, whether or not it's refused.
 */
export async function screenNotes(db: OrcaSupabase, ownerId: string, raw: string | null, opts: NotesKind = NOTES): Promise<{ ok: true; text: string | null } | { ok: false; error: string }> {
  const out = checkNotes(raw, opts.maxChars);
  await recordSecurityEvents(db, ownerId, opts.kind, out.hits);
  if (out.ok) return { ok: true, text: out.text };
  const error =
    opts.kind === "marker_notes"
      ? `Orca can't use a description that gives its AI instructions ("${out.quote}"). Describe your marks instead.`
      : `Orca can't use notes that give its AI instructions ("${out.quote}"). Describe the class, or how you like to be quizzed, instead.`;
  return { ok: false, error };
}

/** screenNotes for a route: a refusal is a 400 the student can act on. */
export async function acceptNotes(db: OrcaSupabase, ownerId: string, raw: string | null, opts: NotesKind = NOTES): Promise<{ ok: true; text: string | null } | { ok: false; response: Response }> {
  const out = await screenNotes(db, ownerId, raw, opts);
  return out.ok ? out : { ok: false, response: reply(400, { error: out.error }) };
}

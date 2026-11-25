/**
 * set_preferences: the account's Notes for Orca (every class) and how the student marks confusion in
 * handwritten notes, saved as Settings saves them (PUT /api/account-notes, PUT /api/marker-notes):
 * cleaned and screened, a refusal naming the span, every hit logged.
 */
import type { Preferences } from "@/lib/connector/mcp";
import { LIMITS } from "@/lib/limits";
import { screenNotes } from "@/lib/server/notes";
import type { OrcaSupabase } from "@/lib/supabase/server";

export async function setPreferences(db: OrcaSupabase, ownerId: string, change: Partial<Preferences>): Promise<Preferences | { error: string }> {
  const row: { orca_notes?: string | null; marker_notes?: string | null } = {};
  if (change.notes !== undefined) {
    const notes = await screenNotes(db, ownerId, change.notes);
    if (!notes.ok) return { error: notes.error };
    row.orca_notes = notes.text;
  }
  if (change.markerNotes !== undefined) {
    const markers = await screenNotes(db, ownerId, change.markerNotes, { kind: "marker_notes", maxChars: LIMITS.markerChars });
    if (!markers.ok) return { error: markers.error };
    row.marker_notes = markers.text;
  }
  const { data, error } = await db.from("profiles").update(row).eq("owner_id", ownerId).select("orca_notes, marker_notes").maybeSingle();
  if (error) throw new Error(`Couldn't save the preferences: ${error.message}`);
  if (!data) return { error: "Orca couldn't find this account." };
  return { notes: data.orca_notes, markerNotes: data.marker_notes };
}

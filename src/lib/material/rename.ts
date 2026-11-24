/**
 * Renaming an upload (owner, 2026-11-24): the student edits the name before the extension; the
 * extension stays, since the app tells a PDF or .pptx apart by it. The name reaches the model (the
 * table of contents says where each topic is taught by file name), so it's cleaned and screened like
 * Notes for Orca: a name that tries to instruct the AI is refused. Pure; loads under plain Node.
 */
import { sanitize } from "../untrusted/sanitize.ts";
import { type ScreenHit, screen } from "../untrusted/screen.ts";

/** The most characters a name (before the extension) may have. */
export const NAME_CHARS = 200;

/** A file's name split at its kept extension (".pdf", ".pptx" or ".docx"; none for pasted text, chats and websites). */
export function splitName(filename: string): { stem: string; ext: string } {
  const m = /\.(pdf|pptx|docx)$/i.exec(filename);
  return m ? { stem: filename.slice(0, m.index), ext: filename.slice(m.index) } : { stem: filename, ext: "" };
}

export type RenameCheck = { ok: true; filename: string; hits: ScreenHit[] } | { ok: false; error: string; hits: ScreenHit[] };

/** The new full name for `current` with its name part replaced by `stem`, or why it can't be used. */
export function renamed(current: string, stem: string): RenameCheck {
  const { ext } = splitName(current);
  let text = sanitize(stem, NAME_CHARS).text.replace(/\s+/g, " ").trim();
  // The extension typed again ("Notes.pdf" for a PDF) isn't doubled.
  if (ext && text.toLowerCase().endsWith(ext.toLowerCase())) text = text.slice(0, -ext.length).trim();
  if (!text) return { ok: false, error: "Give the file a name.", hits: [] };
  const screened = screen(text);
  if (screened.strong) {
    const quote = screened.hits.find((h) => h.severity === "strong")!.quote;
    return { ok: false, error: `Orca can't use a name that gives its AI instructions ("${quote}").`, hits: screened.hits };
  }
  return { ok: true, filename: `${text}${ext}`, hits: screened.hits };
}

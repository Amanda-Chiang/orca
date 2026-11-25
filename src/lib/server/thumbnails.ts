/**
 * Slide previews (2026-11-24): every page of an uploaded PDF drawn small and stored in the private
 * `thumbnails` bucket as "<owner>/<material id>/<page>.jpg", made while the upload is processed so
 * "Which slides were hard?" loads small images instead of the whole file. Never sinks an upload: a
 * failure is logged and the dialog falls back to drawing the PDF in the browser. The file is used
 * only if its SHA-256 still matches the hash taken when it was read (as `figures.ts` does).
 */
import { createHash } from "node:crypto";
import { renderThumbnails } from "@/lib/material/render-slide";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { BUCKET } from "./materials";

export const THUMBNAILS = "thumbnails";

export const thumbnailFolder = (ownerId: string, materialId: string) => `${ownerId}/${materialId}`;

async function storedCount(db: OrcaSupabase, folder: string): Promise<number> {
  const { data, error } = await db.storage.from(THUMBNAILS).list(folder, { limit: 1000 });
  if (error) throw new Error(error.message);
  return data.length;
}

/** Draw and store the previews of one material; a PDF only, skipped when they're all there already. */
export async function makeThumbnails(db: OrcaSupabase, ownerId: string, materialId: string): Promise<void> {
  try {
    const { data: m, error } = await db.from("materials").select("storage_path, content_hash, mime, filename").eq("owner_id", ownerId).eq("id", materialId).maybeSingle();
    if (error) throw new Error(error.message);
    const pdf = m?.mime === "application/pdf" || m?.filename.toLowerCase().endsWith(".pdf");
    if (!m?.storage_path || !m.content_hash || !pdf) return;
    const { count, error: countError } = await db.from("material_pages").select("n", { count: "exact", head: true }).eq("owner_id", ownerId).eq("material_id", materialId);
    if (countError) throw new Error(countError.message);
    const folder = thumbnailFolder(ownerId, materialId);
    if (count && (await storedCount(db, folder)) >= count) return;
    const got = await db.storage.from(BUCKET).download(m.storage_path);
    if (got.error) throw new Error(got.error.message);
    const bytes = new Uint8Array(await got.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== m.content_hash) throw new Error("the stored file changed since it was read");
    await renderThumbnails(bytes, async (n, jpeg) => {
      const put = await db.storage.from(THUMBNAILS).upload(`${folder}/${n}.jpg`, jpeg, { contentType: "image/jpeg", upsert: true });
      if (put.error) throw new Error(put.error.message);
    });
  } catch (e) {
    console.error(`Couldn't make slide previews for material ${materialId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Remove a material's previews (with the material's file). */
export async function removeThumbnails(db: OrcaSupabase, ownerId: string, materialId: string): Promise<void> {
  const folder = thumbnailFolder(ownerId, materialId);
  const { data, error } = await db.storage.from(THUMBNAILS).list(folder, { limit: 1000 });
  if (error) throw new Error(`Couldn't list the slide previews: ${error.message}`);
  if (!data.length) return;
  const removed = await db.storage.from(THUMBNAILS).remove(data.map((f) => `${folder}/${f.name}`));
  if (removed.error) throw new Error(`Couldn't remove the slide previews: ${removed.error.message}`);
}

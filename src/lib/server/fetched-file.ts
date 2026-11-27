/**
 * A file Orca fetched for the student (a Google share link, or a file picked in Google Drive) taken
 * through the same path as a browser upload: Storage, `processUpload`, then the job. Shared by
 * `POST /api/materials/google` and `POST /api/materials/google-drive` (2026-11-27).
 */
import { createHash } from "node:crypto";
import type { MaterialType } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { heldBackByDefault } from "@/lib/material/hold-back";
import { UPLOAD_MIMES, type UploadKind, uploadKind } from "@/lib/material/kind";
import { startUploadJob } from "@/lib/server/jobs/start";
import { BUCKET, processUpload, startUpload } from "@/lib/server/materials";
import { singleton } from "@/lib/server/staged/admission";
import { pipelineRpc, stagedPipeline } from "@/lib/server/staged/db";
import { reply } from "@/lib/server/student";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { sanitize } from "@/lib/untrusted/sanitize";

export interface FileMeta {
  courseId: string;
  type: MaterialType;
  assigned: string | null;
  due: string | null;
  heldBack?: boolean;
  handwritten?: boolean;
}

export interface FetchedFile {
  bytes: Uint8Array;
  /** The name the source gave, if any. */
  name: string | null;
  /** The content type the source sent. */
  mime: string;
  /** The kind to assume when neither name nor type says (a PDF export). */
  assumeKind: UploadKind | null;
}

export const TOO_BIG = "That file is too big for Orca.";
export const NOT_READABLE = "Orca reads PDFs, slide decks (.pptx) and Word files (.docx). That Drive file is something else.";

/** `fetchFile` answers the file, or a Response to send instead (a refusal). */
export async function addFetchedFile(db: OrcaSupabase, ownerId: string, meta: FileMeta, fallbackName: string, fetchFile: () => Promise<FetchedFile | Response>): Promise<Response> {
  const admissionId = stagedPipeline() ? crypto.randomUUID() : undefined;
  if (admissionId) await singleton(db, ownerId, meta.courseId, admissionId, fallbackName, "google");
  let attached = false;
  try {
    const got = await fetchFile();
    if (got instanceof Response) return got;
    const { bytes } = got;
    if (bytes.byteLength > LIMITS.uploadBytes) return reply(413, { error: TOO_BIG });
    const rawName = got.name ?? fallbackName;
    const mime = got.mime.split(";")[0].trim().toLowerCase();
    const kind = uploadKind(rawName, mime) ?? got.assumeKind;
    if (!kind) return reply(422, { error: NOT_READABLE });
    const filename = (sanitize(rawName, 255).text.trim() || fallbackName).slice(0, 255);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const started = await startUpload(db, ownerId, {
      courseId: meta.courseId,
      admissionId,
      filename: /\.(pdf|pptx|docx)$/i.test(filename) ? filename : `${filename}.${kind}`,
      size: bytes.byteLength,
      mime: UPLOAD_MIMES[kind],
      hash,
      type: meta.type,
      assigned: meta.assigned,
      due: meta.due,
      reflect: false,
      handwritten: meta.handwritten ?? false,
      heldBack: meta.heldBack ?? heldBackByDefault(meta.type),
    });
    if (started.status === 200 && "duplicate" in started.body) {
      attached = true;
      return reply(200, { ...started.body, generation: await startUploadJob(db, ownerId, started.body.duplicate.id, admissionId) });
    }
    if (started.status !== 201 || !("upload" in started.body)) return reply(started.status, started.body);
    const { material, upload } = started.body;
    const put = await db.storage.from(BUCKET).upload(upload.path, bytes, { contentType: UPLOAD_MIMES[kind], upsert: true });
    if (put.error) return reply(500, { error: "Orca couldn't store that file." });
    const processed = await processUpload(db, ownerId, material.id);
    if (processed.status !== 200) return reply(processed.status, processed.body);
    attached = true;
    if ("duplicate" in processed.body) return reply(200, { ...processed.body, generation: await startUploadJob(db, ownerId, processed.body.duplicate.id, admissionId) });
    return reply(201, { ...processed.body, generation: await startUploadJob(db, ownerId, material.id, admissionId) });
  } finally {
    if (admissionId && !attached) await pipelineRpc(db, "ingestion", { ownerId, itemId: admissionId, action: "fail", error: "The file could not be added. Try again." });
  }
}

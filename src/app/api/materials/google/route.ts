import { createHash } from "node:crypto";
import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { filenameFromDisposition, parseGoogleLink } from "@/lib/google-link";
import { LIMITS } from "@/lib/limits";
import { heldBackByDefault } from "@/lib/material/hold-back";
import { UPLOAD_MIMES, uploadKind } from "@/lib/material/kind";
import { startUploadJob } from "@/lib/server/jobs/start";
import { BUCKET, processUpload, startUpload } from "@/lib/server/materials";
import { singleton } from "@/lib/server/staged/admission";
import { pipelineRpc, stagedPipeline } from "@/lib/server/staged/db";
import { publicHop } from "@/lib/server/public-page";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";
import { sanitize } from "@/lib/untrusted/sanitize";

/**
 * A Google Docs, Slides, Sheets or Drive share link as material (owner, 2026-11-25): Orca fetches
 * the file Google serves for it (a PDF export of a Doc or deck; a Drive file as it is) and takes it
 * through the same path as a browser upload (Storage, then `processUpload`). Only a file shared
 * "anyone with the link" comes through: when Google answers with its sign-in page instead, the
 * route says so. Under the `google` rate limit.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const requestSchema = z.object({
  courseId: z.uuid(),
  url: z.string().trim().max(2048),
  type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  assigned: date,
  due: date,
  heldBack: z.boolean().optional(),
  handwritten: z.boolean().optional(),
});

const NOT_SHARED = "Google wouldn't hand the file over. Share it as \"Anyone with the link\" (Share → General access) and try again.";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Enter a Google Docs, Slides or Drive link." });
    const link = parseGoogleLink(parsed.data.url);
    if (!link) return reply(400, { error: "That isn't a Google Docs, Slides, Sheets or Drive file link." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const rate = await rateLimit(db, student.id, "google");
    if (!rate.ok) return tooManyRequests(rate);
    const admissionId = stagedPipeline() ? crypto.randomUUID() : undefined;
    if (admissionId) await singleton(db, student.id, parsed.data.courseId, admissionId, link.fallbackName, "google");
    let attached = false;
    try {

    // Google serves the file after one or two redirects (a Drive download may add a virus-scan hop); every hop must be public.
    let url = new URL(link.exportUrl);
    let res: Response | null = null;
    const signal = AbortSignal.timeout(60_000);
    for (let hop = 0; hop < 5; hop++) {
      if (!(await publicHop(url))) return reply(400, { error: "That link doesn't lead to Google." });
      res = await fetch(url, { redirect: "manual", signal, headers: { "user-agent": "Orca course-material importer" } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) return reply(422, { error: NOT_SHARED });
        url = new URL(location, url);
        res = null;
        continue;
      }
      break;
    }
    if (!res) return reply(422, { error: NOT_SHARED });
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!res.ok || contentType.includes("text/html")) {
      await res.body?.cancel().catch(() => {});
      return reply(422, { error: NOT_SHARED });
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > LIMITS.uploadBytes) return reply(413, { error: "That file is too big for Orca." });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > LIMITS.uploadBytes) return reply(413, { error: "That file is too big for Orca." });
    if (bytes.byteLength < 100) return reply(422, { error: NOT_SHARED });

    const sent = filenameFromDisposition(res.headers.get("content-disposition"));
    const rawName = sent ?? (link.kind === "drive" ? link.fallbackName : link.fallbackName);
    const mime = contentType.split(";")[0].trim();
    const kind = uploadKind(rawName, mime) ?? (link.kind !== "drive" ? "pdf" : null);
    if (!kind) return reply(422, { error: "Orca reads PDFs, slide decks (.pptx) and Word files (.docx). That Drive file is something else." });
    const filename = (sanitize(rawName, 255).text.trim() || link.fallbackName).slice(0, 255);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const started = await startUpload(db, student.id, {
      courseId: parsed.data.courseId,
      admissionId,
      filename: /\.(pdf|pptx|docx)$/i.test(filename) ? filename : `${filename}.${kind}`,
      size: bytes.byteLength,
      mime: UPLOAD_MIMES[kind],
      hash,
      type: parsed.data.type,
      assigned: parsed.data.assigned,
      due: parsed.data.due,
      reflect: false,
      handwritten: parsed.data.handwritten ?? false,
      heldBack: parsed.data.heldBack ?? heldBackByDefault(parsed.data.type),
    });
    if (started.status === 200 && "duplicate" in started.body) {
      attached = true;
      return reply(200, { ...started.body, generation: await startUploadJob(db, student.id, started.body.duplicate.id, admissionId) });
    }
    if (started.status !== 201 || !("upload" in started.body)) return reply(started.status, started.body);
    const { material, upload } = started.body;
    const put = await db.storage.from(BUCKET).upload(upload.path, bytes, { contentType: UPLOAD_MIMES[kind], upsert: true });
    if (put.error) return reply(500, { error: "Orca couldn't store that file." });
    const processed = await processUpload(db, student.id, material.id);
    if (processed.status !== 200) return reply(processed.status, processed.body);
    attached = true;
    if ("duplicate" in processed.body) return reply(200, { ...processed.body, generation: await startUploadJob(db, student.id, processed.body.duplicate.id, admissionId) });
    return reply(201, { ...processed.body, generation: await startUploadJob(db, student.id, material.id, admissionId) });
    } finally {
      if (admissionId && !attached) await pipelineRpc(db, "ingestion", { ownerId: student.id, itemId: admissionId, action: "fail", error: "The file could not be added. Try again." });
    }
  });
}

import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { LIMITS } from "@/lib/limits";
import { addFetchedFile } from "@/lib/server/fetched-file";
import { GoogleError, downloadDriveFile } from "@/lib/server/google";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

/**
 * A file the student picked in Google's Drive picker, as material (2026-11-27): Orca downloads it
 * with the student's `drive.file` access (Google Docs, Slides and Sheets exported as PDF) and takes
 * it through the upload path, as `POST /api/materials/google` does for a share link. One file per
 * call; under the `google` rate limit.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const requestSchema = z.object({
  courseId: z.uuid(),
  fileId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  assigned: date,
  due: date,
  heldBack: z.boolean().optional(),
  handwritten: z.boolean().optional(),
});

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Pick a file in Google Drive." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const rate = await rateLimit(db, student.id, "google");
    if (!rate.ok) return tooManyRequests(rate);
    return addFetchedFile(db, student.id, parsed.data, `Drive file ${parsed.data.fileId.slice(0, 8)}`, async () => {
      try {
        const file = await downloadDriveFile(db, student.id, parsed.data.fileId, LIMITS.uploadBytes);
        return { bytes: file.bytes, name: file.name, mime: file.mime, assumeKind: file.exported ? "pdf" : null };
      } catch (e) {
        if (e instanceof GoogleError) return reply(e.status, { error: e.message, reconnect: e.reconnect });
        throw e;
      }
    });
  });
}

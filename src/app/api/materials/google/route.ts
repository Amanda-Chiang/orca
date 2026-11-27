import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { filenameFromDisposition, parseGoogleLink } from "@/lib/google-link";
import { LIMITS } from "@/lib/limits";
import { TOO_BIG, addFetchedFile } from "@/lib/server/fetched-file";
import { publicHop } from "@/lib/server/public-page";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

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
    return addFetchedFile(db, student.id, parsed.data, link.fallbackName, async () => {
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
      if (declared > LIMITS.uploadBytes) return reply(413, { error: TOO_BIG });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > LIMITS.uploadBytes) return reply(413, { error: TOO_BIG });
      if (bytes.byteLength < 100) return reply(422, { error: NOT_SHARED });
      return { bytes, name: filenameFromDisposition(res.headers.get("content-disposition")), mime: contentType, assumeKind: link.kind !== "drive" ? "pdf" : null };
    });
  });
}

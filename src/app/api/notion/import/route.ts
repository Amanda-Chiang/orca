import { z } from "zod";
import { MATERIAL_TYPES, type MaterialType } from "@/lib/data";
import { heldBackByDefault } from "@/lib/material/hold-back";
import { NotionError, importNotionPages } from "@/lib/server/notion";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, ownsCourse, reply } from "@/lib/server/student";

/**
 * POST { courseId, pageIds, type, heldBack? } → { results: [{ pageId, title, result, materialId }] }:
 * each page picked becomes one text material of that type (the path pasted text takes), named after
 * the page. Pages already imported are left alone. 409 when Notion isn't connected; 429 past
 * LIMITS.rate.notionImport.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  courseId: z.uuid(),
  pageIds: z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)).min(1).max(50),
  type: z.enum(MATERIAL_TYPES as [MaterialType, ...MaterialType[]]),
  heldBack: z.boolean().optional(),
});

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Pick the pages to import." });
    if (!(await ownsCourse(db, student.id, parsed.data.courseId))) return reply(404, { error: "No such course." });
    const rate = await rateLimit(db, student.id, "notionImport");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      const results = await importNotionPages(db, student.id, { courseId: parsed.data.courseId, pageIds: parsed.data.pageIds, type: parsed.data.type, heldBack: parsed.data.heldBack ?? heldBackByDefault(parsed.data.type) });
      return reply(200, { results });
    } catch (e) {
      if (e instanceof NotionError) return reply(e.status === 409 || e.status === 401 ? 409 : 502, { error: e.status === 401 ? "Notion no longer accepts the secret. Reconnect in Settings." : e.message });
      throw e;
    }
  });
}

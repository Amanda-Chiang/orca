import { NotionError, listNotionPages } from "@/lib/server/notion";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/** GET → { pages: [{ id, title, lastEdited, materialId }] }: the pages shared with the student's integration. 409 when Notion isn't connected. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const rate = await rateLimit(db, student.id, "notionPages");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      return reply(200, { pages: await listNotionPages(db, student.id) });
    } catch (e) {
      if (e instanceof NotionError) return reply(e.status === 409 ? 409 : e.status === 401 ? 409 : 502, { error: e.status === 401 ? "Notion no longer accepts the secret. Reconnect in Settings." : e.message });
      throw e;
    }
  });
}

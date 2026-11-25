import { z } from "zod";
import { NotionError, notionStatus, revokeNotion, saveNotion } from "@/lib/server/notion";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * The student's Notion connection (Settings → Notion, 2026-11-25).
 * GET → { connected, workspaceName, botName, lastUsedAt }. POST { token } → 201 { workspaceName, botName }
 * once Notion has accepted the integration secret (400 for a bad one, 502 when Notion can't be
 * reached). DELETE → { disconnected: true }. The secret never comes back out.
 */
export const runtime = "nodejs";

const Body = z.object({ token: z.string().trim().min(1).max(400) });

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, await notionStatus(db, student.id)));
}

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply(400, { error: "Paste the integration secret from Notion." });
    const rate = await rateLimit(db, student.id, "notionConnect");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      return reply(201, await saveNotion(db, student.id, parsed.data.token));
    } catch (e) {
      if (e instanceof NotionError) return reply(e.status === 401 || e.status === 400 ? 400 : 502, { error: e.status === 401 ? "Notion didn't accept that secret. Copy it again from notion.so/profile/integrations." : e.message });
      throw e;
    }
  });
}

export async function DELETE(request: Request) {
  return forStudent(request, async (student, db) => {
    await revokeNotion(db, student.id);
    return reply(200, { disconnected: true });
  });
}

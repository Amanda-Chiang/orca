import { forAdmin } from "@/lib/server/admin";
import { activitySummary, appFeedback } from "@/lib/server/admin-queries";
import { reply } from "@/lib/server/student";

/** GET ?offset=n → app feedback (what students said at the prompts), newest first, and the activity summary. Admins only. */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return forAdmin(request, async (_admin, db) => {
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    const [rows, activity] = await Promise.all([appFeedback(db, Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0), activitySummary(db)]);
    return reply(200, { feedback: rows, activity });
  });
}

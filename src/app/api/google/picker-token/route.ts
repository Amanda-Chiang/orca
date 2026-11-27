import { GoogleError, accessToken, googleConfig } from "@/lib/server/google";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { forStudent, reply } from "@/lib/server/student";

/**
 * POST → { token, apiKey, appId, expiresIn }: what Google's Drive picker needs in the browser
 * (2026-11-27). The token is a fresh access token narrowed to `drive.file` (never the calendar
 * scope), good for an hour; the refresh token never leaves the server. 409 when Drive isn't connected.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return forStudent(request, async (student, db) => {
    const config = googleConfig();
    if (!config?.pickerApiKey || !config.projectNumber) return reply(503, { error: "Google Drive isn't set up on this server." });
    const rate = await rateLimit(db, student.id, "googleToken");
    if (!rate.ok) return tooManyRequests(rate);
    try {
      const { token, expiresIn } = await accessToken(db, student.id, "drive");
      return reply(200, { token, expiresIn, apiKey: config.pickerApiKey, appId: config.projectNumber });
    } catch (e) {
      if (e instanceof GoogleError) return reply(e.status, { error: e.message, reconnect: e.reconnect });
      throw e;
    }
  });
}

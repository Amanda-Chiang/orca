/**
 * Notion import against Supabase (owner, 2026-11-25): the student's internal-integration token
 * (encrypted at rest with the same key as the Canvas token; never read by the browser), the pages
 * shared with it, and importing pages as text material through `addTextMaterial`, the path pasted
 * text takes. Every imported page is linked by id (`notion_links`), so importing again adds only
 * what's new. Notion's API is one fixed public host, so no address check is needed per hop.
 */
import { type BlockNode, NOTION_API, NOTION_VERSION, type NotionBlock, type NotionList, type NotionPage, blocksToText, pageTitle } from "@/lib/notion/api";
import type { MaterialType } from "@/lib/data";
import { decryptToken, encryptToken } from "@/lib/server/canvas";
import { addTextMaterial } from "@/lib/server/text-material";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { sanitize } from "@/lib/untrusted/sanitize";

export class NotionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** At most this many blocks are read per page (nested ones included), and this deep. */
const MAX_BLOCKS = 600;
const MAX_DEPTH = 3;
const TIMEOUT_MS = 20_000;

interface Client {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

function notionClient(token: string, fetchImpl: typeof fetch = fetch): Client {
  const headers = { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION, "content-type": "application/json" };
  const call = async <T>(path: string, init: RequestInit): Promise<T> => {
    const res = await fetchImpl(`${NOTION_API}${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new NotionError(res.status, res.status === 401 ? "Notion didn't accept the token." : body?.message ?? `Notion answered ${res.status}.`);
    }
    return (await res.json()) as T;
  };
  return {
    get: (path) => call(path, { method: "GET" }),
    post: (path, body) => call(path, { method: "POST", body: JSON.stringify(body) }),
  };
}

/* ── The connection ── */

export interface NotionStatus {
  connected: boolean;
  workspaceName: string | null;
  botName: string | null;
  lastUsedAt: string | null;
}

// The tables aren't in database.types.ts yet (no local stack to regenerate it); migration 20261125120000 is the contract.
const connections = (db: OrcaSupabase) => db.from("notion_connections" as never);
const links = (db: OrcaSupabase) => db.from("notion_links" as never);

interface ConnectionRow {
  token_enc: string;
  workspace_name: string | null;
  bot_name: string | null;
  last_used_at: string | null;
}

export async function notionStatus(db: OrcaSupabase, ownerId: string): Promise<NotionStatus> {
  const { data, error } = await connections(db).select("workspace_name, bot_name, last_used_at").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Notion connection: ${error.message}`);
  const row = data as unknown as ConnectionRow | null;
  return { connected: row !== null, workspaceName: row?.workspace_name ?? null, botName: row?.bot_name ?? null, lastUsedAt: row?.last_used_at ?? null };
}

interface BotUser {
  name?: string;
  bot?: { workspace_name?: string };
}

/** Check the token against Notion (`/users/me`) and store it. */
export async function saveNotion(db: OrcaSupabase, ownerId: string, token: string, fetchImpl?: typeof fetch): Promise<{ workspaceName: string | null; botName: string | null }> {
  const trimmed = token.trim();
  if (!/^(secret_|ntn_)[A-Za-z0-9_-]{20,300}$/.test(trimmed)) throw new NotionError(400, "That doesn't look like a Notion integration secret (it starts with ntn_ or secret_).");
  const me = await notionClient(trimmed, fetchImpl).get<BotUser>("/users/me");
  const workspaceName = me.bot?.workspace_name ? sanitize(me.bot.workspace_name, 120).text.trim() || null : null;
  const botName = me.name ? sanitize(me.name, 120).text.trim() || null : null;
  const { error } = await connections(db).upsert({ owner_id: ownerId, token_enc: encryptToken(trimmed), workspace_name: workspaceName, bot_name: botName, created_at: new Date().toISOString(), last_used_at: null } as never);
  if (error) throw new Error(`Couldn't save the Notion connection: ${error.message}`);
  return { workspaceName, botName };
}

export async function revokeNotion(db: OrcaSupabase, ownerId: string): Promise<void> {
  const { error } = await connections(db).delete().eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't disconnect Notion: ${error.message}`);
}

async function clientFor(db: OrcaSupabase, ownerId: string, fetchImpl?: typeof fetch): Promise<Client | null> {
  const { data, error } = await connections(db).select("token_enc").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(`Couldn't read the Notion connection: ${error.message}`);
  const row = data as unknown as { token_enc: string } | null;
  if (!row) return null;
  await connections(db).update({ last_used_at: new Date().toISOString() } as never).eq("owner_id", ownerId);
  return notionClient(decryptToken(row.token_enc), fetchImpl);
}

/* ── Pages ── */

export interface NotionPageLine {
  id: string;
  title: string;
  lastEdited: string;
  /** Already imported: the material it became. */
  materialId: string | null;
}

/** The pages shared with the integration, most recently edited first (at most 100). 409 when Notion isn't connected. */
export async function listNotionPages(db: OrcaSupabase, ownerId: string, fetchImpl?: typeof fetch): Promise<NotionPageLine[]> {
  const client = await clientFor(db, ownerId, fetchImpl);
  if (!client) throw new NotionError(409, "Connect Notion in Settings first.");
  const found = await client.post<NotionList<NotionPage>>("/search", { filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 100 });
  const { data, error } = await links(db).select("page_id, material_id").eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't read the Notion links: ${error.message}`);
  const linked = new Map((data as unknown as Array<{ page_id: string; material_id: string }>).map((l) => [l.page_id, l.material_id]));
  return found.results
    .filter((p) => p.object === "page")
    .map((p) => ({ id: p.id, title: sanitize(pageTitle(p), 200).text.trim() || "Untitled", lastEdited: p.last_edited_time, materialId: linked.get(p.id) ?? null }));
}

async function readBlocks(client: Client, blockId: string, depth: number, budget: { left: number }): Promise<BlockNode[]> {
  const out: BlockNode[] = [];
  let cursor: string | null = null;
  do {
    if (budget.left <= 0) break;
    const page: NotionList<NotionBlock> = await client.get<NotionList<NotionBlock>>(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const block of page.results) {
      if (budget.left <= 0) break;
      budget.left -= 1;
      const children = block.has_children && depth < MAX_DEPTH && block.type !== "child_page" ? await readBlocks(client, block.id, depth + 1, budget) : [];
      out.push({ block, children });
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}

export interface NotionImportResult {
  pageId: string;
  title: string;
  result: "added" | "duplicate" | "already" | "empty" | "failed";
  materialId: string | null;
  error?: string;
}

/**
 * Import the pages picked, each as one text material of the type given, named after the page.
 * Pages already imported are left as they are ("already"); a page with no words is "empty".
 */
export async function importNotionPages(db: OrcaSupabase, ownerId: string, input: { courseId: string; pageIds: string[]; type: MaterialType; heldBack: boolean }, fetchImpl?: typeof fetch): Promise<NotionImportResult[]> {
  const client = await clientFor(db, ownerId, fetchImpl);
  if (!client) throw new NotionError(409, "Connect Notion in Settings first.");
  const { data, error } = await links(db).select("page_id, material_id").eq("owner_id", ownerId);
  if (error) throw new Error(`Couldn't read the Notion links: ${error.message}`);
  const linked = new Map((data as unknown as Array<{ page_id: string; material_id: string }>).map((l) => [l.page_id, l.material_id]));
  const results: NotionImportResult[] = [];
  for (const pageId of input.pageIds) {
    const already = linked.get(pageId);
    if (already) {
      results.push({ pageId, title: "", result: "already", materialId: already });
      continue;
    }
    try {
      const page = await client.get<NotionPage>(`/pages/${pageId}`);
      const title = sanitize(pageTitle(page), 200).text.trim() || "Untitled";
      const text = blocksToText(await readBlocks(client, pageId, 0, { left: MAX_BLOCKS })).trim();
      if (text.length < 40) {
        results.push({ pageId, title, result: "empty", materialId: null });
        continue;
      }
      const out = await addTextMaterial(db, ownerId, { courseId: input.courseId, type: input.type, assigned: null, due: null, text: `# ${title}\n\n${text}`, heldBack: input.heldBack, filename: `${title} (Notion)` });
      if (out.status === 201) {
        const put = await links(db).insert({ owner_id: ownerId, page_id: pageId, material_id: out.body.material.id } as never);
        if (put.error) throw new Error(`Couldn't link the Notion page: ${put.error.message}`);
        results.push({ pageId, title, result: "added", materialId: out.body.material.id });
      } else if (out.status === 200) {
        results.push({ pageId, title, result: "duplicate", materialId: out.body.duplicate.id });
      } else {
        results.push({ pageId, title, result: "failed", materialId: null, error: out.body.error });
        if (out.status === 429) break;
      }
    } catch (e) {
      if (e instanceof NotionError && e.status === 401) throw e;
      results.push({ pageId, title: "", result: "failed", materialId: null, error: e instanceof Error ? e.message : "Orca couldn't read that page." });
    }
  }
  return results;
}

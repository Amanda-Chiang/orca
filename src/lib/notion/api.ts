/**
 * Notion (owner, 2026-11-25), pure: the shapes Orca reads from Notion's API (version 2022-06-28)
 * and how a page's blocks become the text Orca stores as material. A student connects an internal
 * integration (their own token, like Canvas) and shares pages with it; Orca lists those pages and
 * imports the ones they pick.
 */

export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

export interface RichText {
  plain_text: string;
}

export interface NotionPage {
  object: "page";
  id: string;
  last_edited_time: string;
  url?: string;
  icon?: { type: string; emoji?: string } | null;
  properties: Record<string, { type: string; title?: RichText[] }>;
}

export interface NotionBlock {
  object: "block";
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

export interface NotionList<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** A page's title: the `title` property, whatever it's called. */
export function pageTitle(page: NotionPage): string {
  for (const p of Object.values(page.properties ?? {})) {
    if (p.type === "title") return (p.title ?? []).map((t) => t.plain_text).join("").trim() || "Untitled";
  }
  return "Untitled";
}

function text(block: NotionBlock): string {
  const body = block[block.type] as { rich_text?: RichText[]; caption?: RichText[]; title?: string; name?: string; url?: string; expression?: string } | undefined;
  if (!body) return "";
  if (body.rich_text) return body.rich_text.map((t) => t.plain_text).join("");
  if (body.expression) return body.expression;
  if (body.title) return body.title;
  if (body.name) return body.name;
  if (body.caption?.length) return body.caption.map((t) => t.plain_text).join("");
  return "";
}

export interface BlockNode {
  block: NotionBlock;
  children: BlockNode[];
}

/**
 * Blocks as text, one line each: headings with `#`, list items with `-` or `1.`, to-dos with `[ ]`,
 * quotes with `>`, code fenced, nested blocks indented, tables as rows with ` | `. Pictures, embeds
 * and other blocks without words are skipped. Numbered lists count up within their run.
 */
export function blocksToText(nodes: readonly BlockNode[], depth = 0): string {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  let number = 0;
  for (const { block, children } of nodes) {
    const t = text(block).trim();
    if (block.type !== "numbered_list_item") number = 0;
    let line: string | null = null;
    switch (block.type) {
      case "heading_1":
        line = `# ${t}`;
        break;
      case "heading_2":
        line = `## ${t}`;
        break;
      case "heading_3":
        line = `### ${t}`;
        break;
      case "paragraph":
      case "callout":
      case "toggle":
      case "equation":
        line = t;
        break;
      case "bulleted_list_item":
        line = `- ${t}`;
        break;
      case "numbered_list_item":
        number += 1;
        line = `${number}. ${t}`;
        break;
      case "to_do": {
        const checked = (block.to_do as { checked?: boolean } | undefined)?.checked;
        line = `[${checked ? "x" : " "}] ${t}`;
        break;
      }
      case "quote":
        line = `> ${t}`;
        break;
      case "code": {
        const lang = (block.code as { language?: string } | undefined)?.language ?? "";
        line = `\`\`\`${lang}\n${t}\n\`\`\``;
        break;
      }
      case "table_row": {
        const cells = (block.table_row as { cells?: RichText[][] } | undefined)?.cells ?? [];
        line = cells.map((c) => c.map((r) => r.plain_text).join("")).join(" | ");
        break;
      }
      case "child_page":
        line = `[Page: ${t}]`;
        break;
      case "divider":
        line = "---";
        break;
      default:
        line = t || null;
    }
    if (line !== null && line !== "") out.push(pad + line.split("\n").join(`\n${pad}`));
    if (children.length) {
      const inner = blocksToText(children, depth + 1);
      if (inner) out.push(inner);
    }
  }
  return out.join("\n");
}

/** A bare page id, from a page id with or without dashes or a Notion page URL; null otherwise. */
export function normalizePageId(input: string): string | null {
  const m = input.trim().match(/([0-9a-f]{32})(?:[^0-9a-f]|$)|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const raw = (m?.[1] ?? m?.[2])?.replace(/-/g, "").toLowerCase();
  if (!raw || raw.length !== 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

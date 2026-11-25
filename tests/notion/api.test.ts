import assert from "node:assert/strict";
import { test } from "node:test";
import { type BlockNode, type NotionBlock, type NotionPage, blocksToText, normalizePageId, pageTitle } from "../../src/lib/notion/api.ts";

const rt = (s: string) => [{ plain_text: s }];
const b = (type: string, body: Record<string, unknown>, children: BlockNode[] = []): BlockNode => ({ block: { object: "block", id: type, type, [type]: body } as NotionBlock, children });

test("blocks become readable text: headings, lists, to-dos, code, tables, nesting", () => {
  const nodes: BlockNode[] = [
    b("heading_1", { rich_text: rt("Thevenin") }),
    b("paragraph", { rich_text: rt("Zero the sources.") }),
    b("numbered_list_item", { rich_text: rt("Open current sources") }),
    b("numbered_list_item", { rich_text: rt("Short voltage sources") }, [b("bulleted_list_item", { rich_text: rt("then combine") })]),
    b("to_do", { rich_text: rt("HW09 P4"), checked: true }),
    b("code", { rich_text: rt("R = 6 || 3"), language: "plain text" }),
    b("table", {}, [b("table_row", { cells: [rt("R1"), rt("6 Ω")] })]),
    b("image", { caption: [] }),
    b("divider", {}),
    b("paragraph", { rich_text: rt("After a divider, numbering restarts:") }),
    b("numbered_list_item", { rich_text: rt("one") }),
  ];
  assert.equal(
    blocksToText(nodes),
    ["# Thevenin", "Zero the sources.", "1. Open current sources", "2. Short voltage sources", "  - then combine", "[x] HW09 P4", "```plain text\nR = 6 || 3\n```", "  R1 | 6 Ω", "---", "After a divider, numbering restarts:", "1. one"].join("\n"),
  );
});

test("a page's title is its title property, whatever it's named; ids normalise from URLs", () => {
  const page = { object: "page", id: "x", last_edited_time: "", properties: { Name: { type: "title", title: rt("Week 3 notes") } } } as NotionPage;
  assert.equal(pageTitle(page), "Week 3 notes");
  assert.equal(pageTitle({ ...page, properties: {} }), "Untitled");
  assert.equal(normalizePageId("https://www.notion.so/Week-3-0123456789abcdef0123456789abcdef?pvs=4"), "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(normalizePageId("01234567-89ab-cdef-0123-456789abcdef"), "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(normalizePageId("nope"), null);
});

/**
 * Read an uploaded Word document (.docx) on the server into the pages Orca stores. A .docx is a zip
 * of XML with no fixed pages, so the body is read in document order (paragraphs, and tables row by
 * row with their cells joined by " | ") and cut into pages: at explicit page breaks when the
 * document has any, otherwise before each Heading 1 / Heading 2 (or Title); either way a page that
 * runs past about a printed page (`PAGE_CHARS`) is cut at the next paragraph. Footnotes and endnotes
 * are added to the page that cites them. Not read: comments, headers and footers, text boxes,
 * pictures and charts. Like the .pptx reader, hidden text (`w:vanish`) and text under 2 pt are
 * dropped and counted, every page is sanitised, and a document over `LIMITS.pagesPerFile` pages is
 * refused. No model is involved. Loads under plain Node.
 */
import { LIMITS } from "../limits.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import { attr, decode } from "./ooxml.ts";
import { type HiddenText, type ReadPage, UnreadablePdfError } from "./read-pdf.ts";
import { ZipError, looksLikeZip, openZip } from "./unzip.ts";

export interface ReadDocx {
  pages: ReadPage[];
  hidden: HiddenText;
  removed: number;
}

/** Text under this size (half-points, as `w:sz` stores it: 4 = 2 pt) is too small to see. */
const MIN_VISIBLE_SZ = 4;
/** About a printed page of text: a page past this is cut at the next paragraph. */
export const PAGE_CHARS = 3000;
/** Marks an explicit page break inside a paragraph's text. */
const BREAK = "\f";

const NOT_WORD = "This file isn't a Word (.docx) document.";

/**
 * The elements named `name` in `xml`, outermost only (one nested in a match is part of it), in
 * order. Elements of other names around them are looked through (a content control's paragraphs).
 */
function elements(xml: string, name: string): string[] {
  const out: string[] = [];
  const tag = new RegExp(`<(/?)${name}(?:\\s[^>]*?)?(/?)>`, "g");
  let depth = 0;
  let start = 0;
  for (const m of xml.matchAll(tag)) {
    const [whole, close, selfClosing] = m;
    const at = m.index ?? 0;
    if (close) {
      if (depth && --depth === 0) out.push(xml.slice(start, at + whole.length));
    } else if (selfClosing) {
      if (!depth) out.push(whole);
    } else if (depth++ === 0) start = at;
  }
  return out;
}

/** The body's blocks in order: paragraphs and tables (a table's own paragraphs stay inside it). */
function blocks(xml: string): string[] {
  const out: Array<{ at: number; xml: string }> = [];
  for (const name of ["w:p", "w:tbl"]) {
    let from = 0;
    for (const el of elements(xml, name)) {
      const at = xml.indexOf(el, from);
      from = at + el.length;
      out.push({ at, xml: el });
    }
  }
  // A paragraph found inside a table belongs to the table.
  out.sort((a, b) => a.at - b.at);
  const kept: typeof out = [];
  for (const b of out) {
    const last = kept[kept.length - 1];
    if (last && b.at < last.at + last.xml.length) continue;
    kept.push(b);
  }
  return kept.map((b) => b.xml);
}

interface Reading {
  hidden: number;
  /** Footnotes and endnotes the text cites, in order, each with the label it shows. */
  cites: Array<{ kind: "footnote" | "endnote"; id: string; label: string }>;
  /** How many of each the document has cited so far (shared by every block). */
  counts: { footnote: number; endnote: number };
}

/** A paragraph's visible text; an explicit page break is `BREAK`. */
function paragraphText(p: string, r: Reading): string {
  // Pictures, charts and text boxes aren't read (their XML can hold paragraphs of its own).
  const body = p.replace(/<(w:drawing|w:pict|mc:AlternateContent|w:object)\b[\s\S]*?<\/\1>/g, "");
  let line = /<w:pageBreakBefore(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(body.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? "") ? BREAK : "";
  for (const run of elements(body, "w:r")) {
    const props = run.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    const vanish = /<w:vanish(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(props);
    const size = Number(attr(props.match(/<w:sz\b[^>]*>/)?.[0] ?? "", "w:val") ?? NaN);
    let text = "";
    for (const [piece] of run.matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:(?:tab|br|cr|footnoteReference|endnoteReference)\b[^>]*\/>/g)) {
      if (piece.startsWith("<w:t>") || piece.startsWith("<w:t ")) text += decode(piece.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, ""));
      else if (piece.startsWith("<w:tab")) text += "\t";
      else if (piece.startsWith("<w:br")) text += attr(piece, "w:type") === "page" ? BREAK : attr(piece, "w:type") === "column" ? "" : "\n";
      else if (piece.startsWith("<w:cr")) text += "\n";
      else {
        const kind = piece.startsWith("<w:footnote") ? "footnote" : "endnote";
        const id = attr(piece, "w:id");
        if (id && !vanish) {
          const label = `${kind === "footnote" ? "" : "e"}${++r.counts[kind]}`;
          r.cites.push({ kind, id, label });
          text += `[${label}]`;
        }
      }
    }
    if (!text.replace(new RegExp(`[\\s${BREAK}]`, "g"), "")) {
      line += text;
      continue;
    }
    if (vanish || size < MIN_VISIBLE_SZ) {
      r.hidden++;
      continue;
    }
    line += text;
  }
  return line;
}

/** A table, a row to a line, its cells joined with " | " (a table in a cell is read inline). */
function tableText(tbl: string, r: Reading): string[] {
  const lines: string[] = [];
  for (const row of elements(tbl, "w:tr")) {
    const cells = elements(row, "w:tc").map((cell) =>
      blocks(cell)
        .map((b) => (b.startsWith("<w:tbl") ? tableText(b, r).join(" ") : paragraphText(b, r)))
        .join(" ")
        .replaceAll(BREAK, " ")
        .trim(),
    );
    if (cells.some((c) => c)) lines.push(cells.join(" | "));
  }
  return lines;
}

/** Style ids that start a section: Title, Heading 1 and Heading 2 (by style name or outline level). */
function headingStyles(stylesXml: string | null): Set<string> {
  const ids = new Set(["Title", "Heading1", "Heading2"]);
  for (const style of elements(stylesXml ?? "", "w:style")) {
    const id = attr(style.match(/<w:style\b[^>]*>/)?.[0] ?? "", "w:styleId");
    const name = (attr(style.match(/<w:name\b[^>]*>/)?.[0] ?? "", "w:val") ?? "").toLowerCase();
    const level = attr(style.match(/<w:outlineLvl\b[^>]*>/)?.[0] ?? "", "w:val");
    if (id && (["title", "heading 1", "heading 2"].includes(name) || level === "0" || level === "1")) ids.add(id);
  }
  return ids;
}

/** Footnotes or endnotes by id (the separator notes Word writes are left out). */
function notes(xml: string | null, tag: "w:footnote" | "w:endnote", r: Reading): Map<string, string> {
  const out = new Map<string, string>();
  for (const note of elements(xml ?? "", tag)) {
    const open = note.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
    const id = attr(open, "w:id");
    if (!id || attr(open, "w:type")) continue;
    const text = blocks(note)
      .map((b) => (b.startsWith("<w:tbl") ? tableText(b, r).join("\n") : paragraphText(b, r)))
      .join(" ")
      .replaceAll(BREAK, " ")
      .trim();
    if (text) out.set(id, text);
  }
  return out;
}

export async function readDocx(bytes: Uint8Array): Promise<ReadDocx> {
  if (bytes.byteLength > LIMITS.uploadBytes) throw new UnreadablePdfError(`This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.`, 413);
  if (!looksLikeZip(bytes)) throw new UnreadablePdfError(NOT_WORD, 415);
  try {
    const zip = openZip(bytes);
    const document = zip.text("word/document.xml");
    if (!document) throw new UnreadablePdfError(NOT_WORD, 415);
    const body = document.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? "";
    const headings = headingStyles(zip.text("word/styles.xml"));

    // Each block's lines, the page it lands on, and the notes it cites.
    interface Block {
      lines: string[];
      heading: boolean;
      hidden: number;
      cites: Reading["cites"];
    }
    const read: Block[] = [];
    let explicitBreaks = false;
    const counts = { footnote: 0, endnote: 0 };
    for (const b of blocks(body)) {
      const r: Reading = { hidden: 0, cites: [], counts };
      if (b.startsWith("<w:tbl")) {
        read.push({ lines: tableText(b, r), heading: false, hidden: r.hidden, cites: r.cites });
        continue;
      }
      const style = attr(b.match(/<w:pStyle\b[^>]*>/)?.[0] ?? "", "w:val");
      const text = paragraphText(b, r);
      if (text.includes(BREAK)) explicitBreaks = true;
      // A paragraph with a page break in it: the text before goes on this page, the rest on the next.
      text.split(BREAK).forEach((piece, i) => {
        if (i > 0) read.push({ lines: [BREAK], heading: false, hidden: 0, cites: [] });
        read.push({ lines: piece.trim() ? [piece] : [], heading: !!style && headings.has(style) && !!piece.trim(), hidden: i ? 0 : r.hidden, cites: i ? [] : r.cites });
      });
    }

    const r: Reading = { hidden: 0, cites: [], counts: { footnote: 0, endnote: 0 } };
    const footnotes = notes(zip.text("word/footnotes.xml"), "w:footnote", r);
    const endnotes = notes(zip.text("word/endnotes.xml"), "w:endnote", r);

    // Cut into pages: at explicit breaks if there are any, else before headings; never past PAGE_CHARS.
    const pages: Array<{ lines: string[]; hidden: number; cites: Reading["cites"]; onlyHeadings: boolean }> = [];
    let page = { lines: [] as string[], hidden: 0, cites: [] as Reading["cites"], onlyHeadings: true };
    const size = () => page.lines.reduce((n, l) => n + l.length + 1, 0);
    const cut = () => {
      if (page.lines.length || page.hidden) pages.push(page);
      page = { lines: [], hidden: 0, cites: [], onlyHeadings: true };
    };
    for (const b of read) {
      if (b.lines[0] === BREAK) {
        cut();
        continue;
      }
      const startsSection = !explicitBreaks && b.heading && !page.onlyHeadings;
      if (b.lines.length && page.lines.length && (startsSection || size() >= PAGE_CHARS)) cut();
      page.lines.push(...b.lines);
      page.hidden += b.hidden;
      page.cites.push(...b.cites);
      if (b.lines.length && !b.heading) page.onlyHeadings = false;
    }
    cut();
    const withText = pages.filter((p) => p.lines.some((l) => l.trim()));
    if (!withText.length) throw new UnreadablePdfError("This document has no text Orca can read.", 422);
    if (withText.length > LIMITS.pagesPerFile) {
      throw new UnreadablePdfError(`This document runs to ${withText.length} pages; Orca reads at most ${LIMITS.pagesPerFile} per file. Split it and upload the parts.`, 413);
    }

    const out: ReadPage[] = [];
    const hidden: HiddenText = { items: 0, pages: [] };
    let removed = 0;
    pages.forEach((p) => {
      const blank = !p.lines.some((l) => l.trim());
      // A page with only hidden text still counts it, on the page before (or the first).
      if (blank) {
        hidden.items += p.hidden;
        const n = Math.max(out.length, 1);
        if (p.hidden && !hidden.pages.includes(n)) hidden.pages.push(n);
        return;
      }
      const n = out.length + 1;
      if (p.hidden) {
        hidden.items += p.hidden;
        if (!hidden.pages.includes(n)) hidden.pages.push(n);
      }
      const cited = p.cites
        .map((c) => {
          const text = (c.kind === "footnote" ? footnotes : endnotes).get(c.id);
          return text ? `[${c.label}] ${text}` : null;
        })
        .filter((l): l is string => !!l);
      const text = [p.lines.join("\n").trim(), ...(cited.length ? ["", "[Notes]", ...cited] : [])].join("\n");
      const clean = sanitize(text);
      removed += clean.removed;
      out.push({ n, text: clean.text });
    });
    if (r.hidden) {
      hidden.items += r.hidden;
      if (!hidden.pages.length) hidden.pages.push(1);
    }
    hidden.pages.sort((a, b) => a - b);
    return { pages: out, hidden, removed };
  } catch (e) {
    if (e instanceof ZipError) throw new UnreadablePdfError(`Orca couldn't read this document (${e.message}).`);
    throw e;
  }
}

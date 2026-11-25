/**
 * What the .pptx and .docx readers share: Office files are zips of XML, read here without an XML
 * library (entity decoding, attributes, a part's relationships), and the kind of Office file a zip
 * is, from what's inside it. Loads under plain Node.
 */
import { UnreadablePdfError } from "./read-pdf.ts";
import { type Zip, ZipError, openZip } from "./unzip.ts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text with its entities decoded. */
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? whole;
  });
}

/** An attribute's raw value in a start tag, or null. */
export const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

/** A part's relationships: id → target path inside the archive (resolved against the part's folder). */
export function relationships(zip: Zip, part: string): Array<{ id: string; type: string; target: string }> {
  const slash = part.lastIndexOf("/");
  const folder = part.slice(0, slash);
  const xml = zip.text(`${folder}/_rels/${part.slice(slash + 1)}.rels`);
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => {
    const target = attr(tag, "Target") ?? "";
    const parts = target.startsWith("/") ? target.slice(1).split("/") : [...folder.split("/"), ...target.split("/")];
    const path: string[] = [];
    for (const p of parts) {
      if (p === "..") path.pop();
      else if (p && p !== ".") path.push(p);
    }
    return { id: attr(tag, "Id") ?? "", type: attr(tag, "Type") ?? "", target: path.join("/") };
  });
}

/**
 * Which Office file a zip is, from its main part (a .docx and a .pptx are both zips): a Word
 * document, a PowerPoint deck, or null for any other zip. A damaged archive is refused here.
 */
export function officeKind(bytes: Uint8Array): "docx" | "pptx" | null {
  try {
    const zip = openZip(bytes);
    if (zip.has("word/document.xml")) return "docx";
    if (zip.has("ppt/presentation.xml")) return "pptx";
    return null;
  } catch (e) {
    if (e instanceof ZipError) throw new UnreadablePdfError(`Orca couldn't read this file (${e.message}).`);
    throw e;
  }
}

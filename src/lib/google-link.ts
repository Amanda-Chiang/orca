/**
 * Google Docs, Slides and Drive share links (owner, 2026-11-25), pure: what a pasted link points at
 * and where Google serves it as a file Orca can read (a PDF export for a Doc or Slides deck; the
 * file itself from Drive). Only files shared "anyone with the link" come through; the route says so
 * when Google answers with a sign-in page instead.
 */
export type GoogleKind = "doc" | "slides" | "sheet" | "drive";

export interface GoogleLink {
  kind: GoogleKind;
  id: string;
  /** Where to fetch the file (no credentials). */
  exportUrl: string;
  /** What to call the material if Google names nothing. */
  fallbackName: string;
}

const ID = "([A-Za-z0-9_-]{10,})";

export function isGoogleHost(host: string): boolean {
  return host === "docs.google.com" || host === "drive.google.com";
}

/** The link's target, or null when it isn't a Google Docs, Slides or Drive file link. */
export function parseGoogleLink(input: string): GoogleLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isGoogleHost(url.hostname)) return null;
  const path = url.pathname;
  let m: RegExpMatchArray | null;
  if ((m = path.match(new RegExp(`^/document/d/${ID}`)))) {
    return { kind: "doc", id: m[1], exportUrl: `https://docs.google.com/document/d/${m[1]}/export?format=pdf`, fallbackName: `Google Doc ${m[1].slice(0, 8)}.pdf` };
  }
  if ((m = path.match(new RegExp(`^/presentation/d/${ID}`)))) {
    return { kind: "slides", id: m[1], exportUrl: `https://docs.google.com/presentation/d/${m[1]}/export/pdf`, fallbackName: `Google Slides ${m[1].slice(0, 8)}.pdf` };
  }
  if ((m = path.match(new RegExp(`^/spreadsheets/d/${ID}`)))) {
    return { kind: "sheet", id: m[1], exportUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=pdf`, fallbackName: `Google Sheet ${m[1].slice(0, 8)}.pdf` };
  }
  if ((m = path.match(new RegExp(`^/file/d/${ID}`)))) {
    return { kind: "drive", id: m[1], exportUrl: `https://drive.google.com/uc?export=download&id=${m[1]}`, fallbackName: `Drive file ${m[1].slice(0, 8)}` };
  }
  if (url.hostname === "drive.google.com" && (path === "/open" || path === "/uc")) {
    const id = url.searchParams.get("id");
    if (id && new RegExp(`^${ID}$`).test(id)) return { kind: "drive", id, exportUrl: `https://drive.google.com/uc?export=download&id=${id}`, fallbackName: `Drive file ${id.slice(0, 8)}` };
  }
  return null;
}

/** The file name Google sends, from a Content-Disposition header; null when it sends none. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")) || null;
    } catch {
      /* fall through to the plain name */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/);
  return plain ? plain[1].trim() || null : null;
}

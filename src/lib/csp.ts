/**
 * The Content-Security-Policy `src/proxy.ts` sends with every page. Generated text (questions,
 * objectives, notes) is only ever rendered as React text, and this is the second layer: injected
 * markup couldn't run even if it slipped through. Scripts need the per-request nonce (Next puts it
 * on its own scripts); styles allow inline because React and `motion` write style attributes.
 * Nothing may frame Orca (it frames only Google's Drive picker), and forms post only to this site. Pure, so `npm test` covers it.
 *
 * Browser-direct model calls (Settings → "Your AI") are not allowed here; Phase 4 removes them.
 */
export function contentSecurityPolicy(opts: { nonce: string; supabaseUrl?: string; dev: boolean }): string {
  const connect = ["'self'"];
  const img = ["'self'", "blob:", "data:"];
  if (opts.supabaseUrl) {
    const u = new URL(opts.supabaseUrl);
    connect.push(u.origin, `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`);
    // Slide previews are signed URLs into the project's own private Storage (2026-11-24).
    img.push(u.origin);
  }
  if (opts.dev) connect.push("ws:", "http://localhost:*", "http://127.0.0.1:*");
  // Google's Drive picker (Add material, 2026-11-27): its script loads under 'strict-dynamic' from
  // our own nonce'd code; it draws in a frame from docs.google.com and talks to Google's APIs.
  connect.push("https://apis.google.com", "https://content.googleapis.com", "https://www.googleapis.com");
  img.push("https://*.googleusercontent.com", "https://ssl.gstatic.com", "https://www.gstatic.com", "https://drive-thirdparty.googleusercontent.com");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": img,
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-src": ["'self'", "https://docs.google.com", "https://drive.google.com", "https://content.googleapis.com", "https://accounts.google.com"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, ConnectionTile, SetupDialog } from "./ConnectionTile";

interface Status {
  connected: boolean;
  baseUrl: string | null;
  canvasUser: string | null;
  lastUsedAt: string | null;
}

export const DEFAULT_CANVAS_SITE = "https://courseworks2.columbia.edu";

const field = "h-[40px] w-full rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[14px] font-semibold text-prussian outline-none focus:border-wisteria";

/**
 * Settings → Canvas: the student's Canvas site and access token (`/api/canvas`), entered in a pop-up.
 * Connected, every course can be imported from `/import/canvas` instead of uploaded file by file.
 */
export function CanvasConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [site, setSite] = useState(DEFAULT_CANVAS_SITE);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The site-and-token form, in a pop-up so the tile stays small. */
  const [setup, setSetup] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/canvas", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the Canvas connection.");
      const s = (await res.json()) as Status;
      setStatus(s);
      if (s.baseUrl) setSite(s.baseUrl);
    })();
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/canvas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: site, token }) });
      const body = (await res.json()) as { canvasUser?: string; error?: string };
      if (!res.ok) return setProblem(body.error ?? "Couldn't connect Canvas.");
      setToken("");
      setSetup(false);
      setStatus({ connected: true, baseUrl: site, canvasUser: body.canvasUser ?? null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  // Disconnect asks first: the owner hit it by accident while testing (2026-11-07), and reconnecting
  // needs a new token from Canvas, since the old one is never shown again.
  const [confirming, setConfirming] = useState(false);
  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/canvas", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setStatus({ connected: false, baseUrl: null, canvasUser: null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <ConnectionTile
      title="Canvas"
      info="Connect CourseWorks and Orca pulls each course's slides, assignments and exam dates itself. No uploading."
      data-part="canvas-connection"
      status={
        status?.connected ? (
          <span data-part="canvas-status">Connected{status.canvasUser ? ` as ${status.canvasUser}` : ""} to {status.baseUrl}.</span>
        ) : (
          <span data-part="canvas-status">{status === null ? "…" : "Not connected."}</span>
        )
      }
      actions={
        status?.connected ? (
          <>
            <Link href="/import/canvas" className="pressable inline-flex items-center rounded-[16px] bg-wisteria px-4 py-2 text-[14px] font-bold text-parchment lip-4 lip-wisteria" data-part="canvas-import-link">
              Import a course
            </Link>
            {!confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="canvas-disconnect">
                Disconnect
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" onClick={() => setSetup(true)} disabled={status === null} data-part="canvas-setup">
            Connect Canvas
          </Button>
        )
      }
      confirm={
        status?.connected && confirming ? (
          <ConfirmRow data-part="canvas-disconnect-confirm">
            <span className="text-[13px] font-semibold text-prussian">Disconnect Canvas? Reconnecting needs a new access token.</span>
            <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={busy} data-part="canvas-disconnect-yes">
              Yes, disconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy} data-part="canvas-disconnect-cancel">
              Keep it
            </Button>
          </ConfirmRow>
        ) : undefined
      }
      problem={setup ? null : problem}
    />
    <SetupDialog open={setup} title="Connect Canvas" onClose={() => setSetup(false)} data-part="canvas-setup-dialog">
      <form
        className="flex flex-col gap-[10px]"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold text-wisteria-deep">
          Canvas site
          <input id="canvas-site" className={field} value={site} onChange={(e) => setSite(e.target.value)} placeholder={DEFAULT_CANVAS_SITE} data-part="canvas-site" />
        </label>
        <label className="flex flex-col gap-[4px] text-[12px] font-semibold text-wisteria-deep">
          Access token
          <input id="canvas-token" className={field} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Paste the token" data-part="canvas-token" />
        </label>
        <p className="text-[12px] font-medium text-wisteria-deep">
          In Canvas: Account → Settings → Approved Integrations → <b>New Access Token</b>. Orca stores it encrypted and only uses it to read your courses.
        </p>
        <div className="flex items-center gap-[10px]">
          <Button size="sm" type="submit" disabled={busy || status === null || !token.trim()} data-part="canvas-connect">
            {busy ? "Checking…" : "Connect Canvas"}
          </Button>
        </div>
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </form>
    </SetupDialog>
    </>
  );
}

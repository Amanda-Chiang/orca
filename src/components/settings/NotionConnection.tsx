"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, ConnectionTile, SetupDialog } from "./ConnectionTile";

interface Status {
  connected: boolean;
  workspaceName: string | null;
  botName: string | null;
  lastUsedAt: string | null;
}

const field = "h-[40px] w-full rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[14px] font-semibold text-prussian outline-none focus:border-wisteria";

/**
 * Settings → Notion (2026-11-25): the student's internal-integration secret (`/api/notion`).
 * Connected, the pages they share with the integration can be imported from `/import/notion`.
 */
export function NotionConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** The steps and the secret, in a pop-up so the tile stays small. */
  const [setup, setSetup] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/notion", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the Notion connection.");
      setStatus((await res.json()) as Status);
    })();
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/notion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await res.json()) as { workspaceName?: string | null; botName?: string | null; error?: string };
      if (!res.ok) return setProblem(body.error ?? "Couldn't connect Notion.");
      setToken("");
      setSetup(false);
      setStatus({ connected: true, workspaceName: body.workspaceName ?? null, botName: body.botName ?? null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/notion", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setStatus({ connected: false, workspaceName: null, botName: null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ConnectionTile
        title="Notion"
        info="Keep your notes in Notion? Connect it and pick the pages Orca should read; each becomes material for a course. Share a page with the integration in Notion (··· → Connections) and it shows up on the import page."
        data-part="notion-connection"
        status={
          <span data-part="notion-status">
            {status === null ? "…" : status.connected ? `Connected${status.workspaceName ? ` to ${status.workspaceName}` : ""}${status.botName ? ` as ${status.botName}` : ""}.` : "Not connected."}
          </span>
        }
        actions={
          status?.connected ? (
            <>
              <Link href="/import/notion" className="pressable inline-flex items-center rounded-[16px] bg-wisteria px-4 py-2 text-[14px] font-bold text-parchment lip-4 lip-wisteria" data-part="notion-import-link">
                Import pages
              </Link>
              {!confirming && (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="notion-revoke">
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" onClick={() => setSetup(true)} disabled={status === null} data-part="notion-setup">
              Connect Notion
            </Button>
          )
        }
        confirm={
          status?.connected && confirming ? (
            <ConfirmRow>
              <span className="text-[13px] font-semibold text-prussian">Disconnect Notion? Imported pages stay.</span>
              <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={busy} data-part="notion-revoke-yes">
                Yes, disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </Button>
            </ConfirmRow>
          ) : undefined
        }
        problem={setup ? null : problem}
      />
      <SetupDialog open={setup} title="Connect Notion" onClose={() => setSetup(false)} data-part="notion-setup-dialog">
        <ol className="flex list-decimal flex-col gap-[2px] pl-[18px] text-[13px] font-medium text-prussian">
          <li>In Notion, open notion.so/profile/integrations and make a new internal integration (any name; Read content is enough).</li>
          <li>Copy its secret and paste it here.</li>
          <li>On each page Orca should read: ··· → Connections → add the integration.</li>
        </ol>
        <label className="flex flex-col gap-[5px] text-[13px] font-semibold text-wisteria-deep">
          Integration secret
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ntn_…" autoComplete="off" className={field} data-part="notion-token" />
        </label>
        <div className="flex flex-wrap items-center gap-[10px]">
          <Button size="sm" onClick={() => void connect()} disabled={busy || status === null || !token.trim()} data-part="notion-connect">
            Connect Notion
          </Button>
          <span className="text-[13px] font-medium text-wisteria-deep">Stored encrypted; never shown again.</span>
        </div>
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </SetupDialog>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, ConnectionTile, SetupDialog } from "./ConnectionTile";

interface Status {
  connected: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Settings → AI connector: one secret link per student that their AI (Claude or ChatGPT) calls while
 * they study in a chat (`/api/connector`). The link is shown once, in a pop-up; making a new one replaces the old.
 */
export function ClaudeConnectorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/connector", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the connector.");
      setStatus((await res.json()) as Status);
    })();
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try {
      const res = await fetch("/api/connector", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) return setProblem(body.error ?? "Couldn't make a connector link.");
      setUrl(body.url);
      setStatus({ connected: true, createdAt: new Date().toISOString(), lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  // Disconnect asks first (as the Canvas card does): the link stops working at once and Claude
  // would need a new one pasted in.
  const [confirming, setConfirming] = useState(false);
  const revoke = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/connector", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setUrl(null);
      setStatus({ connected: false, createdAt: null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setProblem("Select the link and copy it by hand.");
    }
  };

  return (
    <>
      <ConnectionTile
        id="connector"
        title="AI connector"
        info="Works with Claude and ChatGPT. Study in the chat you already use; it knows what each exam covers and what you're weak on, and every answer it grades goes on your record here."
        data-part="claude-connector"
        status={
          <span data-part="connector-status">
            {status === null ? "…" : status.connected ? `Connected${status.lastUsedAt ? `, last used ${new Date(status.lastUsedAt).toLocaleDateString()}` : ", not used yet"}.` : "Not connected."}
          </span>
        }
        actions={
          <>
            <Button size="sm" onClick={() => void create()} disabled={busy || status === null} data-part="connector-create">
              {status?.connected ? "Make a new link" : "Connect your AI"}
            </Button>
            {status?.connected && !confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="connector-revoke">
                Disconnect
              </Button>
            )}
          </>
        }
        confirm={
          status?.connected && confirming ? (
            <ConfirmRow data-part="connector-revoke-confirm">
              <span className="text-[13px] font-semibold text-prussian">Disconnect? The link stops working at once.</span>
              <Button size="sm" variant="danger" onClick={() => void revoke()} disabled={busy} data-part="connector-revoke-yes">
                Yes, disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy} data-part="connector-revoke-cancel">
                Keep it
              </Button>
            </ConfirmRow>
          ) : undefined
        }
        problem={url ? null : problem}
      />
      {/* The new link, shown once, in a pop-up with where to paste it. */}
      <SetupDialog open={url !== null} title="Your AI connector link" onClose={() => setUrl(null)} data-part="connector-link">
        <p className="text-[13px] font-semibold text-prussian">Shown once. Paste it as the connector URL, no sign-in:</p>
        <ul className="flex flex-col gap-[2px] text-[13px] font-medium text-prussian" data-part="connector-steps">
          <li><b>Claude:</b> Settings → Connectors → Add custom connector.</li>
          <li><b>ChatGPT:</b> Settings → Connectors → Create (turn on developer mode first), paste it as the MCP server URL.</li>
        </ul>
        <code className="break-all rounded-[12px] border-2 border-alice-deep bg-alice px-[12px] py-[8px] text-[12px] text-prussian" data-part="connector-url">{url}</code>
        <div className="flex items-center gap-[10px]">
          <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button>
          <span className="text-[13px] font-medium text-wisteria-deep">Anyone with this link can read and change your study record. Keep it to yourself.</span>
        </div>
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </SetupDialog>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmRow, ConnectionTile, SetupDialog } from "./ConnectionTile";

interface Status {
  connected: boolean;
}

/**
 * Settings → Calendar (2026-11-25): a subscription link (`/api/calendar-feed`) that Google Calendar
 * or Apple Calendar polls for exams, due dates, class meetings and review days. Shown once; making
 * a new one replaces the old.
 */
export function CalendarFeedCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/calendar-feed", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the calendar feed.");
      setStatus((await res.json()) as Status);
    })();
    return () => {
      live = false;
    };
  }, []);

  const make = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try {
      const res = await fetch("/api/calendar-feed", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) return setProblem(body.error ?? "Couldn't make a calendar link.");
      setUrl(body.url);
      setStatus({ connected: true });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/calendar-feed", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't stop the feed.");
      setConfirming(false);
      setUrl(null);
      setStatus({ connected: false });
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
        title="Google or Apple Calendar"
        info="Your exams, due dates, class times and review days in the calendar you already check, kept in sync. One link to subscribe to."
        data-part="calendar-feed"
        status={
          <span data-part="calendar-feed-status">
            {status === null ? "…" : status.connected ? "Subscribed. Calendar apps refresh every few hours." : "Not set up."}
          </span>
        }
        actions={
          <>
            <Button size="sm" onClick={() => void make()} disabled={busy || status === null} data-part="calendar-feed-create">
              {status?.connected ? "Make a new link" : "Get the link"}
            </Button>
            {status?.connected && !confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="calendar-feed-revoke">
                Stop the feed
              </Button>
            )}
          </>
        }
        confirm={
          status?.connected && confirming ? (
            <ConfirmRow>
              <span className="text-[13px] font-semibold text-prussian">Stop the feed? The link stops working at once.</span>
              <Button size="sm" variant="danger" onClick={() => void stop()} disabled={busy} data-part="calendar-feed-revoke-yes">
                Yes, stop it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </Button>
            </ConfirmRow>
          ) : undefined
        }
        problem={url ? null : problem}
      />
      <SetupDialog open={url !== null} title="Your calendar link" onClose={() => setUrl(null)} data-part="calendar-feed-link">
        <p className="text-[13px] font-semibold text-prussian">Shown once. Google Calendar: Other calendars → + → From URL. Apple Calendar: File → New Calendar Subscription.</p>
        <code className="break-all rounded-[12px] border-2 border-alice-deep bg-alice px-[12px] py-[8px] text-[12px] text-prussian" data-part="calendar-feed-url">{url}</code>
        <div className="flex items-center gap-[10px]">
          <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button>
          <span className="text-[13px] font-medium text-wisteria-deep">Anyone with this link can see your schedule. Keep it to yourself.</span>
        </div>
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </SetupDialog>
    </>
  );
}

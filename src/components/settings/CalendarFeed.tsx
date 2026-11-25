"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]" data-part="calendar-feed">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Google or Apple Calendar</h2>
        <p className="text-[14px] font-medium text-wisteria-deep">Your exams, due dates, class times and review days in the calendar you already check, kept in sync. One link to subscribe to.</p>
      </div>
      {url ? (
        <div className="flex flex-col gap-[8px]" data-part="calendar-feed-link">
          <p className="text-[13px] font-semibold text-prussian">Your link, shown once. Google Calendar: Other calendars → + → From URL. Apple Calendar: File → New Calendar Subscription.</p>
          <code className="break-all rounded-[12px] border-2 border-alice-deep bg-alice px-[12px] py-[8px] text-[12px] text-prussian" data-part="calendar-feed-url">{url}</code>
          <div className="flex items-center gap-[10px]">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button>
            <span className="text-[13px] font-medium text-wisteria-deep">Anyone with this link can see your schedule. Keep it to yourself.</span>
          </div>
        </div>
      ) : (
        <p className="text-[13px] font-semibold text-prussian" data-part="calendar-feed-status">
          {status === null ? "…" : status.connected ? "Subscribed. Calendar apps refresh a feed every few hours." : "Not set up."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-[10px]">
        <Button size="sm" onClick={() => void make()} disabled={busy || status === null} data-part="calendar-feed-create">
          {status?.connected ? "Make a new link" : "Get the link"}
        </Button>
        {status?.connected && !confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="calendar-feed-revoke">
            Stop the feed
          </Button>
        )}
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </div>
      {status?.connected && confirming && (
        <div className="flex flex-wrap items-center gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]">
          <span className="text-[13px] font-semibold text-prussian">Stop the feed? The link stops working at once; your calendar keeps nothing new.</span>
          <Button size="sm" variant="danger" onClick={() => void stop()} disabled={busy} data-part="calendar-feed-revoke-yes">
            Yes, stop it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Keep it
          </Button>
        </div>
      )}
    </Card>
  );
}

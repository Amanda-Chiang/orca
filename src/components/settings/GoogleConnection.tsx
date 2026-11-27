"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { GoogleStatus } from "@/lib/server/google";

const OUTCOME: Record<string, string> = {
  denied: "Google didn't grant access. Try again and leave the permission ticked.",
  error: "Google sign-in didn't finish. Try again.",
  reconnect: "Google no longer accepts Orca's access. Connect again.",
  unconfigured: "Google isn't set up on this server yet.",
  busy: "Too many tries. Wait a few minutes.",
};

export function connectGoogleUrl(feature: "calendar" | "drive", next: string): string {
  return `/api/google/connect?feature=${feature}&next=${encodeURIComponent(next)}`;
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

/**
 * Settings → Connections → Google (2026-11-27): sign in with Google for Calendar (an "Orca" calendar
 * Orca keeps in sync) and Drive (pick files on Add material). Each asks only for its own permission.
 */
export function GoogleConnectionCard() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/google", { cache: "no-store" });
    if (!res.ok) return setProblem("Couldn't read the Google connection.");
    setStatus((await res.json()) as GoogleStatus);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      await load();
      if (!live) return;
      // What Google's redirect came back with, said once, then dropped from the URL.
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("google");
      if (!outcome) return;
      const feature = url.searchParams.get("googleFeature");
      if (outcome === "connected") setNotice(feature === "calendar" ? "Google Calendar connected. Look for the Orca calendar." : "Google Drive connected.");
      else setProblem(OUTCOME[outcome] ?? OUTCOME.error);
      url.searchParams.delete("google");
      url.searchParams.delete("googleFeature");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const here = "/settings?section=connections";

  const sync = async () => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const res = await fetch("/api/google/calendar/sync", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; total?: number };
      if (!res.ok) setProblem(body.error ?? "The sync failed.");
      else setNotice(`Synced ${body.total ?? 0} events.`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/google", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ removeCalendar: true }) });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setNotice(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) return null;
  const connected = status ? status.calendar.connected || status.drive.connected : false;

  return (
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]" data-part="google-connection">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Google</h2>
        {status?.email && <p className="text-[13px] font-semibold text-wisteria-deep" data-part="google-email">{status.email}</p>}
      </div>
      {status === null ? (
        <p className="text-[13px] font-medium text-wisteria-deep">Loading…</p>
      ) : (
        <>
          {status.needsReconnect && <p className="text-[13px] font-semibold text-bad-text">Google no longer accepts Orca&apos;s access. Connect again.</p>}
          <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]" data-part="google-calendar">
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-prussian">Google Calendar</span>
              <span className="text-[13px] font-medium text-wisteria-deep">
                {status.calendar.connected
                  ? status.calendar.error
                    ? status.calendar.error
                    : status.calendar.syncedAt
                      ? `Orca calendar synced ${ago(status.calendar.syncedAt)}`
                      : "Not synced yet"
                  : "Exams, due dates, classes and review days in an Orca calendar"}
              </span>
            </div>
            {status.calendar.connected ? (
              <Button size="sm" variant="ghost" onClick={() => void sync()} disabled={busy} data-part="google-calendar-sync">
                Sync now
              </Button>
            ) : (
              <a href={connectGoogleUrl("calendar", here)} className="pressable inline-flex items-center rounded-[16px] bg-wisteria px-4 py-2 text-[14px] font-bold text-parchment lip-4 lip-wisteria" data-part="google-calendar-connect">
                Connect
              </a>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]" data-part="google-drive">
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-prussian">Google Drive</span>
              <span className="text-[13px] font-medium text-wisteria-deep">{status.drive.connected ? "Pick files from Drive on Add material" : "Add Docs, Slides and PDFs from your Drive"}</span>
            </div>
            {!status.drive.connected && (
              <a href={connectGoogleUrl("drive", here)} className="pressable inline-flex items-center rounded-[16px] bg-wisteria px-4 py-2 text-[14px] font-bold text-parchment lip-4 lip-wisteria" data-part="google-drive-connect">
                Connect
              </a>
            )}
          </div>
          {(connected || status.needsReconnect) && !confirming && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="google-revoke">
                Disconnect Google
              </Button>
            </div>
          )}
          {confirming && (
            <div className="flex flex-wrap items-center gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]">
              <span className="text-[13px] font-semibold text-prussian">Disconnect Google? The Orca calendar is removed from Google Calendar; files already added stay.</span>
              <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={busy} data-part="google-revoke-yes">
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep
              </Button>
            </div>
          )}
        </>
      )}
      {notice && <p className="text-[13px] font-semibold text-prussian" data-part="google-notice">{notice}</p>}
      {problem && <p className="text-[13px] font-semibold text-bad-text" data-part="google-problem">{problem}</p>}
    </Card>
  );
}

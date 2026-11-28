"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { GoogleStatus } from "@/lib/server/google";
import { ConfirmRow, ConnectionTile } from "./ConnectionTile";

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

/**
 * Settings → Connections → Google (2026-11-27): sign in with Google for Calendar (read only since
 * 2026-11-28: the student's events show on Orca's calendar) and Drive (pick files on Add material).
 * Each asks only for its own permissions.
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
      if (outcome === "connected") setNotice(feature === "calendar" ? "Google Calendar connected. Your events show on Orca's calendar." : "Google Drive connected.");
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

  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/google", { method: "DELETE" });
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
  const connectLink = (feature: "calendar" | "drive", label: string) => (
    <a href={connectGoogleUrl(feature, here)} className="pressable inline-flex items-center rounded-[14px] bg-wisteria px-[14px] py-[7px] text-[14px] font-bold text-parchment lip-4 lip-wisteria" data-part={`google-${feature}-connect`}>
      {label}
    </a>
  );

  return (
    <ConnectionTile
      title="Google"
      info="Calendar: your Google events show on Orca's calendar, read only. Drive: pick files or a folder's files on Add material. Each asks only for its own permission."
      data-part="google-connection"
      status={
        status === null ? (
          "…"
        ) : status.needsReconnect ? (
          <span className="text-bad-text">Google no longer accepts Orca&apos;s access. Connect again.</span>
        ) : (
          <span className="flex flex-col">
            {status.email && <span data-part="google-email">{status.email}</span>}
            <span data-part="google-calendar">{status.calendar.connected ? "Calendar connected" : "Calendar not connected"}</span>
            <span data-part="google-drive">{status.drive.connected ? "Drive connected" : "Drive not connected"}</span>
            {notice && <span className="text-wisteria-deep" data-part="google-notice">{notice}</span>}
          </span>
        )
      }
      actions={
        status && (
          <>
            {!status.calendar.connected && connectLink("calendar", "Connect Calendar")}
            {!status.drive.connected && connectLink("drive", "Connect Drive")}
            {(connected || status.needsReconnect) && !confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="google-revoke">
                Disconnect
              </Button>
            )}
          </>
        )
      }
      confirm={
        confirming ? (
          <ConfirmRow>
            <span className="text-[13px] font-semibold text-prussian">Disconnect Google? Files already added stay.</span>
            <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={busy} data-part="google-revoke-yes">
              Disconnect
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep
            </Button>
          </ConfirmRow>
        ) : undefined
      }
      problem={problem}
    />
  );
}

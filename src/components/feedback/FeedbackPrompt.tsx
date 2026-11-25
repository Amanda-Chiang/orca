"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";

type Spot = "session-end" | "upload-done" | "practice-test" | "settings";
type SpotState = Record<string, { answered: boolean; dismissed: number }>;

const NOTE_MAX = 1000;

/**
 * Where each prompt stands for this student (GET /api/feedback), read once per page load and
 * shared by every prompt on it. Null until known; prompts stay hidden until then, and when the
 * read fails (signed out, offline), so a broken read never nags.
 */
let spotsPromise: Promise<{ spots: SpotState; dismissals: number } | null> | null = null;
function readSpots() {
  spotsPromise ??= fetch("/api/feedback", { cache: "no-store" })
    .then(async (r) => (r.ok ? ((await r.json()) as { spots: SpotState; dismissals: number }) : null))
    .catch(() => null);
  return spotsPromise;
}

async function send(body: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * A small feedback card (owner, 2026-11-25): one line, a thumb up or down, then an optional note.
 * X dismisses it; after the second dismissal, or once answered, it never shows at that spot again.
 * Rendered inline where the moment is (the end of a session, a built upload, a practice test), so
 * it never sits over something the student is trying to use. `always` (Settings) skips the spot
 * check and stays open for another message.
 */
export function FeedbackPrompt({ spot, question = "How was that?", always = false, className }: { spot: Spot; question?: string; always?: boolean; className?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<boolean>(always);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    if (always) return;
    let live = true;
    void readSpots().then((r) => {
      if (!live || !r) return;
      const s = r.spots[spot];
      setOpen(!s || (!s.answered && s.dismissed < r.dismissals));
    });
    return () => {
      live = false;
    };
  }, [spot, always]);

  const dismiss = () => {
    setOpen(false);
    void send({ spot, dismissed: true, page: pathname });
  };

  const submit = async (r: "up" | "down" | null) => {
    const trimmed = note.trim();
    if (!r && !trimmed) return;
    setState("sending");
    const ok = await send({ spot, rating: r, note: trimmed || null, page: pathname });
    setState(ok ? "sent" : "failed");
    if (ok && !always) spotsPromise = null;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={popIn}
          initial="hidden"
          animate="show"
          exit="exit"
          role="group"
          aria-label="Feedback"
          data-part="feedback-prompt"
          data-spot={spot}
          data-state={state}
          className={cn("relative flex flex-col gap-[8px] rounded-[18px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-prussian lip-3 lip-alice", className)}
        >
          {!always && state !== "sent" && (
            <button type="button" onClick={dismiss} aria-label="Not now" data-part="feedback-dismiss" className="absolute right-[10px] top-[10px] rounded-pill p-[4px] text-wisteria-deep hover:bg-alice">
              <IconClose size={14} />
            </button>
          )}
          {state === "sent" ? (
            <p className="text-[14px] font-semibold" data-part="feedback-thanks">
              Thanks. That goes straight to us.
              {always && (
                <button type="button" onClick={() => { setState("idle"); setRating(null); setNote(""); }} className="ml-[8px] font-bold text-wisteria-deep underline underline-offset-2">
                  Send another
                </button>
              )}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-[10px] pr-[24px]">
                <span className="text-[14px] font-bold">{question}</span>
                <span className="flex gap-[6px]">
                  <Thumb kind="up" picked={rating} onPick={(r) => { setRating(r); if (!note.trim()) void submitQuick(r); }} />
                  <Thumb kind="down" picked={rating} onPick={(r) => setRating(r)} />
                </span>
              </div>
              {(rating === "down" || always || note) && (
                <>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                    rows={2}
                    placeholder={rating === "down" ? "What went wrong? Even one line helps." : "Anything we should know?"}
                    data-part="feedback-note"
                    className="resize-y rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] py-[8px] text-[14px] font-medium text-prussian outline-none focus:border-wisteria"
                  />
                  <div className="flex items-center gap-[10px]">
                    <Button size="xs" onClick={() => void submit(rating)} disabled={state === "sending" || (!rating && !note.trim())} data-part="feedback-send">
                      {state === "sending" ? "Sending…" : "Send"}
                    </Button>
                    {state === "failed" && <span role="alert" className="text-[13px] font-semibold text-bad-text">Couldn&apos;t send. Try again.</span>}
                  </div>
                </>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  // A thumbs up with nothing to add sends at once: one tap and it's done.
  async function submitQuick(r: "up" | "down") {
    if (r !== "up" || always) return;
    setState("sending");
    const ok = await send({ spot, rating: r, note: null, page: pathname });
    setState(ok ? "sent" : "failed");
    if (ok) spotsPromise = null;
  }
}

function Thumb({ kind, picked, onPick }: { kind: "up" | "down"; picked: "up" | "down" | null; onPick: (r: "up" | "down") => void }) {
  const on = picked === kind;
  return (
    <button
      type="button"
      onClick={() => onPick(kind)}
      aria-pressed={on}
      aria-label={kind === "up" ? "Good" : "Not good"}
      data-part={`feedback-${kind}`}
      className={cn("pressable flex h-[30px] w-[30px] items-center justify-center rounded-pill border-2 text-[15px] lip-2", on ? "border-wisteria bg-wisteria text-parchment lip-wisteria" : "border-alice-deep bg-parchment lip-alice")}
    >
      <span aria-hidden className={kind === "down" ? "inline-block rotate-180" : undefined}>👍</span>
    </button>
  );
}

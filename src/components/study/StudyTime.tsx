"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { popIn } from "@/lib/motion";
import { useOrca } from "@/lib/store";
import { clock, TIMER_MAX_MINUTES, type StudyTimer } from "@/lib/study-timer";

/** What only the server holds of the study record (GET /api/study-time). */
export interface ServerStudyTime {
  timers: StudyTimer[];
  sittings: Array<{ courseId: string; day: string; minutes: number }>;
}

interface StudyTimeValue {
  /** Null until read. */
  server: ServerStudyTime | null;
  running: StudyTimer | null;
  problem: string | null;
  busy: boolean;
  start: (courseId: string) => Promise<void>;
  stop: () => Promise<void>;
  discard: () => Promise<void>;
}

const Ctx = createContext<StudyTimeValue | null>(null);

/**
 * The study record the server holds and the study timer (owner, 2026-11-22), shared by the progress
 * page, the course page's Start study session and the floating timer. Read once the store is ready
 * and again when the tab comes back into view (a timer may have been started on another device).
 */
export function StudyTimeProvider({ children }: { children: React.ReactNode }) {
  const { status } = useOrca();
  const [server, setServer] = useState<ServerStudyTime | null>(null);
  const [running, setRunning] = useState<StudyTimer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bumped after a timer change, so the effect reads the record again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    const read = () =>
      fetch("/api/study-time", { cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json()) as ServerStudyTime & { running: StudyTimer | null; error?: string };
          if (!res.ok) throw new Error(body.error ?? "Couldn't read your study time.");
          if (!live) return;
          setServer({ timers: body.timers, sittings: body.sittings });
          setRunning(body.running);
          setProblem(null);
        })
        .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : "Couldn't read your study time."));
    void read();
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, version]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch("/api/study-timer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const out = (await res.json()) as { running?: StudyTimer | null; error?: string };
        if (!res.ok) {
          setProblem(out.error ?? "Couldn't change the study session.");
          if (out.running) setRunning(out.running);
          return;
        }
        setProblem(null);
        setRunning(out.running ?? null);
        setVersion((v) => v + 1);
      } catch {
        setProblem("Couldn't reach Orca. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const value = useMemo<StudyTimeValue>(
    () => ({ server, running, problem, busy, start: (courseId) => act({ action: "start", courseId }), stop: () => act({ action: "stop" }), discard: () => act({ action: "discard" }) }),
    [server, running, problem, busy, act],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudyTime(): StudyTimeValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useStudyTime needs StudyTimeProvider (src/app/providers.tsx).");
  return value;
}

const everySecond = (cb: () => void) => {
  const id = window.setInterval(cb, 1000);
  return () => window.clearInterval(id);
};

/** Milliseconds a timer has run, ticking each second (capped where it stops counting); 0 during server render. */
export function useElapsed(startedAt: string | null): number {
  const now = useSyncExternalStore(everySecond, () => Math.floor(Date.now() / 1000) * 1000, () => 0);
  if (!startedAt || !now) return 0;
  return Math.min(now - Date.parse(startedAt), TIMER_MAX_MINUTES * 60_000);
}

/**
 * The running study session, floating on every page but the progress page (which shows it large):
 * the course, the clock and Stop. Mounted once the store is ready (src/app/providers.tsx).
 */
export function TimerPill() {
  const { running, stop, busy } = useStudyTime();
  const { courses } = useOrca();
  const pathname = usePathname();
  const elapsed = useElapsed(running?.startedAt ?? null);
  const course = courses.find((c) => c.id === running?.courseId);
  const show = running !== null && pathname !== "/progress";
  return (
    <AnimatePresence>
      {show && (
        <motion.div variants={popIn} initial="hidden" animate="show" exit="exit" className="fixed left-1/2 top-[98px] z-40 -translate-x-1/2" data-part="timer-pill">
          <div className="flex items-center gap-[10px] rounded-pill border-2 border-study-mint bg-parchment py-[6px] pl-[14px] pr-[6px] text-[14px] font-bold text-prussian lip-3 lip-alice">
            <span className="relative flex h-[10px] w-[10px]" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-study-mint opacity-60" />
              <span className="relative inline-flex h-[10px] w-[10px] rounded-full bg-study-mint" />
            </span>
            <Link href="/progress" className="underline-offset-2 hover:underline">
              Studying {course?.short ?? "a course"}
            </Link>
            <span className="tabular-nums" data-part="timer-pill-clock">{clock(elapsed)}</span>
            <button type="button" disabled={busy} onClick={() => void stop()} data-part="timer-pill-stop" className="pressable rounded-pill bg-prussian px-[12px] py-[4px] text-[13px] font-bold text-parchment disabled:opacity-60">
              Stop
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The study timer's shared shapes and rules (owner, 2026-11-22): the route writes timers, the browser
 * shows them and the progress page counts them. Pure.
 */

/** The longest a timer counts for: a forgotten one stops counting here (the table checks it too). */
export const TIMER_MAX_MINUTES = 240;

export interface StudyTimer {
  id: string;
  courseId: string;
  examId: string | null;
  startedAt: string;
  /** Null while it runs. */
  endedAt: string | null;
}

/** When a timer started at `startedAt` and stopped `now` ends: now, or the cap, whichever is sooner. */
export function timerEnd(startedAt: string, now: Date): Date {
  return new Date(Math.min(now.getTime(), Date.parse(startedAt) + TIMER_MAX_MINUTES * 60_000));
}

/** "1:05:09" or "4:09" for a running timer's elapsed milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

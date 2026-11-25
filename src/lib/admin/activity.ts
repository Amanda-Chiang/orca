/**
 * Activity days (2026-11-25), pure: from the UTC days an account had the app open, the gaps worth
 * seeing (a stretch of `minGap` days or more with nothing) and whether the account came back after
 * one. The admin view draws the days as a strip and lists the gaps.
 */

export interface ActivityDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  firstAt: string;
  lastAt: string;
  /** Heartbeats that day; 0 for a day backfilled from older rows. */
  beats: number;
}

export interface ActivityGap {
  /** The last active day before the gap. */
  from: string;
  /** The first active day after it, or null when the account hasn't come back. */
  to: string | null;
  /** Days with nothing. */
  days: number;
}

const DAY_MS = 86_400_000;

function utc(day: string): number {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Not a day: ${day}`);
  return t;
}

/** Whole days between two YYYY-MM-DD days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/**
 * The gaps of `minGap` days or more, oldest first. `today` closes the record: a gap still open on
 * `today` (nothing since the last active day) has `to: null`.
 */
export function activityGaps(days: readonly ActivityDay[], today: string, minGap = 7): ActivityGap[] {
  const sorted = [...new Set(days.map((d) => d.day))].sort();
  const gaps: ActivityGap[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const n = daysBetween(sorted[i - 1], sorted[i]) - 1;
    if (n >= minGap) gaps.push({ from: sorted[i - 1], to: sorted[i], days: n });
  }
  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    const n = daysBetween(last, today);
    if (n >= minGap) gaps.push({ from: last, to: null, days: n });
  }
  return gaps;
}

/** The last `n` days ending `today`, oldest first, each with whether the account was active. */
export function activityStrip(days: readonly ActivityDay[], today: string, n = 90): Array<{ day: string; active: boolean; beats: number }> {
  const byDay = new Map(days.map((d) => [d.day, d.beats]));
  const end = utc(today);
  const out: Array<{ day: string; active: boolean; beats: number }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    const beats = byDay.get(day);
    out.push({ day, active: beats !== undefined, beats: beats ?? 0 });
  }
  return out;
}

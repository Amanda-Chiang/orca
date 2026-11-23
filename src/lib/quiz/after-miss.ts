/**
 * What happens after a wrong answer in a web quiz (owner, 2026-11-22): the first answer is recorded
 * as it was graded, then the solution stays hidden while the student tries once more (practice
 * only: the retry records nothing), names what went wrong (shown, not saved), and only then reads
 * the solution. A different question on the same objective comes back a few questions later, and
 * that one counts like any other answer. Pure; loads under plain Node.
 */
import type { QuizQuestion } from "../data.ts";
import type { ErrorType } from "../mastery/types.ts";

/** How many questions after the miss the sibling question is asked. */
export const SIBLING_GAP = 3;

/** The steps after a checked answer: the second try, naming the mistake, then the solution. */
export type AfterMissStage = "retry" | "spot" | "solution";

/**
 * Whether a missed question gets a second try: not true/false or a two-option question (the second
 * try would be the answer for free), and every short answer (exact or rubric).
 */
export function canRetry(q: Pick<QuizQuestion, "kind" | "options">): boolean {
  if (q.kind === "Short answer") return true;
  if (q.kind === "True or false") return false;
  return q.options.length >= 3;
}

/** What the mistake chips say, and the grader's errorType in words. */
export const ERROR_LABEL: Record<ErrorType, string> = {
  arithmetic: "Arithmetic slip",
  units: "Units",
  sign: "Sign",
  misread: "Misread the question",
  notation: "Notation",
  concept: "The idea itself",
};

/** The chips, in order; "unknown" is "I didn't know it". */
export const SPOT_CHOICES: ReadonlyArray<ErrorType | "unknown"> = ["concept", "misread", "arithmetic", "sign", "units", "notation", "unknown"];

/** The nudge before the second try, from the grader's errorType ("Looks like a units slip."); null when the grader named none. */
export function nudgeFor(errorType: ErrorType | null | undefined): string | null {
  if (!errorType) return null;
  if (errorType === "concept") return "The idea behind it looks off. Think it through again.";
  if (errorType === "misread") return "Read the question once more: it may ask something slightly different.";
  return `Looks like a slip with ${errorType === "arithmetic" ? "the arithmetic" : errorType === "units" ? "the units" : errorType === "sign" ? "a sign" : "the notation"}.`;
}

/** What the student's pick says against the grader's, when the grader named one. */
export function spotVerdict(picked: ErrorType | "unknown", grader: ErrorType | null | undefined): string | null {
  if (!grader) return null;
  if (picked === grader) return "Orca's grader read it the same way.";
  return `Orca's grader read it as: ${ERROR_LABEL[grader].toLowerCase()}.`;
}

/**
 * Where to slot a sibling question after a miss at `index` in a run of `length`: `SIBLING_GAP`
 * questions on, or at the end when the run is shorter.
 */
export function siblingSlot(index: number, length: number): number {
  return Math.min(index + 1 + SIBLING_GAP, length);
}

/**
 * The sibling for a missed question: another question on the same objective, not one of `exclude`
 * (the run's own), unseen first, else the one seen longest ago; null when there's none.
 */
export function pickSibling<Q extends { id: string }>(others: readonly Q[], exclude: ReadonlySet<string>, lastSeen: ReadonlyMap<string, string>): Q | null {
  const pool = others.filter((q) => !exclude.has(q.id));
  return pool.find((q) => !lastSeen.has(q.id)) ?? [...pool].sort((a, b) => (lastSeen.get(a.id) ?? "").localeCompare(lastSeen.get(b.id) ?? ""))[0] ?? null;
}

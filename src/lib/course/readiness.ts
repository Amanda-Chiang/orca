/**
 * Readiness at exam level (plan `docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md`,
 * Phase 3): how ready the student is for each kind of problem the exam asks, from the exam-style
 * problems they attempted (`problem_attempts`), and the cram plan's units when the exam has a map.
 * Pure: nothing here is stored.
 */
import type { ProblemType } from "../data.ts";
import type { CramPlanInput } from "../mastery/cram-plan.ts";
import type { ObjectiveStatus } from "../mastery/types.ts";

export const ATTEMPT_OUTCOMES = ["solved", "with-hints", "shown", "stuck"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** One exam-style problem attempted. */
export interface ProblemAttempt {
  typeId: string;
  at: string;
  outcome: AttemptOutcome;
  /** No help first, at exam difficulty. */
  cold: boolean;
  minutes?: number | null;
  errorNote?: string | null;
  /** A problem of the reserved exam sat timed. */
  mockMaterialId?: string | null;
  points?: number | null;
  outOf?: number | null;
}

/**
 * ready: the latest attempt was cold and solved. shaky: the latest was solved after help, or with
 * hints. not-yet: the latest was shown or left stuck. untested: never attempted. Only a cold solve
 * says ready (owner, 2026-11-22: recall questions and guided walk-throughs said nothing about the exam).
 */
export type Readiness = "ready" | "shaky" | "not-yet" | "untested";

export interface TypeReadiness {
  id: string;
  name: string;
  /** How many of the mapped exams it's on (at least 1: a type on no exam still counts once). */
  exams: number;
  state: Readiness;
  attempts: number;
  lastAt: string | null;
  /** The slip on the latest attempt that had one. */
  lastError: string | null;
}

export interface ExamReadiness {
  types: TypeReadiness[];
  ready: number;
  total: number;
  /** Ready types over all, each weighed by how many exams ask it (a shaky one counts half): 0 to 1. */
  share: number;
  /** The reserved exam sat timed: its points, when the attempts carry them. Null until it's sat. */
  measured: { materialId: string; points: number; outOf: number; at: string } | null;
}

const stateOf = (latest: ProblemAttempt | undefined): Readiness => {
  if (!latest) return "untested";
  if (latest.outcome === "solved") return latest.cold ? "ready" : "shaky";
  return latest.outcome === "with-hints" ? "shaky" : "not-yet";
};
const CREDIT: Record<Readiness, number> = { ready: 1, shaky: 0.5, "not-yet": 0, untested: 0 };

/** Readiness per problem type, most recurrent first, from the attempts on this exam's types. */
export function examReadiness(types: readonly ProblemType[], attempts: readonly ProblemAttempt[]): ExamReadiness {
  const byType = new Map<string, ProblemAttempt[]>();
  for (const a of [...attempts].sort((x, y) => x.at.localeCompare(y.at))) byType.set(a.typeId, [...(byType.get(a.typeId) ?? []), a]);
  const lines: TypeReadiness[] = types
    .map((t) => {
      const mine = byType.get(t.id) ?? [];
      const latest = mine[mine.length - 1];
      return { id: t.id, name: t.name, exams: Math.max(1, new Set(t.materialIds).size), state: stateOf(latest), attempts: mine.length, lastAt: latest?.at ?? null, lastError: [...mine].reverse().find((a) => a.errorNote)?.errorNote ?? null };
    })
    .sort((a, b) => b.exams - a.exams || a.name.localeCompare(b.name));
  const weight = lines.reduce((sum, t) => sum + t.exams, 0);
  // The measured score: the latest sitting of a reserved exam (its attempts within a day of the newest one).
  const scored = attempts.filter((a) => a.mockMaterialId && a.points != null && a.outOf != null).sort((x, y) => y.at.localeCompare(x.at));
  let measured: ExamReadiness["measured"] = null;
  if (scored.length) {
    const sitting = scored.filter((a) => a.mockMaterialId === scored[0].mockMaterialId && Date.parse(scored[0].at) - Date.parse(a.at) < 86_400_000);
    measured = { materialId: scored[0].mockMaterialId!, points: sitting.reduce((sum, a) => sum + a.points!, 0), outOf: sitting.reduce((sum, a) => sum + a.outOf!, 0), at: scored[0].at };
  }
  return { types: lines, ready: lines.filter((t) => t.state === "ready").length, total: lines.length, share: weight ? lines.reduce((sum, t) => sum + t.exams * CREDIT[t.state], 0) / weight : 0, measured };
}

/** How a readiness state reads to the plan: ready is verified (done), shaky and not-yet are weak spots to work on, untested is unseen. */
const STATUS: Record<Readiness, ObjectiveStatus> = { ready: "verified", shaky: "learning", "not-yet": "learning", untested: "unseen" };

/**
 * The plan's units when the exam has a map: one per problem type, weighed by how many exams ask it,
 * done once the student is ready for it. Each unit carries one objective-shaped entry with the
 * type's own id, so the plan's weak spots and touched ids are type ids.
 */
export function typePlanTopics(readiness: ExamReadiness): CramPlanInput["topics"] {
  return readiness.types.map((t) => ({ id: t.id, name: t.name, objectives: [{ id: t.id, name: t.name, weight: t.exams, status: STATUS[t.state] }] }));
}

/** The types attempted at or after `since` (the plan's touched ids when its units are types). */
export function typesTouchedSince(attempts: readonly ProblemAttempt[], since: string): string[] {
  return [...new Set(attempts.filter((a) => a.at >= since).map((a) => a.typeId))];
}

export const READINESS_LABEL: Record<Readiness, string> = { ready: "Ready", shaky: "Shaky", "not-yet": "Not yet", untested: "Untested" };

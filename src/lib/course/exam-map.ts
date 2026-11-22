/**
 * The exam map (plan `docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md`, Phase 1):
 * an exam's problem types by how often the past exams ask them. Pure.
 */
import type { ExamScope, ProblemType } from "../data.ts";

/** Fewer mapped exams than this and a type's recurrence is a guess: the map says so. */
export const EXAMS_FOR_CONFIDENCE = 3;

export interface ExamMapLine {
  id: string;
  name: string;
  /** How many of the mapped exams it's on. */
  exams: number;
  objectives: number;
  note?: string;
}

export interface ExamMap {
  /** The past exams the types were read from (every material some type names). */
  examsMapped: number;
  /** True under EXAMS_FOR_CONFIDENCE exams: what recurs can't be told from so few. */
  uncertain: boolean;
  /** Most recurrent first, then by name. */
  types: ExamMapLine[];
}

/** The scope's problem types as a map; null when it has none. */
export function examMap(scope: Pick<ExamScope, "problemTypes"> | null | undefined): ExamMap | null {
  const types: readonly ProblemType[] = scope?.problemTypes ?? [];
  if (!types.length) return null;
  const mapped = new Set(types.flatMap((t) => t.materialIds));
  return {
    examsMapped: mapped.size,
    uncertain: mapped.size < EXAMS_FOR_CONFIDENCE,
    types: types
      .map((t) => ({ id: t.id, name: t.name, exams: new Set(t.materialIds).size, objectives: t.objectiveIds.length, ...(t.note ? { note: t.note } : {}) }))
      .sort((a, b) => b.exams - a.exams || a.name.localeCompare(b.name)),
  };
}

const NOTES: Record<string, string> = { none: "Closed book", sheet: "Formula sheet allowed", open: "Open book" };
const CALCULATOR: Record<string, string> = { none: "no calculator", simple: "simple calculator", any: "any calculator" };

/** The rules as one line ("Closed book · simple calculator · 75 min"); null when none are stored. The free text is shown apart. */
export function rulesLine(rules: ExamScope["rules"]): string | null {
  if (!rules) return null;
  const parts = [rules.notes ? NOTES[rules.notes] : null, rules.calculator ? CALCULATOR[rules.calculator] : null, rules.minutes ? `${rules.minutes} min` : null].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : null;
}

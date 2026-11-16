/**
 * The exam card on the course page (cram mode contract, section 5, "Exam weights"): which exam it
 * shows, how far off it is, what it covers, and the scope its setup saves. Pure.
 */
import type { Exam, ExamScope, Objective, Topic } from "../data.ts";
import { SCOPE_STRENGTH } from "./scope.ts";
import { survivingTopic } from "./weights.ts";

/** The exam the card shows: the cramming exam (soonest first), else the soonest exam on or after today; null without one. A past exam is done, cramming or not. */
export function cardExam<E extends Pick<Exam, "courseId" | "date" | "cramming">>(exams: readonly E[], courseId: string, today: string): E | null {
  const mine = exams.filter((e) => e.courseId === courseId && e.date >= today).sort((a, b) => Number(b.cramming) - Number(a.cramming) || a.date.localeCompare(b.date));
  return mine[0] ?? null;
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from today to the exam's date: 0 on the day, negative once it's past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((utcDay(date) - utcDay(today)) / 86_400_000);
}

const live = (o: Objective | undefined): o is Objective => !!o && o.review !== "archived" && !o.mergedInto;

/**
 * The objectives an exam covers, in catalogue order: the ones its scope lists with a weight above 0
 * when it has a scope with objectives; else every live objective of its topics (every live topic
 * when it names none). Topic ids follow merges.
 */
export function examObjectives(exam: Pick<Exam, "topicIds" | "scope">, topics: readonly Topic[], objectives: Readonly<Record<string, Objective>>): string[] {
  if (exam.scope?.objectives.length) {
    const listed = new Map(exam.scope.objectives.map((o) => [o.objectiveId, o.weight]));
    return Object.values(objectives)
      .filter((o) => live(o) && (listed.get(o.id) ?? 0) > 0)
      .map((o) => o.id);
  }
  const byId = new Map(topics.map((t) => [t.id, t]));
  const liveTopics = new Set(topics.filter((t) => t.review !== "archived" && !t.mergedInto).map((t) => t.id));
  const covered = exam.topicIds.length ? new Set(exam.topicIds.map((id) => survivingTopic(id, byId)?.id).filter((id): id is string => !!id && liveTopics.has(id))) : liveTopics;
  return Object.values(objectives)
    .filter((o) => live(o) && covered.has(survivingTopic(o.topicId, byId)?.id ?? o.topicId))
    .map((o) => o.id);
}

/** The materials an objective is taught in: the one that created it and the ones its signals name, deduplicated, in that order. */
export function objectiveMaterialIds(o: Pick<Objective, "materialId" | "signals">): string[] {
  return [...new Set([...(o.materialId ? [o.materialId] : []), ...o.signals.map((s) => s.materialId)])];
}

/** What the picker excludes says on the scope: the professor's words, by elimination. */
export const NOT_IN_FILES = "not in the files the exam covers";

/**
 * The objectives the cram setup starts from: every live objective of the exam's topics (its scope
 * set aside, so a narrowed scope can be widened again), split by the materials picked. With
 * nothing picked everything is in scope; else an objective is in scope when the material that
 * created it, or one its signals name, was picked. A weak spot (`weak`) stays in when any objective
 * of its topic is taught in a picked file, so a file pick never zeroes a weak spot of a topic the
 * exam covers; an objective no material teaches follows the majority of its topic: in when at least
 * half of the topic's taught objectives are in (owner, 2026-11-16: one op-amp objective in a picked
 * file mustn't pull the whole topic in).
 */
export function splitByMaterials(candidates: readonly string[], picked: readonly string[], catalogue: Readonly<Record<string, Objective>>, weak: ReadonlySet<string> = new Set()): { inScope: string[]; excluded: string[] } {
  if (!picked.length) return { inScope: [...candidates], excluded: [] };
  const chosen = new Set(picked);
  const taught = new Set<string>();
  const lines: ScopeObjective[] = [];
  for (const id of candidates) {
    const o = catalogue[id];
    if (!o) continue;
    if (objectiveMaterialIds(o).some((m) => chosen.has(m))) taught.add(id);
    lines.push({ id, topicId: o.topicId, materialIds: objectiveMaterialIds(o), weak: weak.has(id) });
  }
  const follows = followers(lines, (id) => taught.has(id));
  const inScope: string[] = [];
  const excluded: string[] = [];
  for (const id of candidates) {
    const o = catalogue[id];
    (taught.has(id) || (!!o && follows.has(id)) ? inScope : excluded).push(id);
  }
  return { inScope, excluded };
}

/**
 * The scope the cram setup saves. In-scope objectives (every candidate, or the ones taught in the
 * picked materials) keep the weight they had above 0 (1 when new or excluded before), with the
 * professor's words as `professor` evidence on each (its earlier professor quote replaced); the
 * objectives the picker excludes weigh 0 with a `professor` note saying so. Other evidence, the
 * format and the sources are kept; `professor` joins the sources; the picked materials are stored
 * (none when nothing was picked). Without words and without a pick, the scope is left as it is.
 */
export function scopeFromSetup(existing: ExamScope | null, candidates: readonly string[], words: string, picked: readonly string[] = [], catalogue: Readonly<Record<string, Objective>> = {}, weak: ReadonlySet<string> = new Set()): ExamScope | null {
  const quote = words.trim();
  if (!quote && !picked.length) return existing;
  const said = quote ? [{ signal: "professor" as const, strength: SCOPE_STRENGTH.professor, quote }] : [];
  const notInFiles = { signal: "professor" as const, strength: SCOPE_STRENGTH.professor, quote: NOT_IN_FILES };
  const { inScope, excluded } = splitByMaterials(candidates, picked, catalogue, weak);
  const chosen = new Set(inScope);
  const out = new Set(excluded);
  const was = new Map((existing?.objectives ?? []).map((o) => [o.objectiveId, o]));
  const ids = [...new Set([...was.keys(), ...inScope, ...excluded])];
  return {
    objectives: ids.map((objectiveId) => {
      const before = was.get(objectiveId);
      const kept = (before?.evidence ?? []).filter((e) => e.signal !== "professor");
      if (out.has(objectiveId)) return { objectiveId, weight: 0, evidence: [...kept, notInFiles] };
      // A listed objective that's no longer a candidate (not in the exam's topics) keeps its weight as it was.
      const weight = chosen.has(objectiveId) ? (before && before.weight > 0 ? before.weight : 1) : (before?.weight ?? 1);
      return { objectiveId, weight, evidence: [...kept, ...said] };
    }),
    ...(existing?.format ? { format: existing.format } : {}),
    sources: [...new Set([...(existing?.sources ?? []), "professor" as const])],
    ...(picked.length ? { materialIds: [...new Set(picked)] } : {}),
  };
}

/** What `protectScope` reads of an objective: its topic, the materials it's taught in, and whether it's a weak spot. */
export interface ScopeObjective {
  id: string;
  topicId: string;
  materialIds: readonly string[];
  weak: boolean;
}

/**
 * A file-scoped scope (one with `materialIds`) with the zeros a file pick shouldn't make put back:
 * an objective weighed 0 only because it isn't in the picked files (no evidence but the "not in the
 * files" note) goes back to 1 when `followers` says it follows its topic in (a weak spot of a topic
 * with anything in scope; an untaught objective of a topic mostly in scope). A professor's own exclusion (any other quote) stands. As
 * `splitByMaterials` splits a new pick; this repairs scopes saved before, or sent by Claude.
 */
export function protectScope(scope: ExamScope, objectives: readonly ScopeObjective[]): { scope: ExamScope; raised: string[] } {
  if (!scope.materialIds?.length) return { scope, raised: [] };
  const weight = new Map(scope.objectives.map((o) => [o.objectiveId, o.weight]));
  const follows = followers(objectives, (id) => (weight.get(id) ?? 1) > 0);
  const raised: string[] = [];
  const next = scope.objectives.map((entry) => {
    if (entry.weight > 0 || !follows.has(entry.objectiveId)) return entry;
    if (!entry.evidence.every((ev) => !ev.quote || ev.quote === NOT_IN_FILES)) return entry;
    raised.push(entry.objectiveId);
    return { ...entry, weight: 1, evidence: entry.evidence.filter((ev) => ev.quote !== NOT_IN_FILES) };
  });
  return raised.length ? { scope: { ...scope, objectives: next }, raised } : { scope, raised };
}

/**
 * The objectives that follow their topic into scope: a weak spot when any objective of its topic is
 * in (`isIn`); an objective no material teaches when at least half of its topic's taught objectives
 * are in. Objectives that are in already aren't listed.
 */
function followers(objectives: readonly ScopeObjective[], isIn: (id: string) => boolean): Set<string> {
  const byTopic = new Map<string, { any: boolean; taught: number; taughtIn: number }>();
  for (const o of objectives) {
    const t = byTopic.get(o.topicId) ?? { any: false, taught: 0, taughtIn: 0 };
    if (isIn(o.id)) t.any = true;
    if (o.materialIds.length) {
      t.taught++;
      if (isIn(o.id)) t.taughtIn++;
    }
    byTopic.set(o.topicId, t);
  }
  const out = new Set<string>();
  for (const o of objectives) {
    if (isIn(o.id)) continue;
    const t = byTopic.get(o.topicId)!;
    if (o.weak ? t.any : o.materialIds.length === 0 && t.taught > 0 && t.taughtIn * 2 >= t.taught) out.add(o.id);
  }
  return out;
}

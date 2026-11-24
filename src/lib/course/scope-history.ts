/**
 * A log of what changed on an exam's scope and budget, and who changed it (owner, 2026-11-22: the
 * Circuit Analysis scope went from 88 to 114 objectives overnight with no record of why). Kept on
 * the scope itself (`scope.history`, the last HISTORY_MAX edits). Pure.
 */
import type { ExamScope, ScopeEdit } from "../data.ts";

export const HISTORY_MAX = 30;

const hours = (scope: ExamScope | null) => scope?.budget?.hours ?? null;
const excluded = (scope: ExamScope | null) => (scope?.objectives ?? []).filter((o) => o.weight === 0).length;
const listed = (scope: ExamScope | null) => (scope?.objectives ?? []).length;
const round = (n: number) => Math.round(n * 10) / 10;

/** What changed between two scopes (and the exam's date), in words; null when nothing a student would notice did. */
export function describeScopeChange(before: ExamScope | null, after: ExamScope | null, dates: { before?: string; after?: string } = {}): string | null {
  const parts: string[] = [];
  if (dates.before !== undefined && dates.after !== undefined && dates.before !== dates.after) parts.push(`date ${dates.before} → ${dates.after}`);
  if (excluded(before) !== excluded(after) || listed(before) !== listed(after)) parts.push(`objectives excluded ${excluded(before)} → ${excluded(after)} (of ${listed(after)} listed)`);
  if ((before?.materialIds ?? []).join() !== (after?.materialIds ?? []).join()) parts.push(`files the exam covers ${(before?.materialIds ?? []).length} → ${(after?.materialIds ?? []).length}`);
  if (hours(before) !== hours(after)) parts.push(`budget ${hours(before) === null ? "none" : `${round(hours(before)!)} h`} → ${hours(after) === null ? "none" : `${round(hours(after)!)} h`}`);
  else if (JSON.stringify(before?.budget?.perDay ?? null) !== JSON.stringify(after?.budget?.perDay ?? null)) parts.push("hours moved between days");
  if ((before?.problemTypes ?? []).length !== (after?.problemTypes ?? []).length) parts.push(`kinds of problem ${(before?.problemTypes ?? []).length} → ${(after?.problemTypes ?? []).length}`);
  if ((before?.reservedMaterialId ?? null) !== (after?.reservedMaterialId ?? null)) parts.push(after?.reservedMaterialId ? "reserved exam set" : "reserved exam cleared");
  if (JSON.stringify(before?.rules ?? null) !== JSON.stringify(after?.rules ?? null)) parts.push("exam rules changed");
  return parts.length ? parts.join("; ") : null;
}

/** `after` with the change appended to the history `before` carried (nothing appended when nothing changed). */
export function withHistory(before: ExamScope | null, after: ExamScope | null, by: ScopeEdit["by"], at: string, dates: { before?: string; after?: string } = {}): ExamScope | null {
  if (!after) return after;
  const { history: _own, ...rest } = after;
  void _own;
  const kept = before?.history ?? [];
  const what = describeScopeChange(before, after, dates);
  const history = what ? [...kept, { at, by, what }].slice(-HISTORY_MAX) : kept;
  return history.length ? { ...rest, history } : rest;
}

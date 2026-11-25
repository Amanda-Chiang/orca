/**
 * An objective's history for the List view's History pop-up (owner, 2026-11-25): every event in the
 * order the fold applies them, each with the display percent (`masteryPercent`, the number quiz
 * feedback shows) just before and just after it, read at the event's own time. Derived by replaying
 * the fold, never stored. Pure.
 */
import { EMPTY_ACCUMULATOR, type ObjectiveStateOptions, applyEvidence, stateAt } from "./objective-state.ts";
import { masteryPercent } from "./percent.ts";
import type { EvidenceEvent, ObjectiveStatus } from "./types.ts";

export interface HistoryEntry {
  event: EvidenceEvent;
  /** 0–100 just before the event, at its time. */
  before: number;
  /** 0–100 just after it. */
  after: number;
  statusBefore: ObjectiveStatus;
  statusAfter: ObjectiveStatus;
}

/** Oldest first, in the same order replayObjective folds. */
export function objectiveHistory(objectiveId: string, events: readonly EvidenceEvent[], options: ObjectiveStateOptions): HistoryEntry[] {
  const mine = events
    .filter((e) => e.objectiveId === objectiveId)
    .map((e) => ({ e, t: Date.parse(e.at) }))
    .sort((a, b) => a.t - b.t || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  let acc = EMPTY_ACCUMULATOR;
  const out: HistoryEntry[] = [];
  for (const { e, t } of mine) {
    const at = new Date(t);
    const was = stateAt(objectiveId, acc, at);
    acc = applyEvidence(acc, e, options);
    const now = stateAt(objectiveId, acc, at);
    out.push({ event: e, before: masteryPercent(was), after: masteryPercent(now), statusBefore: was.status, statusAfter: now.status });
  }
  return out;
}

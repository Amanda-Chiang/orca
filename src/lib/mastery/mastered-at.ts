/**
 * When an objective last became mastered, read from its evidence (the List view's Previous tab;
 * owner, 2026-11-22). Derived by replaying the fold, never stored: the time of the event that last
 * took it from not mastered to mastered, or null when it isn't mastered at the end of the log.
 */
import { EMPTY_ACCUMULATOR, type ObjectiveStateOptions, applyEvidence } from "./objective-state.ts";
import type { EvidenceEvent } from "./types.ts";

export function masteredAt(objectiveId: string, events: readonly EvidenceEvent[], options: ObjectiveStateOptions): string | null {
  const mine = events
    .filter((e) => e.objectiveId === objectiveId)
    .map((e) => ({ e, t: Date.parse(e.at) }))
    // The same order replayObjective folds in.
    .sort((a, b) => a.t - b.t || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  let acc = EMPTY_ACCUMULATOR;
  let since: string | null = null;
  for (const { e } of mine) {
    const next = applyEvidence(acc, e, options);
    if (next.mastered && !acc.mastered) since = e.at;
    if (!next.mastered) since = null;
    acc = next;
  }
  return since;
}

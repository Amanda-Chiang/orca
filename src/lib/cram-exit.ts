"use client";

import { useSyncExternalStore } from "react";

/**
 * Leaving cram mode (owner, 2026-11-25): Stop cramming opens the cram's results (the cram page with
 * `?ended=<examId>`), still in cram mode's dark look; leaving them plays the dive back up
 * (CramCurtain) on the next page that has one. In-memory only: a reload starts clean.
 */

/** The cram's results: the cram page with `ended`, and `at` the moment Stop was clicked (the results end there). */
export const cramResultsHref = (slug: string, examId: string) => `/course/${slug}/cram?ended=${examId}&at=${encodeURIComponent(new Date().toISOString())}`;

/** The exam whose Stop cramming was just clicked: the results page ends it once, so a reload or a bookmark of the URL can't. */
let stopping: string | null = null;
let taken: string | null = null;

export function requestCramStop(examId: string) {
  stopping = examId;
  taken = null;
}

/**
 * Whether Stop cramming was clicked for this exam: "new" the first time asked (end it now), "taken" after
 * (an effect run again before the store caught up: nothing to do), "none" if it wasn't.
 */
export function takeCramStop(examId: string): "new" | "taken" | "none" {
  if (stopping === examId) {
    stopping = null;
    taken = examId;
    return "new";
  }
  return taken === examId ? "taken" : "none";
}

/** When the results page closed: the next page with a curtain within a few seconds surfaces. */
let surfaceAt = 0;
const SURFACE_MS = 5000;

export function markCramSurface() {
  surfaceAt = Date.now();
}

export function clearCramSurface() {
  surfaceAt = 0;
}

/** Whether the results page just closed; true once. */
export function takeCramSurface(): boolean {
  const due = surfaceAt > 0 && Date.now() - surfaceAt < SURFACE_MS;
  surfaceAt = 0;
  return due;
}

/** The course slug whose cram results are on screen, so the top bar keeps cram mode's colour over them. */
let resultsSlug: string | null = null;
const listeners = new Set<() => void>();

export function setCramResults(slug: string | null) {
  resultsSlug = slug;
  for (const l of listeners) l();
}

export function useCramResults(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => resultsSlug,
    () => null,
  );
}

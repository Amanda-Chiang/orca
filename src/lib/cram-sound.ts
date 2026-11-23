"use client";

import { useSyncExternalStore } from "react";
import { CRAM_DIVE_S } from "@/lib/motion";

/**
 * Cram mode's sound (owner, 2026-11-22): bubbles for as long as the dive into or out of cram mode lasts,
 * then a short fade. The speaker on the CRAM MODE banner turns it off; the choice is kept in this browser.
 */
const SRC = "/sounds/cram-bubbles.mp3";
const KEY = "orca.cramSound";
const CHANGED = "orca:cram-sound";
const VOLUME = 0.6;
const FADE_MS = 400;

let playing: HTMLAudioElement | null = null;

const read = () => localStorage.getItem(KEY) !== "off";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGED, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGED, cb);
  };
};

/** Whether the sound is on (true until the student turns it off; true while rendering on the server). */
export function useCramSoundOn(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setCramSoundOn(on: boolean) {
  if (on) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, "off");
  window.dispatchEvent(new Event(CHANGED));
  if (!on) stop();
}

function stop() {
  playing?.pause();
  playing = null;
}

/** Bubbles for the length of the dive, then fade out. Nothing when the student turned the sound off. */
export function playCramSound() {
  if (!read()) return;
  stop();
  const audio = new Audio(SRC);
  audio.volume = VOLUME;
  playing = audio;
  // A browser may refuse sound without a click first (opening a page already in cram mode); then it's simply silent.
  audio.play().catch(() => {});
  const fadeAt = CRAM_DIVE_S * 1000;
  window.setTimeout(() => {
    const started = performance.now();
    const step = () => {
      if (playing !== audio) return;
      const t = Math.min(1, (performance.now() - started) / FADE_MS);
      audio.volume = VOLUME * (1 - t);
      if (t < 1) requestAnimationFrame(step);
      else stop();
    };
    requestAnimationFrame(step);
  }, fadeAt);
}

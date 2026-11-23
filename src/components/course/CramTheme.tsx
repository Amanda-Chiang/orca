"use client";

import { useEffect } from "react";

/** While mounted with `active`, the whole screen is in cram mode's dark tokens (globals.css, :root[data-cram]). */
export function useCramTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.cram = "1";
    return () => {
      delete root.dataset.cram;
    };
  }, [active]);
}

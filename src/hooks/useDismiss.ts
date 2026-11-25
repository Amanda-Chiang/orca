"use client";

import { type RefObject, useEffect } from "react";

/**
 * While `open`, a press outside `ref`'s element (or outside any element matching `inside`) or Escape
 * calls `close`; with `onScroll`, so does scrolling (for a popover fixed beside something that moves).
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, opts: { inside?: string; onScroll?: boolean } = {}) {
  const { inside, onScroll } = opts;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || (inside && target.closest?.(inside))) return;
      close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    if (onScroll) document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", close, true);
    };
  }, [ref, open, close, inside, onScroll]);
}

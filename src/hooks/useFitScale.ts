"use client";

import { useEffect, useState } from "react";

/**
 * Scales a fixed-size design canvas (e.g. the 854×834 knowledge map) to fit
 * its container, preserving aspect ratio. Returns the ref to attach to the
 * container and the scale + offsets to apply to the canvas. The ref is a callback, so a container
 * that mounts later (after an empty state, say) is still measured.
 */
export function useFitScale(designWidth: number, designHeight: number, mode: "contain" | "cover" = "contain") {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState({ scale: 1, x: 0, y: 0, width: designWidth, height: designHeight });

  useEffect(() => {
    if (!el) return;

    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const sx = width / designWidth;
      const sy = height / designHeight;
      const scale = mode === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
      setState({
        scale,
        x: (width - designWidth * scale) / 2,
        y: (height - designHeight * scale) / 2,
        width,
        height,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, designWidth, designHeight, mode]);

  return { ref: setEl, el, ...state };
}

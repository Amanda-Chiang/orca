"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cramDive, cramDiveFade } from "@/lib/motion";

/** Bubbles in the strip: across (%), down the strip (%), size (px). Fixed, so every dive looks the same. */
const BUBBLES: ReadonlyArray<readonly [number, number, number]> = [
  [8, 12, 14], [22, 30, 8], [35, 18, 20], [48, 44, 10], [61, 26, 16], [74, 38, 9], [88, 16, 22],
  [14, 52, 18], [29, 64, 11], [43, 58, 24], [57, 72, 9], [69, 55, 15], [82, 68, 12], [94, 48, 8],
  [6, 80, 10], [19, 90, 22], [37, 84, 13], [52, 94, 17], [66, 86, 8], [79, 92, 19], [91, 78, 11],
];

/**
 * The transition when a mounted page goes into or out of cram mode (owner, 2026-11-22): a dive
 * (`cramDive`). At the switch a strip of water covers the page, light at the top (the ocean) and dark
 * at the bottom (the abyss, cram mode's sea), and scrolls past with bubbles in it, down into cram and
 * back up out of it, then fades. Nothing on first render or on navigation, nor with reduced motion.
 * Render it outside the page's `data-cram`, so `ocean` is the light sea.
 */
export function CramCurtain({ cram }: { cram: boolean }) {
  const reduced = useReducedMotion();
  const [prev, setPrev] = useState(cram);
  const [run, setRun] = useState<{ into: boolean; n: number } | null>(null);
  if (cram !== prev) {
    setPrev(cram);
    setRun({ into: cram, n: (run?.n ?? 0) + 1 });
  }
  if (!run || reduced) return null;
  return (
    <motion.div
      key={run.n}
      aria-hidden
      data-part="cram-curtain"
      data-direction={run.into ? "in" : "out"}
      className="pointer-events-none fixed inset-x-0 bottom-0 top-(--topbar-h) z-40 overflow-hidden"
      {...cramDiveFade}
      onAnimationComplete={() => setRun(null)}
    >
      <motion.div className="absolute inset-x-0 top-0 h-[300%] bg-linear-to-b from-ocean from-10% to-abyss to-90%" {...cramDive(run.into)}>
        {BUBBLES.map(([x, y, r], i) => (
          <span
            key={i}
            className="absolute rounded-full border-2 border-parchment/60 bg-parchment/15"
            style={{ left: `${x}%`, top: `${y}%`, width: r, height: r }}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}

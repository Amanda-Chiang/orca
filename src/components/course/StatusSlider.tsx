"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import type { WeakSpotStatus } from "@/lib/mastery/progress";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** The three stops, left to right. */
export const STOPS: readonly WeakSpotStatus[] = ["needs-review", "in-progress", "mastered"];
export const STOP_LABEL: Record<WeakSpotStatus, string> = { "needs-review": "Needs review", "in-progress": "In progress", mastered: "Mastered" };
const STOP_LOOK: Record<WeakSpotStatus, string> = {
  "needs-review": "bg-bad-tint text-bad-text",
  "in-progress": "bg-warn-tint text-warn-text",
  mastered: "bg-good-tint text-good-deep",
};
const SEGMENT = 92;

/**
 * A topic's status in the List view as a 3-stop track (owner, 2026-11-22): the thumb sits on the
 * current status in the Atlas's colours; drag it or tap a stop to ask for another one. `canPick`
 * says which stops can be asked for (the others snap back). The parent confirms; while `pending` is
 * set the thumb waits there, and it returns to `status` when the parent clears it.
 */
export function StatusSlider({
  status,
  pending,
  canPick,
  onPick,
  label,
}: {
  status: WeakSpotStatus;
  pending: WeakSpotStatus | null;
  canPick: (s: WeakSpotStatus) => boolean;
  onPick: (s: WeakSpotStatus) => void;
  label: string;
}) {
  const shown = pending ?? status;
  const x = useMotionValue(STOPS.indexOf(shown) * SEGMENT);
  const dragged = useRef(false);
  useEffect(() => {
    const controls = animate(x, STOPS.indexOf(shown) * SEGMENT, spring);
    return () => controls.stop();
  }, [shown, x]);

  const pick = (s: WeakSpotStatus) => {
    if (s !== status && canPick(s)) onPick(s);
    else animate(x, STOPS.indexOf(shown) * SEGMENT, spring);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-part="status-slider"
      data-status={status}
      className="relative flex h-[34px] shrink-0 rounded-pill bg-alice p-[2px]"
      style={{ width: SEGMENT * STOPS.length + 4 }}
    >
      {STOPS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === status}
          aria-disabled={s !== status && !canPick(s)}
          data-part="status-stop"
          data-stop={s}
          onClick={() => {
            if (dragged.current) return;
            pick(s);
          }}
          className={cn(
            "z-0 flex h-full items-center justify-center rounded-pill text-[12px] font-bold text-prussian/45",
            s !== status && canPick(s) ? "cursor-pointer hover:text-prussian/70" : "cursor-default",
          )}
          style={{ width: SEGMENT }}
        >
          {STOP_LABEL[s]}
        </button>
      ))}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: SEGMENT * (STOPS.length - 1) }}
        dragElastic={0}
        dragMomentum={false}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={() => {
          const index = Math.max(0, Math.min(STOPS.length - 1, Math.round(x.get() / SEGMENT)));
          pick(STOPS[index]);
          // The click that ends a drag lands on a stop: let it pass before taps count again.
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
        style={{ x, width: SEGMENT }}
        data-part="status-pill"
        className={cn(
          "absolute left-[2px] top-[2px] z-10 flex h-[30px] cursor-grab items-center justify-center gap-[5px] rounded-pill text-[13px] font-bold shadow-[0_2px_0_var(--color-alice-deep)] active:cursor-grabbing",
          STOP_LOOK[shown],
        )}
      >
        {shown === "mastered" && (
          <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {STOP_LABEL[shown]}
      </motion.div>
    </div>
  );
}

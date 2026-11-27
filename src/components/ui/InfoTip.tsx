"use client";

import { type ReactNode, useId, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { IconInfo } from "@/components/icons";
import type { Box } from "@/lib/anchor-geometry";
import { cn } from "@/lib/cn";
import { AnchoredBubble } from "./AnchoredBubble";

/**
 * An info icon beside a label: one or two sentences on hover or focus (CLAUDE.md: explanations go
 * behind an icon, not under every heading). The text is also the button's accessible description.
 */
export function InfoTip({ children, label = "More info", width = 280, className }: { children: ReactNode; label?: string; width?: number; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const id = useId();
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
  };
  const hide = () => setBox(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (box) hide();
          else show();
        }}
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full align-middle text-wisteria-deep hover:text-prussian focus-visible:outline-2 focus-visible:outline-wisteria", className)}
        data-part="info-tip"
      >
        <IconInfo size={16} />
      </button>
      <span id={id} className="sr-only">{children}</span>
      <AnimatePresence>
        {box && (
          <AnchoredBubble target={box} width={width} preferredSide="below" role="tooltip" tip className="pointer-events-none" data-part="info-tip-bubble">
            <span className="block text-[13px] font-medium leading-snug text-prussian">{children}</span>
          </AnchoredBubble>
        )}
      </AnimatePresence>
    </>
  );
}

"use client";

import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";
import { RoundButton } from "@/components/ui/RoundButton";
import { overlayFade, popIn } from "@/lib/motion";

/**
 * One connection on Settings → Connections: its name (what it does behind the info icon), a one-line
 * status and its actions, sized to share a 2×2 grid that fits the window (owner, 2026-11-27: no
 * scrolling). Setup steps and links shown once open in a SetupDialog instead of growing the tile.
 */
export function ConnectionTile({ title, info, status, actions, confirm, problem, ...rest }: {
  title: string;
  info: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  /** An inline "are you sure?" row under the actions. */
  confirm?: ReactNode;
  problem?: string | null;
} & { id?: string; [attribute: `data-${string}`]: string | undefined }) {
  return (
    <Card radius={24} lip={5} className="flex min-w-0 flex-col gap-[10px] px-[20px] pb-[18px] pt-[16px]" {...rest}>
      <h2 className="flex items-center gap-[8px] text-[19px] font-bold leading-tight text-prussian">
        {title}
        <InfoTip label={`About ${title}`}>{info}</InfoTip>
      </h2>
      <div className="text-[13px] font-semibold leading-snug text-prussian">{status}</div>
      <div className="mt-auto flex flex-wrap items-center gap-[10px] pt-[4px]">{actions}</div>
      {confirm}
      {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
    </Card>
  );
}

/** The "are you sure?" row a tile shows before disconnecting. */
export function ConfirmRow({ children, ...rest }: { children: ReactNode } & { [attribute: `data-${string}`]: string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-[8px] rounded-[14px] border-2 border-alice-deep bg-alice px-[12px] py-[8px]" {...rest}>
      {children}
    </div>
  );
}

const noSubscribe = () => () => {};

/** A connection's setup (a form, or a link shown once), over the page; Escape or the X closes it. */
export function SetupDialog({ open, title, onClose, children, ...rest }: { open: boolean; title: string; onClose: () => void; children: ReactNode } & { [attribute: `data-${string}`]: string | undefined }) {
  // False on the server and while hydrating, true after: the portal needs document.body.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  // On document.body: the settings section animates with a transform, which would pin a fixed overlay to it.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full w-[520px] max-w-full flex-col gap-[14px] overflow-y-auto rounded-[24px] bg-parchment px-[28px] pb-[24px] pt-[24px] text-left lip-6 lip-alice"
            {...rest}
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[16px] top-[16px]">
              <IconClose size={16} />
            </RoundButton>
            <h2 className="pr-[52px] text-[20px] font-bold leading-tight text-prussian">{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

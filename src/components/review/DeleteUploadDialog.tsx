"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { overlayFade, popIn } from "@/lib/motion";

/**
 * The confirmation behind a built upload's Delete button (owner, 2026-11-24): says what deleting a
 * file does before it happens (DELETE /api/materials/:id, the soft delete `removeMaterial` runs).
 */
export function DeleteUploadDialog({ open, filename, built = true, deleting = false, error = null, onConfirm, onClose }: { open: boolean; filename: string; built?: boolean; deleting?: boolean; error?: string | null; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-upload-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-[440px] max-w-full flex-col gap-[16px] rounded-[24px] bg-parchment px-[28px] pb-[24px] pt-[24px] text-left lip-6 lip-alice"
            data-part="delete-upload-dialog"
          >
            <RoundButton size={44} label="Close" onClick={onClose} disabled={deleting} className="absolute right-[16px] top-[16px]">
              <IconClose size={18} />
            </RoundButton>
            <div className="flex min-w-0 flex-col gap-[2px] pr-[52px]">
              <h2 id="delete-upload-title" className="text-[20px] font-bold leading-tight text-prussian">
                Delete this file?
              </h2>
              <span className="truncate text-[14px] font-semibold text-wisteria-deep" title={filename}>
                {filename}
              </span>
            </div>
            <ul className="flex list-disc flex-col gap-[6px] pl-[18px] text-[14px] leading-snug text-prussian/80">
              <li>The file and its pages are deleted from Orca.</li>
              {built ? (
                <>
                  <li>Topics and objectives only this file taught leave your course, with their questions.</li>
                  <li>Anything another file also teaches stays, and your answers and progress are kept.</li>
                </>
              ) : (
                <li>Nothing was built from it yet, so your topics and objectives don&apos;t change.</li>
              )}
            </ul>
            {error && <p role="alert" className="text-[13px] font-semibold text-bad-text">{error}</p>}
            <div className="flex items-center justify-end gap-[10px]" aria-live="polite">
              <Button size="sm" variant="ghost" onClick={onClose} disabled={deleting}>
                Keep it
              </Button>
              <Button size="sm" variant="danger" onClick={onConfirm} disabled={deleting} data-part="remove-confirm">
                {deleting ? "Deleting…" : "Delete file"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

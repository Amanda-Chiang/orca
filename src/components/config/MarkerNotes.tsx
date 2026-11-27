"use client";

import { LIMITS } from "@/lib/limits";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * How the student marks confusion in their handwritten notes (weak points first, Plan B). When Orca
 * reads handwritten or scanned pages it looks for these marks, and what's marked becomes a weak point
 * to practise. Per account only; the save route screens it like Notes for Orca.
 */
export function MarkerNotes({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Card className="flex flex-col gap-[10px] px-[22px] pb-[16px] pt-[18px]" data-part="marker-notes">
      <div className="flex items-center justify-between gap-[10px]">
        <h2 className="flex items-center gap-[8px] text-[20px] font-bold text-prussian">
          How do you mark confusion in your notes?
          <InfoTip label="About confusion marks">Orca looks for these marks when it reads your handwritten notes, and practises what you marked.</InfoTip>
        </h2>
        <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">
          {value.length.toLocaleString()} / {LIMITS.markerChars.toLocaleString()}
        </span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LIMITS.markerChars}
        aria-label="How you mark confusion in your notes"
        placeholder="e.g. ★ = lost, ? in the margin, red ink = ask in office hours"
        className="h-[44px] w-full rounded-[14px] border-2 border-alice-deep bg-parchment px-[14px] text-[15px] text-prussian outline-none focus:border-wisteria"
      />
    </Card>
  );
}

"use client";

import { LIMITS } from "@/lib/limits";
import { Card } from "@/components/ui/Card";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Notes for Orca (owner, 2026-10-25): what the student knows about a class, in their own words.
 * The writing steps follow them within fixed rules (src/lib/pipeline/prompts.ts); the save routes
 * screen them. One for all classes (Settings) and one per class (the course's settings).
 * Settings calls its box "Your study preferences" (owner, 2026-11-08): what holds in every class
 * is general preferences for topics, objectives and questions. Same data and prompts either way.
 */
const COPY = {
  account: {
    title: "Your study preferences",
    eyebrow: "For all your classes",
    body: "Any general preferences for how Orca determines topics, objectives and questions. Applies to what it writes from now on.",
    placeholder: "e.g. Only conceptual questions, no plain calculations.",
  },
  course: {
    title: "Notes for Orca",
    eyebrow: "For this class",
    body: "Tell Orca what your professor cares about. Shapes the topics and questions it writes.",
    placeholder: "e.g. The exam will be very similar to past exams. The professor doesn't care about proofs, only applications.",
  },
} as const;

export function NotesForOrca({ scope, value, onChange }: { scope: "account" | "course"; value: string; onChange: (value: string) => void }) {
  const copy = COPY[scope];
  return (
    <Card className="flex flex-col gap-[10px] px-[22px] pb-[16px] pt-[18px]" data-part="notes-for-orca">
      <div className="flex flex-col gap-[2px]">
        <h2 className="flex items-center gap-[8px] text-[20px] font-bold text-prussian">
          {copy.title}
          <InfoTip label={`About ${copy.title}`}>{copy.body}</InfoTip>
        </h2>
        <p className="eyebrow text-wisteria-deep">{copy.eyebrow}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LIMITS.notesChars}
        rows={4}
        aria-label={copy.title}
        placeholder={copy.placeholder}
        className="min-h-[100px] w-full resize-y rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
      />
      <p className="-mt-[4px] self-end text-[12px] font-semibold text-wisteria-deep">
        {value.length.toLocaleString()} / {LIMITS.notesChars.toLocaleString()}
      </p>
    </Card>
  );
}

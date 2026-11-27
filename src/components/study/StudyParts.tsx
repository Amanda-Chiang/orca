"use client";

import { hoursMinutes, type StudySource } from "@/lib/course/study-time";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * The pieces the progress page and the cram page's Your Progress share (owner, 2026-11-22: the cram
 * view mirrors the overall one): the sources' colors, the stat tile with its colored stripe, and
 * "Where the time went".
 */
export const SOURCE_STYLE: ReadonlyArray<{ key: StudySource; label: string; color: string }> = [
  { key: "app", label: "In Orca", color: "bg-wisteria" },
  { key: "claude", label: "With your AI", color: "bg-study-coral" },
  { key: "timer", label: "Study timer", color: "bg-study-mint" },
];

/** The tiles' stripes, in order. */
export const TILE_ACCENTS = ["bg-study-sky", "bg-study-gold", "bg-study-rose", "bg-study-mint"] as const;

export function StatTile({ label, value, note, accent, share, part, compact = false }: { label: string; value: string; note?: string | null; accent: string; share?: number | null; part: string; compact?: boolean }) {
  // Compact: one line (label, then the value and its note), for a page that fits the window.
  if (compact)
    return (
      <Card radius={18} lip={4} className="relative flex items-center gap-[10px] overflow-hidden py-[12px] pl-[20px] pr-[16px]" data-part={`${part}-tile`}>
        <span className={`absolute inset-y-0 left-0 w-[6px] ${accent}`} aria-hidden />
        <p className="eyebrow shrink-0 text-[12px] text-wisteria-deep">{label}</p>
        <p className="ml-auto flex min-w-0 items-baseline gap-[6px]">
          {note && (
            <span className="truncate text-[11px] font-semibold text-wisteria-deep" title={note} data-part={`${part}-note`}>
              {note}
            </span>
          )}
          <span className="shrink-0 text-[22px] font-bold leading-none text-prussian" data-part={part}>
            {value}
          </span>
        </p>
      </Card>
    );
  return (
    <Card radius={20} lip={4} className="relative flex flex-col gap-[6px] overflow-hidden px-[18px] pb-[14px] pt-[18px]" data-part={`${part}-tile`}>
      <span className={`absolute inset-x-0 top-0 h-[6px] ${accent}`} aria-hidden />
      <p className="eyebrow text-[12px] text-wisteria-deep">{label}</p>
      <p className="text-[28px] font-bold leading-none text-prussian" data-part={part}>
        {value}
      </p>
      {share !== undefined && share !== null && <ProgressBar value={Math.min(1, Math.max(0, share))} height={6} label={label} />}
      {note && (
        <p className="text-[12px] font-semibold text-wisteria-deep" data-part={`${part}-note`}>
          {note}
        </p>
      )}
    </Card>
  );
}

/** Where the time went: one bar split by source, then each source's minutes. */
export function SourcesCard({ totals, title = "Where the time went" }: { totals: Record<StudySource, number>; title?: string }) {
  const all = SOURCE_STYLE.reduce((s, t) => s + totals[t.key], 0);
  return (
    <Card radius={24} lip={5} className="flex flex-1 flex-col gap-[10px] px-[22px] pb-[18px] pt-[18px]" data-part="progress-sources">
      <h2 className="text-[20px] font-bold text-prussian">{title}</h2>
      <div className="flex h-[14px] w-full overflow-hidden rounded-pill bg-alice">
        {all > 0 && SOURCE_STYLE.map((t) => <div key={t.key} className={t.color} style={{ width: `${(totals[t.key] / all) * 100}%` }} />)}
      </div>
      <ul className="flex flex-col gap-[4px]">
        {SOURCE_STYLE.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-[8px] text-[14px] font-semibold text-prussian" data-part="progress-source" data-source={t.key}>
            <span>
              <span className={`mr-[6px] inline-block h-[10px] w-[10px] rounded-full align-middle ${t.color}`} />
              {t.label}
            </span>
            <span className="text-wisteria-deep">{hoursMinutes(totals[t.key])}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

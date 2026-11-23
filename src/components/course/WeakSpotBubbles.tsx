"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { CramPlan, CramPlanInput } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { floatIsland } from "@/lib/motion";
import { MASTERY_LABEL } from "@/components/review/parts";

/** A weak spot's fill by status: the further from mastered, the deeper the color. */
const FILL: Partial<Record<ObjectiveStatus, string>> = {
  "mixed-up": "bg-wisteria text-parchment ring-wisteria-deep",
  learning: "bg-periwinkle text-prussian ring-periwinkle-deep",
  fading: "bg-alice text-prussian ring-alice-deep",
  "check-due": "bg-alice text-prussian ring-alice-deep",
  mastered: "bg-parchment text-prussian ring-wisteria",
};
const FALLBACK = "bg-alice text-prussian ring-alice-deep";
const MIN = 84;
const MAX = 128;

/**
 * The cram page's weak spots as bubbles (owner, 2026-11-22: a map, not a list): one cluster per
 * topic (or kind of problem) in scope, each weak spot a bubble sized by its weight in the exam and
 * colored by its status, bobbing like the islands. Hover shows the whole objective; a click opens the
 * topic's quiz. A topic with no weak spots stays as a faded outline so the exam's whole shape shows.
 */
export function WeakSpotBubbles({ plan, topics, slug, objectiveName }: { plan: CramPlan; topics: CramPlanInput["topics"]; slug: string; objectiveName: (id: string) => string }) {
  const objective = new Map(topics.flatMap((t) => t.objectives.map((o) => [o.id, o] as const)));
  const weights = plan.topics.flatMap((t) => t.weakSpots.map((id) => objective.get(id)?.weight ?? 0));
  const lo = Math.min(...weights, 1);
  const hi = Math.max(...weights, 1);
  const size = (w: number) => (hi === lo ? (MIN + MAX) / 2 : MIN + ((w - lo) / (hi - lo)) * (MAX - MIN));
  const count = weights.length;
  const quizzable = plan.unit === "topic";
  // Each bubble bobs on its own beat (floatIsland's seed), numbered in page order.
  const seedOf = new Map(plan.topics.flatMap((t) => t.weakSpots).map((id, i) => [id, i]));
  return (
    <div className="flex flex-col gap-[10px]" data-part="cram-weak">
      <div className="flex items-baseline justify-between gap-[12px]">
        <h2 className="text-[20px] font-bold text-prussian">Weak spots{count ? ` · ${count}` : ""}</h2>
        <p className="text-[12px] font-semibold text-wisteria-deep">Bigger counts for more on the exam · darker needs more work</p>
      </div>
      {count === 0 && <p className="text-[13px] font-medium text-wisteria-deep">None flagged in scope.</p>}
      <ul className="flex flex-wrap items-start gap-x-[28px] gap-y-[16px]">
        {plan.topics.map((t) => (
          <li key={t.id} className="flex max-w-[420px] flex-col items-center gap-[8px]" data-part="cram-weak-topic" data-topic={t.id} data-empty={t.weakSpots.length ? undefined : "1"}>
            <p className={`max-w-full truncate text-[13px] font-bold ${t.weakSpots.length ? "text-prussian" : "text-wisteria-deep"}`} title={t.name}>{t.name}</p>
            {t.weakSpots.length === 0 ? (
              <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full text-center text-[11px] font-semibold text-wisteria-deep border-2 border-dashed border-alice-deep opacity-70">
                No weak spots
              </div>
            ) : (
              <ul className="flex flex-wrap items-center justify-center gap-[8px]">
                {t.weakSpots.map((id) => {
                  const o = objective.get(id);
                  const status = o?.status ?? "unseen";
                  const d = size(o?.weight ?? lo);
                  const name = objectiveName(id);
                  const bubble = (
                    <span className="flex h-full w-full items-center justify-center rounded-full px-[10px] text-center text-[11px] font-semibold leading-tight">
                      <span className="line-clamp-4">{name}</span>
                    </span>
                  );
                  const look = `pressable flex rounded-full ring-2 ring-inset lip-3 lip-alice ${FILL[status] ?? FALLBACK}`;
                  const label = `${name} · ${MASTERY_LABEL[status]}`;
                  return (
                    <motion.li key={id} animate={floatIsland(seedOf.get(id) ?? 0)} style={{ width: d, height: d }} data-part="cram-weak-item" data-objective={id} data-status={status}>
                      {quizzable ? (
                        <Link href={`/quiz/${slug}/${t.id}`} title={label} aria-label={label} className={`${look} h-full w-full`}>
                          {bubble}
                        </Link>
                      ) : (
                        <span title={label} className={`${look} h-full w-full`}>
                          {bubble}
                        </span>
                      )}
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap gap-[12px] text-[12px] font-semibold text-wisteria-deep" aria-label="Key">
        <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-full bg-wisteria align-middle" />Mixed up</span>
        <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-full bg-periwinkle align-middle" />Learning</span>
        <span><span className="mr-[4px] inline-block h-[10px] w-[10px] rounded-full bg-alice ring-1 ring-alice-deep align-middle" />Due for a check</span>
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Course, Objective, PipelineRun } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { rejectObjective, rejectTopic } from "@/lib/course/ops";
import { InlineConfirm } from "@/components/ui/InlineConfirm";

/** Follow merges to the objective an id lives on as now (a merged duplicate points at its survivor). */
function current(catalogue: Readonly<Record<string, Objective>>, id: string): Objective | undefined {
  let o = catalogue[id];
  for (let hops = 0; o?.mergedInto && hops < 20; hops++) o = catalogue[o.mergedInto];
  return o;
}

/**
 * What an upload built, as a dropdown under its summary line (owner, 2026-11-24): "Added topics and
 * objectives" lists the topics it created or added to; each opens (one at a time) to its objectives.
 * New ones carry a ★; the rest were already in the course and this file covers them again. As they
 * are now (merges followed; objectives since archived left out), from the run's own record.
 * Each topic and objective can be rejected here, the same rejection as the Review tab (archived, and
 * restorable from the course's Objectives page); a topic asks first, since its objectives go with it.
 */
export function WhatItAdded({ run, course }: { run: PipelineRun; course: Course }) {
  const { objectives, editStructure } = useOrca();
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const edit = editStructure.bind(null, course.id);
  const catalogue = objectives[course.id] ?? {};
  const isNew = new Set(run.objectivesCreated);
  const seen = new Set<string>();
  const byTopic = new Map<string, Array<{ objective: Objective; fresh: boolean }>>();
  for (const id of [...run.objectivesCreated, ...run.objectivesAttached]) {
    const o = current(catalogue, id);
    if (!o || o.review === "archived" || seen.has(o.id)) continue;
    seen.add(o.id);
    const list = byTopic.get(o.topicId) ?? [];
    list.push({ objective: o, fresh: isNew.has(id) });
    byTopic.set(o.topicId, list);
  }
  const newTopics = new Set(run.topicsCreated);
  // In the course's trail order; a topic the upload created but that has nothing live left still shows.
  const topics = course.topics.filter((t) => t.review !== "archived" && (byTopic.has(t.id) || newTopics.has(t.id)));
  if (topics.length === 0) return null;

  const star = <span className="text-wisteria-deep" aria-label="new">★</span>;
  return (
    <details className="text-[14px] text-prussian" data-part="what-it-added">
      <summary className="cursor-pointer font-semibold text-wisteria-deep">Added topics and objectives</summary>
      <ul className="mt-[6px] flex flex-col gap-[2px]">
        {topics.map((t) => {
          const list = byTopic.get(t.id) ?? [];
          const open = openTopic === t.id;
          const fresh = list.filter((x) => x.fresh).length;
          return (
            <li key={t.id} className="flex flex-col" data-part="added-topic">
              <div className="group/topic flex items-center gap-[12px]">
              <button
                type="button"
                aria-expanded={open}
                disabled={list.length === 0}
                onClick={() => setOpenTopic(open ? null : t.id)}
                className="flex items-center gap-[8px] rounded-[8px] py-[4px] text-left font-bold hover:text-wisteria-deep disabled:cursor-default disabled:hover:text-prussian"
              >
                <span className={`w-[10px] shrink-0 text-[10px] text-wisteria-deep transition-transform ${open ? "rotate-90" : ""}`}>{list.length ? "▶" : ""}</span>
                <span>{t.name}</span>
                {newTopics.has(t.id) && star}
                <span className="text-[12px] font-medium text-prussian/50">
                  {list.length} objective{list.length === 1 ? "" : "s"}
                  {fresh > 0 && fresh < list.length ? ` · ${fresh} new` : ""}
                </span>
              </button>
              {rejecting !== t.id && (
                <button type="button" onClick={() => setRejecting(t.id)} className="shrink-0 text-[12px] font-bold text-bad-text opacity-0 hover:underline focus:opacity-100 group-hover/topic:opacity-100" data-part="reject-added-topic">
                  Reject topic
                </button>
              )}
              </div>
              {rejecting === t.id && (
                <span className="pb-[6px] pl-[18px] text-[13px] font-semibold text-prussian/80">
                  <InlineConfirm
                    question={`Reject ${t.name}? It and its ${list.length === 1 ? "objective" : `${list.length} objectives`} leave your course, including any other files teach. You can restore it from Objectives.`}
                    confirm="Reject"
                    cancel="Keep"
                    onConfirm={() => (setRejecting(null), edit((x) => rejectTopic(x, t.id)))}
                    onCancel={() => setRejecting(null)}
                    confirmPart="reject-added-topic-confirm"
                  />
                </span>
              )}
              {open && (
                <ul className="mb-[6px] flex flex-col gap-[4px] pl-[26px]">
                  {list.map(({ objective, fresh: isFresh }) => (
                    <li key={objective.id} className="group/objective flex items-baseline gap-[12px] text-prussian/80">
                      <span>
                        {objective.name} {isFresh && star}
                      </span>
                      <button type="button" onClick={() => edit((x) => rejectObjective(x, objective.id))} className="shrink-0 text-[12px] font-bold text-bad-text opacity-0 hover:underline focus:opacity-100 group-hover/objective:opacity-100" data-part="reject-added-objective">
                        Reject
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

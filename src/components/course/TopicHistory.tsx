"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { RoundButton } from "@/components/ui/RoundButton";
import { MathText } from "@/components/ui/MathText";
import { MASTERY_LABEL } from "@/components/review/parts";
import type { QuizQuestion } from "@/lib/data";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { objectiveHistory, type HistoryEntry } from "@/lib/mastery/history";
import { masteryPercent } from "@/lib/mastery/percent";
import type { EvidenceEvent, EvidenceSource, FlagSource, ObjectiveInfo, Outcome } from "@/lib/mastery/types";
import { ERROR_LABEL } from "@/lib/quiz/after-miss";
import { overlayFade, popIn } from "@/lib/motion";
import { cn } from "@/lib/cn";

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  quiz: "Topic quiz",
  "quick-review": "Quick review",
  "deep-review": "Dive",
  requiz: "Missed-question review",
  connector: "With your AI",
};
const FLAG_LABEL: Record<FlagSource, string> = {
  homework: "from a homework reflection",
  "handwritten-marker": "marked in your notes",
  connector: "your AI asked for a check",
  "connector-struggled": "you were stuck in the chat",
  slide: "a slide you found hard",
  manual: "you flagged it",
};
const RESULT: Record<Outcome, { mark: string; label: string; look: string }> = {
  correct: { mark: "✓", label: "Right", look: "bg-good-tint text-good-deep" },
  partial: { mark: "½", label: "Partly right", look: "bg-warn-tint text-warn-text" },
  incorrect: { mark: "✗", label: "Missed", look: "bg-bad-tint text-bad-text" },
};

/**
 * History (owner, 2026-11-25): for one topic of the List view, every attempt on each of its
 * objectives (questions in Orca, Orca's questions and Claude's problems through the connector),
 * newest first, with the result, the date and the change in mastery (the quiz's display percent,
 * before → after, replayed from the evidence). Flags and marks show as small marker rows, since they
 * move the percent too. A row opens to the whole question, the student's answer, the key and what
 * the grader said. Answers from before 2026-11-25 kept no answer text ("Not saved").
 */
export function TopicHistory({
  topic,
  mastery,
  catalogue,
  questions,
  onClose,
}: {
  topic: { id: string; name: string } | null;
  mastery: CourseMastery;
  catalogue: Readonly<Record<string, ObjectiveInfo>>;
  /** Every question of the course by id. */
  questions: ReadonlyMap<string, QuizQuestion>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!topic) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topic, onClose]);

  const sections = useMemo(() => {
    if (!topic) return [];
    const ids = mastery.topicObjectives.get(topic.id) ?? [];
    return ids
      .map((id) => {
        const options = mastery.foldOptions.get(id);
        if (!options) throw new Error(`No fold options for objective ${id}`);
        const state = mastery.objectives.get(id);
        if (!state) throw new Error(`No state computed for objective ${id}`);
        // Read-only signals (asked for the answer, or something harder) change nothing: left out.
        const entries = objectiveHistory(id, mastery.events, options).filter((h) => !(h.event.kind === "signal" && (h.event.signal === "asked-answer" || h.event.signal === "asked-harder")));
        return { id, name: catalogue[id]?.name ?? "This objective", state, entries: entries.reverse() };
      })
      .filter((s) => s.entries.length > 0)
      // Weak spots first (what the List is about), then the rest, each in course order.
      .sort((a, b) => Number(isWeak(b.state.status)) - Number(isWeak(a.state.status)));
  }, [topic, mastery, catalogue]);

  return (
    <AnimatePresence>
      {topic && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[86vh] w-[800px] max-w-full flex-col rounded-[32px] bg-parchment pb-[24px] pt-[28px] text-prussian lip-8 lip-alice"
            data-part="history-modal"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[22px] top-[22px]">
              <IconClose size={20} />
            </RoundButton>
            <div className="px-[32px] pr-[84px]">
              <p className="eyebrow text-wisteria-deep">History</p>
              <h2 id="history-title" className="text-[28px] font-bold leading-tight">
                {topic.name}
              </h2>
            </div>
            <div className="mt-[16px] flex flex-col gap-[22px] overflow-auto px-[32px]">
              {sections.length === 0 ? (
                <p className="text-[16px] text-wisteria-deep" data-part="history-empty">
                  Nothing answered on this topic yet. Questions you answer, here or with your AI, show up here.
                </p>
              ) : (
                sections.map((s) => (
                  <section key={s.id} data-part="history-objective" data-objective={s.id}>
                    <div className="flex items-baseline justify-between gap-[12px] border-b-2 border-alice pb-[6px]">
                      <h3 className="min-w-0 text-[17px] font-bold">
                        <MathText text={s.name} />
                      </h3>
                      <p className="shrink-0 text-[13px] font-semibold text-wisteria-deep">
                        {MASTERY_LABEL[s.state.status]} · {masteryPercent(s.state)}%
                      </p>
                    </div>
                    <ul className="mt-[6px] flex flex-col">
                      {s.entries.map((h) => (
                        <HistoryRow key={h.event.id} entry={h} questions={questions} />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const isWeak = (s: string) => s !== "unseen" && s !== "verified";

function HistoryRow({ entry, questions }: { entry: HistoryEntry; questions: ReadonlyMap<string, QuizQuestion> }) {
  const e = entry.event;
  const [open, setOpen] = useState(false);
  if (e.kind === "confusion" || e.kind === "mark" || e.kind === "signal") {
    return (
      <li className="flex items-center gap-[12px] py-[6px] text-[13px] text-wisteria-deep" data-part="history-marker" data-kind={e.kind}>
        <span className="w-[56px] shrink-0">{shortDate(e.at)}</span>
        <span className="min-w-0 flex-1 truncate font-semibold" title={e.kind === "confusion" && e.note ? e.note : undefined}>
          {markerText(e)}
        </span>
        <Change entry={entry} />
      </li>
    );
  }
  const q = e.kind === "answer" ? questions.get(e.questionId) : undefined;
  const prompt = e.kind === "work" ? e.problem : q?.prompt ?? null;
  const result = RESULT[e.outcome];
  const from = e.kind === "work" ? "Your AI's problem" : e.source === "connector" ? (q?.source === "claude" ? "Your AI's question" : "With your AI") : SOURCE_LABEL[e.source];
  return (
    <li className="border-b border-alice/70 last:border-b-0" data-part="history-attempt" data-outcome={e.outcome}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-[12px] py-[9px] text-left">
        <span className="w-[56px] shrink-0 text-[13px] font-semibold text-wisteria-deep">{shortDate(e.at)}</span>
        <span className={cn("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[14px] font-bold", result.look)} aria-label={result.label} title={result.label}>
          {result.mark}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[15px] font-semibold">{prompt === null ? <i className="text-wisteria-deep">This question is no longer in the course</i> : <MathText text={prompt} />}</span>
          <span className="text-[12px] text-wisteria-deep">
            {from}
            {e.help === "hint" ? " · with a hint" : e.help === "shown" ? " · answer shown" : ""}
            {e.kind === "answer" && e.grader === "self" ? " · marked by you" : ""}
          </span>
        </span>
        <Change entry={entry} />
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={cn("shrink-0 text-wisteria-deep transition-transform", open && "rotate-180")}>
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mb-[12px] ml-[68px] flex flex-col gap-[10px] rounded-[16px] bg-alice/60 px-[16px] py-[12px] text-[14px] leading-relaxed" data-part="history-detail">
          {prompt !== null && (
            <div>
              <Label>Question</Label>
              <p className="whitespace-pre-wrap">
                <MathText text={prompt} />
              </p>
            </div>
          )}
          <div>
            <Label>Your answer</Label>
            {e.response ? (
              <p className="whitespace-pre-wrap" data-part="history-response">
                <MathText text={e.response} />
              </p>
            ) : (
              <p className="italic text-wisteria-deep" data-part="history-response">
                {e.kind === "answer" && e.grader === "self" && e.outcome === "incorrect" ? "Don't know, or not saved" : "Not saved"}
              </p>
            )}
          </div>
          {q && (
            <div>
              <Label>Answer</Label>
              <p className="whitespace-pre-wrap" data-part="history-key">
                <MathText text={keyOf(q)} />
              </p>
            </div>
          )}
          {e.kind === "answer" && e.graderNote && (
            <div data-part="history-grader">
              <Label>What the grader said</Label>
              {e.graderNote.feedback && <p>{e.graderNote.feedback}</p>}
              {e.graderNote.satisfied.length > 0 && <p className="text-good-text">Got: {e.graderNote.satisfied.join(" · ")}</p>}
              {e.graderNote.misconception && <p className="text-bad-text">Mix-up: {e.graderNote.misconception}</p>}
            </div>
          )}
          {e.errorType && (
            <p className="text-[13px] font-semibold text-wisteria-deep">
              Kind of mistake: {ERROR_LABEL[e.errorType]}
            </p>
          )}
          {e.kind === "work" && <p className="text-[13px] text-wisteria-deep">{e.basis === "claude" ? "Judged by your AI" : e.basis === "official-solution" ? "Checked against the official solution" : "Checked against a known answer"}</p>}
          {q?.explanation && (
            <div>
              <Label>Why</Label>
              <p className="whitespace-pre-wrap">
                <MathText text={q.explanation} />
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[1.2px] text-wisteria-deep">{children}</p>;
}

/** The change in mastery, "0% → 13%", coloured by direction. */
function Change({ entry }: { entry: HistoryEntry }) {
  const d = entry.after - entry.before;
  return (
    <span
      className={cn("w-[112px] shrink-0 text-right text-[13px] font-bold tabular-nums", d > 0 ? "text-good-deep" : d < 0 ? "text-bad-text" : "text-wisteria-deep")}
      data-part="history-change"
      title={`${MASTERY_LABEL[entry.statusBefore]} → ${MASTERY_LABEL[entry.statusAfter]}`}
    >
      {entry.before}% → {entry.after}%
    </span>
  );
}

function markerText(e: Extract<EvidenceEvent, { kind: "confusion" | "mark" | "signal" }>): string {
  if (e.kind === "mark") return "You marked it mastered";
  if (e.kind === "signal") return e.signal === "got-it" ? "You told your AI you got it: a check is due" : "You told your AI you were lost";
  const what = e.flagSource === "connector" ? "Check requested" : "Flagged as hard";
  return `${what}: ${FLAG_LABEL[e.flagSource]}${e.note ? ` (“${e.note}”)` : ""}`;
}

function keyOf(q: QuizQuestion): string {
  if (q.kind !== "Short answer") return q.options[q.answer] ?? "";
  return q.exact?.[0] ?? q.rubric?.requiredIdeas.join(" · ") ?? "";
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

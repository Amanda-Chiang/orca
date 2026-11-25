"use client";

import { FeedbackPrompt } from "@/components/feedback/FeedbackPrompt";
import { Card } from "@/components/ui/Card";

/** Settings → Feedback (owner, 2026-11-25): a place that's always there to tell us what to fix. */
export function FeedbackCard() {
  return (
    <Card id="feedback" className="flex flex-col gap-[12px] scroll-mt-[24px] px-[24px] pb-[22px] pt-[20px]" data-part="feedback-card">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Tell us what to fix</h2>
        <p className="text-[14px] font-medium text-wisteria-deep">
          Orca is new and you&apos;re one of its first students. What got in your way, what you wished it did, what you liked: a line here goes straight to the people building it.
        </p>
      </div>
      <FeedbackPrompt spot="settings" always question="How is Orca working for you?" />
    </Card>
  );
}

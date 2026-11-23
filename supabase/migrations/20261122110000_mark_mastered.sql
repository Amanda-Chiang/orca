-- The student can mark a weak spot mastered from the course's List view (owner, 2026-11-22: "trust
-- the student"; mastery rules v5, src/lib/mastery/objective-state.ts applyMark). A mark is its own
-- evidence kind with nothing but the objective and the time; only POST /api/evidence writes it.
alter table public.evidence_events drop constraint evidence_events_kind_check;
alter table public.evidence_events add constraint evidence_events_kind_check check (kind in ('answer', 'confusion', 'work', 'signal', 'mark'));
alter table public.evidence_events add constraint evidence_events_mark_check check (
  kind <> 'mark' or (
    question_id is null and tier is null and outcome is null and grader is null and source is null and session_id is null
    and material_id is null and note is null and flag_source is null and page is null and help is null and confidence is null
    and error_type is null and problem is null and basis is null and signal is null
  )
);
comment on column public.evidence_events.kind is 'answer, confusion (a struggle flag), work and signal (from the connector), or mark (the student marked the objective mastered).';

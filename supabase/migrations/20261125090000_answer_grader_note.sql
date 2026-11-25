-- The List view's History (owner, 2026-11-25): each attempt shows the student's own answer and, for
-- a prose answer graded against its rubric, what the grader said. Answers in the app now send the
-- student's words (kept in `note`, as connector answers already were) and the grader's note goes in
-- this column. Display only: the fold never reads either, so mastery is unchanged (no rules bump).
alter table public.evidence_events
  add column grader_note jsonb
    constraint evidence_events_grader_note_check check (
      grader_note is null
      or (
        kind = 'answer'
        and grader = 'rubric'
        and jsonb_typeof(grader_note) = 'object'
        and jsonb_typeof(grader_note->'feedback') = 'string'
        and char_length(grader_note->>'feedback') <= 2000
        and (grader_note->'misconception' is null or jsonb_typeof(grader_note->'misconception') in ('string', 'null'))
        and (grader_note->'satisfied' is null or jsonb_typeof(grader_note->'satisfied') = 'array')
      )
    );

comment on column public.evidence_events.grader_note is 'Rubric-graded answers: what the grader said ({ feedback, satisfied, misconception }), shown in the List view''s History. Never read by the fold.';

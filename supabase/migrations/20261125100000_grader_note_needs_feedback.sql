-- 20261125090000's check let a grader note without "feedback" through: jsonb_typeof of a missing key
-- is null, and a CHECK whose expression is null passes. Rebuilt so every part is true or false.
alter table public.evidence_events drop constraint evidence_events_grader_note_check;
alter table public.evidence_events
  add constraint evidence_events_grader_note_check check (
    grader_note is null
    or coalesce(
      kind = 'answer'
      and grader = 'rubric'
      and jsonb_typeof(grader_note) = 'object'
      and jsonb_typeof(grader_note->'feedback') = 'string'
      and char_length(grader_note->>'feedback') <= 2000
      and (grader_note->'misconception' is null or jsonb_typeof(grader_note->'misconception') in ('string', 'null'))
      and (grader_note->'satisfied' is null or jsonb_typeof(grader_note->'satisfied') = 'array'),
      false
    )
  );

-- 20261125090000's check leaned on a CHECK passing when its expression is null. Rebuilt so every part
-- is plainly true or false: a part of the note we don't have may be missing, a part that's there must
-- have the right type.
alter table public.evidence_events drop constraint evidence_events_grader_note_check;
alter table public.evidence_events
  add constraint evidence_events_grader_note_check check (
    grader_note is null
    or coalesce(
      kind = 'answer'
      and grader = 'rubric'
      and jsonb_typeof(grader_note) = 'object'
      and (grader_note->'feedback' is null or (jsonb_typeof(grader_note->'feedback') = 'string' and char_length(grader_note->>'feedback') <= 2000))
      and (grader_note->'misconception' is null or jsonb_typeof(grader_note->'misconception') in ('string', 'null'))
      and (grader_note->'satisfied' is null or jsonb_typeof(grader_note->'satisfied') = 'array'),
      false
    )
  );

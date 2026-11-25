-- The rubric grader's note (2026-11-25, List view History): only on a rubric-graded answer, an object
-- with a string feedback; satisfied an array and misconception a string or null when present.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

\set A aaaaaaaa-0000-4000-8000-000000000271
\set course c0000000-0000-4000-8000-000000000271
\set topic  e0000000-0000-4000-8000-000000000271
\set obj    f0000000-0000-4000-8000-000000000271
\set q      a1000000-0000-4000-8000-000000000271

insert into auth.users (id, email) values (:'A', 'a27@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');
insert into public.questions (id, owner_id, course_id, topic_id, objective_id, kind, topic_name, prompt, options, answer, explanation, sort_order, rubric)
  values (:'q', :'A', :'course', :'topic', :'obj', 'Short answer', 'Adders', 'Why?', '{}', -1, 'Because.', 0,
    '{"requiredIdeas": ["carries are saved"], "acceptableAlternatives": [], "knownMisconceptions": []}');

-- One answer row per case: grader and note vary.
create function pg_temp.answer(id text, grader text, note jsonb) returns text language sql as $$
  select format($f$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, question_id, outcome, grader, source, session_id, note, grader_note)
    values (%L, 'aaaaaaaa-0000-4000-8000-000000000271', 'answer', now(), 'c0000000-0000-4000-8000-000000000271', 'e0000000-0000-4000-8000-000000000271',
      'f0000000-0000-4000-8000-000000000271', 'a1000000-0000-4000-8000-000000000271', 'partial', %L, 'quiz', 's', 'my words', %L)$f$, id, grader, note)
$$;

select lives_ok(pg_temp.answer('b1000000-0000-4000-8000-000000000271', 'rubric', '{"feedback": "Close.", "satisfied": ["the sign bit"], "misconception": null}'),
  'a rubric answer takes a full note');
select lives_ok(pg_temp.answer('b2000000-0000-4000-8000-000000000271', 'rubric', '{"feedback": "Close."}'),
  'satisfied and misconception may be left out');
select lives_ok(pg_temp.answer('b3000000-0000-4000-8000-000000000271', 'choice', null),
  'any answer may have no note (and older rows have none)');
select throws_ok(pg_temp.answer('b4000000-0000-4000-8000-000000000271', 'choice', '{"feedback": "Right."}'),
  '23514', null, 'a choice answer carries no grader note');
select throws_ok(pg_temp.answer('b5000000-0000-4000-8000-000000000271', 'self', '{"feedback": "Right."}'),
  '23514', null, 'a self-marked answer carries no grader note');
select throws_ok(pg_temp.answer('b6000000-0000-4000-8000-000000000271', 'rubric', '{"satisfied": []}'),
  '23514', null, 'a note needs its feedback');
select throws_ok(pg_temp.answer('b7000000-0000-4000-8000-000000000271', 'rubric', '{"feedback": 3}'),
  '23514', null, 'feedback is a string');
select throws_ok(pg_temp.answer('b8000000-0000-4000-8000-000000000271', 'rubric', '{"feedback": "Close.", "satisfied": "the sign bit"}'),
  '23514', null, 'satisfied is an array');
select throws_ok(pg_temp.answer('ba000000-0000-4000-8000-000000000271', 'rubric', '"Close."'),
  '23514', null, 'a note is an object');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, grader_note)
  values ('b9000000-0000-4000-8000-000000000271', %L, 'mark', now(), %L, %L, %L, '{"feedback": "x"}')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'only answers carry a grader note');

select * from finish();
rollback;

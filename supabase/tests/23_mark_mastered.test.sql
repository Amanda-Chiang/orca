-- Marking a weak spot mastered (2026-11-22): a mark row is the objective and the time, nothing else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

\set A aaaaaaaa-0000-4000-8000-000000000231
\set course c0000000-0000-4000-8000-000000000231
\set topic  e0000000-0000-4000-8000-000000000231
\set obj    f0000000-0000-4000-8000-000000000231

insert into auth.users (id, email) values (:'A', 'a23@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}');
insert into public.topics (id, owner_id, course_id, name, review, sort_order, pos_x, pos_y) values (:'topic', :'A', :'course', 'Adders', 'confirmed', 0, 0, 0);
insert into public.objectives (id, owner_id, course_id, topic_id, name, description, origin, review)
  values (:'obj', :'A', :'course', :'topic', 'Explain carry-save', '', 'inferred', 'confirmed');

select lives_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id)
  values ('b1000000-0000-4000-8000-000000000231', %L, 'mark', now(), %L, %L, %L)$$, :'A', :'course', :'topic', :'obj'),
  'a mark row: the objective and the time');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id, outcome)
  values ('b2000000-0000-4000-8000-000000000231', %L, 'mark', now(), %L, %L, %L, 'correct')$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'a mark carries no outcome');
select throws_ok(format($$insert into public.evidence_events (id, owner_id, kind, at, course_id, topic_id, objective_id)
  values ('b3000000-0000-4000-8000-000000000231', %L, 'mastered', now(), %L, %L, %L)$$, :'A', :'course', :'topic', :'obj'),
  '23514', null, 'kind is one of the known kinds');

select * from finish();
rollback;

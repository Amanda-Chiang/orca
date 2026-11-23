-- The study timer (2026-11-22): a student reads their own timers and nobody else's, can't write one
-- from the browser, runs at most one at a time, and a timer counts for at most 4 hours.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

\set A aaaaaaaa-0000-4000-8000-000000000241
\set B bbbbbbbb-0000-4000-8000-000000000241
\set C cccccccc-0000-4000-8000-000000000241

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a24@example.com'), (:'B', 'b24@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values (:'C', :'A', 'c24', 'Course', 'C', 'ald', 0, 0, '{}');
insert into public.study_timers (owner_id, course_id, started_at) values (:'A', :'C', now() - interval '1 hour');

select throws_ok($$insert into public.study_timers (owner_id, course_id) values ('aaaaaaaa-0000-4000-8000-000000000241', 'cccccccc-0000-4000-8000-000000000241')$$,
  '23505', null, 'one running timer per student');
select throws_ok($$insert into public.study_timers (owner_id, course_id, started_at, ended_at) values ('aaaaaaaa-0000-4000-8000-000000000241', 'cccccccc-0000-4000-8000-000000000241', now() - interval '10 hours', now())$$,
  '23514', null, 'a timer counts for at most 4 hours');

select pg_temp.act_as(:'A');
select is((select count(*)::int from public.study_timers), 1, 'A reads their own timer');
select throws_ok($$insert into public.study_timers (owner_id, course_id, started_at, ended_at) values ('aaaaaaaa-0000-4000-8000-000000000241', 'cccccccc-0000-4000-8000-000000000241', now() - interval '2 hours', now() - interval '1 hour')$$,
  '42501', null, 'the browser can''t write study time');

select pg_temp.act_as(:'B');
select is((select count(*)::int from public.study_timers), 0, 'B sees none of A''s timers');

select * from finish();

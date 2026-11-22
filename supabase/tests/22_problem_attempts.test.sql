-- Problem attempts (2026-11-22): a student reads their own and nobody else's, can't write one from
-- the browser, and points come with what they're out of.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000221
\set B bbbbbbbb-0000-4000-8000-000000000221
\set C cccccccc-0000-4000-8000-000000000221
\set E eeeeeeee-0000-4000-8000-000000000221

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a22@example.com'), (:'B', 'b22@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values (:'C', :'A', 'c22', 'Course', 'C', 'ald', 0, 0, '{}');
insert into public.problem_attempts (owner_id, course_id, exam_id, type_id, outcome, cold) values (:'A', :'C', :'E', 'charge-sharing', 'solved', true);

select throws_ok($$insert into public.problem_attempts (owner_id, course_id, exam_id, type_id, outcome, points) values ('aaaaaaaa-0000-4000-8000-000000000221', 'cccccccc-0000-4000-8000-000000000221', 'eeeeeeee-0000-4000-8000-000000000221', 'rlc', 'solved', 8)$$,
  '23514', null, 'points need what they''re out of');

select pg_temp.act_as(:'A');
select is((select count(*)::int from public.problem_attempts), 1, 'A reads their own attempt');
select throws_ok($$insert into public.problem_attempts (owner_id, course_id, exam_id, type_id, outcome, cold) values ('aaaaaaaa-0000-4000-8000-000000000221', 'cccccccc-0000-4000-8000-000000000221', 'eeeeeeee-0000-4000-8000-000000000221', 'rlc', 'solved', true)$$,
  '42501', null, 'the browser can''t write an attempt');

select pg_temp.act_as(:'B');
select is((select count(*)::int from public.problem_attempts), 0, 'B sees none of A''s attempts');

select * from finish();

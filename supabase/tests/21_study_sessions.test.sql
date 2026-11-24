-- The session record (2026-11-22): a student reads their own sittings and nobody else's, and can't
-- write one from the browser (only the server does, for the connector).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

\set A aaaaaaaa-0000-4000-8000-000000000211
\set B bbbbbbbb-0000-4000-8000-000000000211
\set C cccccccc-0000-4000-8000-000000000211

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a21@example.com'), (:'B', 'b21@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config) values (:'C', :'A', 'c21', 'Course', 'C', 'ald', 0, 0, '{}');
insert into public.study_sessions (owner_id, course_id, day, minutes, summary) values (:'A', :'C', '2026-11-16', 120, 'HW08 E8 to E12');

select throws_ok($$insert into public.study_sessions (owner_id, course_id, day, minutes, summary) values ('aaaaaaaa-0000-4000-8000-000000000211', 'cccccccc-0000-4000-8000-000000000211', '2026-11-16', 0, 'x')$$,
  '23514', null, 'a sitting has at least a minute');

select pg_temp.act_as(:'A');
select is((select count(*)::int from public.study_sessions), 1, 'A reads their own sitting');
select throws_ok($$insert into public.study_sessions (owner_id, course_id, day, minutes, summary) values ('aaaaaaaa-0000-4000-8000-000000000211', 'cccccccc-0000-4000-8000-000000000211', '2026-11-17', 600, 'made up')$$,
  '42501', null, 'the browser can''t write study time');

select pg_temp.act_as(:'B');
select is((select count(*)::int from public.study_sessions), 0, 'B sees none of A''s sittings');

select * from finish();

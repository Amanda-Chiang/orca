-- What students are doing (2026-11-15): session_results.warmup defaults null, a student writes it
-- only on their own rows (and only on a quick session), and admin_activity is the server's alone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

\set A aaaaaaaa-0000-4000-8000-000000000211
\set B bbbbbbbb-0000-4000-8000-000000000212
\set course c0000000-0000-4000-8000-000000000211
\set courseB c0000000-0000-4000-8000-000000000212

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a21@example.com'), (:'B', 'b21@example.com');
insert into public.courses (id, owner_id, slug, name, short, variant, pos_x, pos_y, review_config)
  values (:'course', :'A', 'ald', 'ALD', 'ALD', 'ald', 0, 0, '{}'), (:'courseB', :'B', 'ds', 'DS', 'DS', 'ald', 0, 0, '{}');

select has_column('public', 'session_results', 'warmup', 'session_results has warmup');
select col_hasnt_default('public', 'session_results', 'warmup', 'it has no default: null unless written');

/* ── a student writes it on their own sessions only ── */

select pg_temp.act_as(:'A');
select lives_ok(format($$insert into public.session_results (course_id, mode, session_id, correct, total, seconds, warmup) values (%L, 'quick', 's-warm', 3, 5, 240, true)$$, :'course'),
  'a student stores their own warm-up');
select lives_ok(format($$insert into public.session_results (course_id, mode, session_id, correct, total, seconds) values (%L, 'quick', 's-old', 1, 2, 60)$$, :'course'),
  'a session without the flag still saves');
select is((select warmup from public.session_results where session_id = 's-old'), null::boolean, 'and its warmup stays null');
select throws_ok(format($$insert into public.session_results (course_id, mode, session_id, correct, total, seconds, warmup) values (%L, 'deep', 's-deep', 1, 2, 60, true)$$, :'course'),
  '23514', null, 'only a quick session can be a warm-up');
select throws_ok(format($$insert into public.session_results (owner_id, course_id, mode, session_id, correct, total, seconds, warmup) values (%L, %L, 'quick', 's-b', 1, 1, 30, true)$$, :'B', :'courseB'),
  '42501', null, 'nor write one on another student''s account');
select throws_ok($$update public.session_results set warmup = false where session_id = 's-warm'$$, '42501', null, 'and can''t change it afterwards');
select throws_ok($$select public.admin_activity()$$, '42501', null, 'admin_activity isn''t a student''s to call');
select throws_ok(format($$select public.admin_activity(%L)$$, :'A'), '42501', null, 'not even for their own account');
reset role;

/* ── the server reads it ── */

select is((select count(*) from jsonb_array_elements(public.admin_activity(:'A') -> 'in_app') r where r ->> 'kind' = 'warmup' and (r ->> 'sessions')::int = 1 and (r ->> 'seconds')::int = 240), 1::bigint,
  'admin_activity counts the warm-up apart from quick reviews');
select is((select count(*) from jsonb_array_elements(public.admin_activity(:'A') -> 'in_app') r where r ->> 'kind' = 'quick' and (r ->> 'sessions')::int = 1), 1::bigint,
  'and a session without the flag as a quick review');
select is(jsonb_array_length(public.admin_activity(:'B') -> 'in_app'), 0, 'one student''s figures leave the others out');

select * from finish();
rollback;

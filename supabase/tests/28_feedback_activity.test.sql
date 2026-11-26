-- Feedback and activity (2026-11-25): both tables are the server's alone (no policies, functions
-- revoked from students), a dismissal and an answer are kept apart, and the heartbeat's mark counts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

\set A aaaaaaaa-0000-4000-8000-000000000281

create function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

insert into auth.users (id, email) values (:'A', 'a28@example.com');

/* ── a student can't touch either table or call the functions ── */

select pg_temp.act_as(:'A');
select is((select count(*) from public.app_feedback), 0::bigint, 'a student reads no feedback rows');
select throws_ok($$insert into public.app_feedback (owner_id, spot, rating) values (auth.uid(), 'settings', 'up')$$, '42501', null, 'nor writes one');
select throws_ok($$select public.record_app_feedback(auth.uid(), 'settings', 'up', null, null, false)$$, '42501', null, 'the recording function is the server''s');
select throws_ok($$select public.touch_activity(auth.uid())$$, '42501', null, 'so is the heartbeat''s mark');
select throws_ok($$select public.admin_app_feedback(0, 50)$$, '42501', null, 'and the admin reads');
reset role;

/* ── the server records; the shape holds ── */

select lives_ok($$select public.record_app_feedback('aaaaaaaa-0000-4000-8000-000000000281', 'session-end', 'down', 'too many words', '/session/ald', false)$$, 'an answer is recorded');
select lives_ok($$select public.record_app_feedback('aaaaaaaa-0000-4000-8000-000000000281', 'upload-done', null, null, '/course/ald/review', true)$$, 'so is a dismissal');
select throws_ok($$select public.record_app_feedback('aaaaaaaa-0000-4000-8000-000000000281', 'upload-done', null, null, null, false)$$, '23514', null, 'an answer with neither a rating nor a note is refused');
select is(public.app_feedback_spots(:'A'), '{"session-end": {"answered": true, "dismissed": 0}, "upload-done": {"answered": false, "dismissed": 1}}'::jsonb, 'the spots say what happened at each');

select public.touch_activity(:'A');
select public.touch_activity(:'A');
select is((select beats from public.activity_days where owner_id = :'A' and day = (now() at time zone 'utc')::date), 2, 'two heartbeats today are one row with two beats');

select * from finish();
rollback;

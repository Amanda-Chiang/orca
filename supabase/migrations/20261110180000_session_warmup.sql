-- What students are doing, by kind of study (owner, 2026-11-10, confirmed 2026-11-15): the admin view
-- counts sessions, minutes and answers per kind (topic quiz, quick review, dive, re-quiz, warm-up,
-- Claude connector).

-- 1. A warm-up is a quick-style session (`mode` 'quick'); this says which quick sessions were one.
--    The browser writes true for a session started with ?warmup=1 and false for every other
--    session; null is a session finished before this column existed (unknown, counted as a quick
--    review). Students still write only their own rows (the table's insert policy).
alter table public.session_results add column warmup boolean;
alter table public.session_results add constraint session_results_warmup_check check (warmup is not true or mode = 'quick');
comment on column public.session_results.warmup is 'True for the warm-up (a quick session started with ?warmup=1); null for sessions finished before 2026-11-15.';

-- 2. The activity figures, per student, UTC day and kind, for the admin view to bucket (today, the
--    last 7 days, all time, the last 30 days) in src/lib/admin/activity.ts. Service role only, like
--    the other admin_* functions (migration 20261110120000).
--    in_app: sessions and seconds from finished sessions (session_results, by finished_at); answers
--      from the answer events (by at), each counted under its session's kind when that session
--      finished, else under its source's kind (an unfinished session's answers still count).
--    connector: the connector has no session record, so per student per day it returns the
--      connector-sourced events' count of answers and work, and the first and last event of any
--      connector kind (answers, work, signals, and check-me / struggled flags); the server turns
--      the span into an estimate of minutes.
create function public.admin_activity(owner uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with sess as (
    select r.owner_id, r.session_id, date_trunc('day', r.finished_at) as day,
           case when r.warmup then 'warmup' else r.mode end as kind, r.seconds
    from public.session_results r
    where admin_activity.owner is null or r.owner_id = admin_activity.owner
  ),
  ans as (
    select e.owner_id, date_trunc('day', e.at) as day,
           coalesce(
             (select s.kind from sess s where s.owner_id = e.owner_id and s.session_id = e.session_id limit 1),
             case e.source when 'quiz' then 'topic' when 'quick-review' then 'quick' when 'deep-review' then 'deep' when 'requiz' then 'requiz' end
           ) as kind
    from public.evidence_events e
    where e.kind = 'answer' and e.source <> 'connector'
      and (admin_activity.owner is null or e.owner_id = admin_activity.owner)
  ),
  in_app as (
    select owner_id, day, kind, sum(sessions) as sessions, sum(seconds) as seconds, sum(answers) as answers
    from (
      select owner_id, day, kind, 1 as sessions, seconds, 0 as answers from sess
      union all
      select owner_id, day, kind, 0, 0, 1 from ans
    ) x
    group by owner_id, day, kind
  ),
  conn as (
    select e.owner_id, date_trunc('day', e.at) as day,
           count(*) filter (where e.kind in ('answer', 'work')) as answers,
           min(e.at) as first_at, max(e.at) as last_at
    from public.evidence_events e
    where ((e.kind in ('answer', 'work', 'signal') and e.source = 'connector')
           or (e.kind = 'confusion' and e.flag_source in ('connector', 'connector-struggled')))
      and (admin_activity.owner is null or e.owner_id = admin_activity.owner)
    group by e.owner_id, date_trunc('day', e.at)
  )
  select jsonb_build_object(
    'in_app', coalesce((
      select jsonb_agg(jsonb_build_object('owner', i.owner_id, 'day', to_char(i.day, 'YYYY-MM-DD'), 'kind', i.kind,
                                          'sessions', i.sessions, 'seconds', i.seconds, 'answers', i.answers)
                       order by i.day desc, i.owner_id, i.kind)
      from in_app i), '[]'::jsonb),
    'connector', coalesce((
      select jsonb_agg(jsonb_build_object('owner', c.owner_id, 'day', to_char(c.day, 'YYYY-MM-DD'), 'answers', c.answers,
                                          'first', c.first_at, 'last', c.last_at)
                       order by c.day desc, c.owner_id)
      from conn c), '[]'::jsonb)
  );
$$;
revoke execute on function public.admin_activity(uuid) from public, anon, authenticated;

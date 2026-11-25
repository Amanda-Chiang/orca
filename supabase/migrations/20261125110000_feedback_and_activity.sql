-- Feedback and activity (owner, 2026-11-25: before Orca goes public, a place for students to say how
-- it went, and visibility into when they stop using it and when they come back).
--
-- 1. `app_feedback`: what a student said at one of the prompts (after a session, after an upload is
--    built, after a practice test, or from Settings): a thumbs up or down, an optional note, and the
--    page they were on. A dismissed prompt is a row too (`dismissed`), so the prompt can stop asking
--    at a spot once it was answered or waved away twice. Server-only: the browser never reads or
--    writes it; `POST /api/feedback` records with the service role, the admin view reads it.
-- 2. `activity_days`: one row per account per UTC day the app was open, kept by the heartbeat
--    (`POST /api/heartbeat` → `touch_activity`). From it the admin view says who was active this
--    week, who dropped off, and who came back after a gap. Backfilled from what older rows show
--    (evidence events, uploads, the profile's last_active_at) so the strip isn't empty on day one.

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  spot text not null check (spot in ('session-end', 'upload-done', 'practice-test', 'settings')),
  rating text check (rating is null or rating in ('up', 'down')),
  note text check (note is null or char_length(note) <= 1000),
  page text check (page is null or char_length(page) <= 200),
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  -- A dismissal carries nothing; an answer carries a rating or a note.
  check ((dismissed and rating is null and note is null) or (not dismissed and (rating is not null or note is not null)))
);
create index on public.app_feedback (owner_id, spot);
create index on public.app_feedback (created_at desc);
alter table public.app_feedback enable row level security;
-- No policies: only the service role reads or writes it.

create table public.activity_days (
  owner_id uuid not null references auth.users on delete cascade,
  day date not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  -- Heartbeats that day (0 for a backfilled day inferred from older rows).
  beats integer not null default 1,
  primary key (owner_id, day)
);
create index on public.activity_days (day);
alter table public.activity_days enable row level security;
-- No policies: only the service role reads or writes it.

/* ── writes, from the server ── */

-- The heartbeat's mark: today's row for this account, made or touched.
create function public.touch_activity(p_owner uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_days (owner_id, day) values (p_owner, (now() at time zone 'utc')::date)
  on conflict (owner_id, day) do update set last_at = now(), beats = public.activity_days.beats + 1;
$$;
revoke execute on function public.touch_activity(uuid) from public, anon, authenticated;

create function public.record_app_feedback(p_owner uuid, p_spot text, p_rating text, p_note text, p_page text, p_dismissed boolean) returns uuid
language sql security definer set search_path = '' as $$
  insert into public.app_feedback (owner_id, spot, rating, note, page, dismissed)
  values (p_owner, p_spot, p_rating, nullif(p_note, ''), nullif(p_page, ''), p_dismissed)
  returning id;
$$;
revoke execute on function public.record_app_feedback(uuid, text, text, text, text, boolean) from public, anon, authenticated;

-- Where this account stands at each spot: answered, or how many times it was dismissed.
create function public.app_feedback_spots(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.spot, jsonb_build_object('answered', s.answered, 'dismissed', s.dismissed)), '{}'::jsonb)
  from (
    select spot, bool_or(not dismissed) as answered, count(*) filter (where dismissed) as dismissed
    from public.app_feedback where owner_id = p_owner group by spot
  ) s;
$$;
revoke execute on function public.app_feedback_spots(uuid) from public, anon, authenticated;

/* ── reads, for the admin view ── */

create function public.admin_app_feedback(p_offset integer, p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'owner_id', f.owner_id,
    'name', p.name,
    'email', u.email,
    'spot', f.spot,
    'rating', f.rating,
    'note', f.note,
    'page', f.page,
    'at', f.created_at
  ) order by f.created_at desc, f.id), '[]'::jsonb)
  from (
    select * from public.app_feedback where not dismissed
    order by created_at desc, id offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 500)
  ) f
  left join public.profiles p on p.owner_id = f.owner_id
  left join auth.users u on u.id = f.owner_id;
$$;
revoke execute on function public.admin_app_feedback(integer, integer) from public, anon, authenticated;

-- Who is using Orca, this week: active in the last 7 days; dropped off (last seen 7 to 30 days ago);
-- came back (active in the last 7 days after a gap of 7 days or more before that).
create function public.admin_activity_summary() returns jsonb
language sql stable security definer set search_path = '' as $$
  with seen as (
    select owner_id, max(day) as last_day from public.activity_days group by owner_id
  ), returned as (
    select a.owner_id
    from public.activity_days a
    join seen s on s.owner_id = a.owner_id
    where a.day >= (now() at time zone 'utc')::date - 7
      and exists (
        select 1 from public.activity_days b
        where b.owner_id = a.owner_id and b.day < a.day
        having max(b.day) <= a.day - 7
      )
    group by a.owner_id
  )
  select jsonb_build_object(
    'active_today', (select count(*) from seen where last_day = (now() at time zone 'utc')::date),
    'active_7d', (select count(*) from seen where last_day >= (now() at time zone 'utc')::date - 7),
    'dropped_off', (select count(*) from seen where last_day < (now() at time zone 'utc')::date - 7 and last_day >= (now() at time zone 'utc')::date - 30),
    'gone_30d', (select count(*) from seen where last_day < (now() at time zone 'utc')::date - 30),
    'came_back_7d', (select count(*) from returned),
    'feedback_7d', (select count(*) from public.app_feedback where not dismissed and created_at >= now() - interval '7 days'),
    'feedback_all', (select count(*) from public.app_feedback where not dismissed)
  );
$$;
revoke execute on function public.admin_activity_summary() from public, anon, authenticated;

-- One account's active days, newest first (at most the last 180).
create function public.admin_user_activity(uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'first_at', a.first_at, 'last_at', a.last_at, 'beats', a.beats) order by a.day desc), '[]'::jsonb)
  from (select * from public.activity_days where owner_id = uid order by day desc limit 180) a;
$$;
revoke execute on function public.admin_user_activity(uuid) from public, anon, authenticated;

/* ── backfill: the days older rows show the account was here ── */

insert into public.activity_days (owner_id, day, first_at, last_at, beats)
select owner_id, d, min(at), max(at), 0 from (
  select owner_id, (at at time zone 'utc')::date as d, at from public.evidence_events
  union all
  select owner_id, (created_at at time zone 'utc')::date, created_at from public.materials
  union all
  select owner_id, (last_active_at at time zone 'utc')::date, last_active_at from public.profiles where last_active_at is not null
) x
group by owner_id, d
on conflict (owner_id, day) do nothing;

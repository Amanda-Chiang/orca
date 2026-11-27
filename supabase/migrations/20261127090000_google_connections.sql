-- Google sign-in for Calendar and Drive (2026-11-27). A student connects their Google account from
-- Settings → Connections (or from Add material, for Drive) through Google's OAuth consent screen.
-- Orca keeps only the refresh token, encrypted by the server like the Canvas and Notion tokens, and
-- never hands it to the browser. Scopes are the narrowest Google offers for each feature:
--   calendar.app.created  only the "Orca" calendar Orca makes, and its events
--   drive.file            only the files the student picks in Google's file picker
-- `calendar_id` is that Orca calendar; `calendar_since` is the first day its weekly events run from,
-- so they keep a fixed start. `broken_at` is set when Google refuses the refresh token (revoked, or
-- the 7-day expiry of an app still in Google's testing mode): the student reconnects.
-- Service-role only (RLS on, no policies), as notion_connections.

create table public.google_connections (
  owner_id uuid primary key references auth.users on delete cascade,
  refresh_token_enc text not null,
  google_email text,
  scopes text[] not null default '{}',
  calendar_id text,
  calendar_since date,
  calendar_synced_at timestamptz,
  calendar_error text,
  broken_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.google_connections enable row level security;

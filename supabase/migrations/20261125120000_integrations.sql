-- Integrations without OAuth (owner, 2026-11-25: as many ways as possible for a student to give Orca
-- context; the sign-in flows wait for the owner's credentials).
--
-- 1. A calendar feed: `profiles.calendar_feed_token` is the secret in a subscription link
--    (`/api/calendar/feed/<token>.ics`) that Google Calendar or Apple Calendar polls for the student's
--    exams, due dates, class meetings and review days. Minted and cleared by the server only (Settings
--    → Calendar); a student's own session can't set it, as with is_admin and last_active_at.
-- 2. Notion: a student's internal-integration token (encrypted by the server; never read by the
--    browser), and the pages already imported, so importing again adds only what's new.

alter table public.profiles add column calendar_feed_token text unique check (calendar_feed_token is null or calendar_feed_token ~ '^[A-Za-z0-9_-]{32,64}$');

create or replace function private.profiles_keep_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin is set only in the database, by the owner' using errcode = '42501';
    end if;
    if new.last_active_at is distinct from old.last_active_at then
      raise exception 'last_active_at is set by Orca''s server' using errcode = '42501';
    end if;
    if new.calendar_feed_token is distinct from old.calendar_feed_token then
      raise exception 'calendar_feed_token is set by Orca''s server' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create table public.notion_connections (
  owner_id uuid primary key references auth.users on delete cascade,
  token_enc text not null,
  workspace_name text,
  bot_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.notion_connections enable row level security;

create table public.notion_links (
  owner_id uuid not null references auth.users on delete cascade,
  page_id text not null,
  material_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, page_id)
);
create index on public.notion_links (owner_id, material_id);
alter table public.notion_links enable row level security;

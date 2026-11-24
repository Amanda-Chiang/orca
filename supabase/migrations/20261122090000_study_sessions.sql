-- The session record (owner, 2026-11-22; docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md,
-- Phase 2). One row per sitting the student's Claude logs through the connector (log_session): how
-- long it ran, what was worked, where the student stopped (the bookmark) and what comes next, in
-- order. It's what lets a new chat pick up where the last one stopped, and what makes study done in
-- the chat count as time studied. Owner-only to read; only the server writes it (the connector's
-- route, with the secret key), so the browser can't invent study time.
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  course_id uuid not null,
  -- The exam it was for, when one was being crammed for (not a key: an exam can be removed later).
  exam_id uuid,
  at timestamptz not null default now(),
  -- The student's day it counts on (their timezone), YYYY-MM-DD.
  day date not null,
  minutes integer not null check (minutes between 1 and 720),
  summary text not null check (char_length(summary) between 1 and 500),
  -- What was worked: [{ what, outcome?, errorNote?, objectiveIds?, problemTypeId? }].
  worked jsonb not null default '[]'::jsonb check (jsonb_typeof(worked) = 'array'),
  -- Where the student stopped, in words ("Lesson 7.5 half done; Practice 8 not tried").
  bookmark text check (bookmark is null or char_length(bookmark) <= 500),
  -- What to do next, in order: ["HW07 P4", "a switched RC circuit", ...].
  next_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(next_steps) = 'array'),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade
);
create index on public.study_sessions (owner_id, course_id, at desc);

alter table public.study_sessions enable row level security;
create policy "own study sessions: read" on public.study_sessions for select to authenticated using (owner_id = (select auth.uid()));

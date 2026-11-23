-- The study timer (owner, 2026-11-22): "Start study session" on the progress page and a course's page
-- runs a timer for one course (and, optionally, one of its exams); stopping it records the time as
-- study, for work Orca can't see (reading, homework, office hours). A row with no `ended_at` is the
-- running one; a student has at most one. A timer counts for at most TIMER_MAX_MINUTES (4 hours), so a
-- forgotten one can't inflate the record. Owner-only to read; only the server writes it
-- (POST /api/study-timer, with the secret key), as with the other study-time records.
create table public.study_timers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  course_id uuid not null,
  -- The exam it was for, when the student picked one (not a key: an exam can be removed later).
  exam_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or (ended_at >= started_at and ended_at <= started_at + interval '4 hours')),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade
);
create index on public.study_timers (owner_id, started_at desc);
-- One running timer per student.
create unique index study_timers_one_running on public.study_timers (owner_id) where ended_at is null;

alter table public.study_timers enable row level security;
create policy "own study timers: read" on public.study_timers for select to authenticated using (owner_id = (select auth.uid()));

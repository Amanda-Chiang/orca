-- Readiness at exam level (owner, 2026-11-22; docs/superpowers/plans/2026-11-22-tutor-memory-and-exam-map.md,
-- Phase 3). One row per exam-style problem the student attempted with their Claude (log_problem):
-- which kind of problem (a problem type's id on the exam's scope), whether it was cold (no help
-- first, as in the exam), how it went, and, for a problem of the reserved exam sat timed, its points.
-- Readiness per problem type and the measured score are derived from these; nothing derived is
-- stored. Owner-only to read; only the server writes (the connector's route, with the secret key).
create table public.problem_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  course_id uuid not null,
  -- The exam whose scope names the type (not a key: an exam can be removed later).
  exam_id uuid not null,
  -- A problem type's id (scope.problemTypes[].id).
  type_id text not null check (type_id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  at timestamptz not null default now(),
  outcome text not null check (outcome in ('solved', 'with-hints', 'shown', 'stuck')),
  -- Attempted with no help first, at exam difficulty: the only attempts that say "ready".
  cold boolean not null default false,
  minutes integer check (minutes is null or minutes between 1 and 600),
  error_note text check (error_note is null or char_length(error_note) <= 200),
  -- A problem of the reserved exam, sat timed: the material it came from and its points.
  mock_material_id uuid,
  points numeric check (points is null or points >= 0),
  out_of numeric check (out_of is null or out_of > 0),
  check ((points is null) = (out_of is null)),
  check (points is null or points <= out_of),
  foreign key (course_id, owner_id) references public.courses (id, owner_id) on delete cascade
);
create index on public.problem_attempts (owner_id, course_id, exam_id, at);

alter table public.problem_attempts enable row level security;
create policy "own problem attempts: read" on public.problem_attempts for select to authenticated using (owner_id = (select auth.uid()));

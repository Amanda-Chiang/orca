# Cost log

Started 2026-11-10 (owner). What Orca costs per task, measured on real cases with a pass criterion
each, failures and retries included. Model and tool costs plus human fallback time at a stated
rate, divided by the tasks that passed. Success rate and human minutes are reported on their own.
When nothing passes, that is the result; there is no cost per success to report.

## Method

- **A task** is one thing a student would do: import a course from Canvas, paste a syllabus,
  upload a deck, start a dive, run a quiz through the Claude connector, remove material. Each row
  names its pass criterion before the attempt.
- **Model cost** is the metered spend in `model_usage` for the task's runs (`run_id`), in dollars,
  from `src/lib/pricing.ts` prices. A task with no model calls costs 0 there, not "free": its human
  minutes still count.
- **Tool cost** is what the hosting bills for the task. Today Supabase, Vercel (Hobby) and
  Trigger.dev (free tier) bill nothing, so it is 0 until a bill arrives; Claude for the connector
  is the student's own plan, not Orca's.
- **Human fallback** is minutes a person spent making the task happen or recovering from it:
  reconnecting, retrying, re-pasting, restoring, waiting on a screen that should not have needed
  watching. Study time itself is not fallback. Valued at the rate below.
- **Cost per successful task** = (model + tool + human) summed over every attempt, including the
  failed ones, divided by the number of attempts that met their criterion.

**Assumptions (change here, not in the rows).**
- Human time at **$30/hour** (the owner's estimate of a student founder's hour; placeholder until
  stated otherwise).
- Model prices as in `src/lib/pricing.ts` on the date of the row; until `ORCA_READ_MODEL` was set
  on Vercel and Trigger, every step ran on gpt-6.1-sol.
- Minutes marked ~ are the owner's recollection, not a timer.

## Queries (production project, SQL editor)

Spend per run, newest first, with the run's status:
```sql
select r.id as run_id, r.kind, r.status, r.at, u.model, sum(u.cost_usd)::numeric(10,4) as usd,
       sum(u.input_tokens + u.output_tokens + u.cache_write_tokens + u.cache_read_tokens) as tokens
from public.pipeline_runs r left join public.model_usage u on u.run_id = r.id
where r.owner_id = auth.uid() or true
group by r.id, r.kind, r.status, r.at, u.model order by r.at desc limit 50;
```
Spend by day and kind (grading has no run):
```sql
select date_trunc('day', at) as day, kind, model, count(*) as calls, sum(cost_usd)::numeric(10,4) as usd
from public.model_usage group by 1, 2, 3 order by 1 desc, 2;
```

## Log

| Date | Task | Pass criterion | Result | Model $ | Tool $ | Human min | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-07 | Paste the Circuit Analysis syllabus | Course has topics and objectives, material typed Syllabus | **Fail**: built (22 topics, 78 objectives) through the chat lane with the chat rules applied; removed on 11-08 | fill from query | 0 | ~10 | Led to the paste lane and the AI-chat type (shipped 11-08) |
| 2026-11-07 | Import ALD from Canvas | Dates on the calendar, syllabus saved, every deck read | **Fail**: dates and syllabus in; decks hit the 300-page day and sat waiting; Canvas disconnected by accident and reconnected with a new token | fill from query | 0 | ~25 | 300 → 1,000 pages; disconnect confirmation; waiting runs resume on the Uploads tab (all shipped 11-08) |
| 2026-11-07 | Dive into "Circuit variables and elements" | Quiz starts within 2 minutes | **Fail**: "Preparing your quiz" with no end; the run was held by the spent token day and the screen didn't say | 0 | 0 | ~5 | The preparing screen now says so (11-08) |
| 2026-11-07 | Quiz through the Claude connector | Claude asks an Orca question and records the answer | **Fail**: no questions existed for unflagged objectives; the flag top-up parked on the spent day; Claude promised "a few minutes" | 0 | 0 | ~10 | `next_questions`, `check_answer`, budget in `course_state` (11-08) |
| 2026-11-08 | Remove a failed upload from Circuit Analysis | The failed card goes; the course keeps what other files taught | **Fail**: the file's done run went too (same material), its objectives were archived; restored by hand | 0 | 0 | ~10 | Removal now archives only what no other file teaches (11-08); the course had one file, so this case still loses its source |
| 2026-11-08 | Restore the archived objectives by hand after the removal | The course keeps its outline | **Fail** as a task a student should never need: the objectives came back but their source pages were gone, so no questions could be written; the sidebar said "writing" for two days with no job | 0 | 0 | ~5 | Sidebar now honest, and the server asks for questions itself (PRs #18, #19) |
| 2026-11-09 | Re-paste the syllabus as Syllabus | A Syllabus-typed material builds | **Fail**: "OpenAI rejected that API key" from the job on Trigger.dev (its copy of the key) | 0 | 0 | ~3 | Fix the key on the Trigger project, Try again |
| 2026-11-10 | Quiz through Claude (Circuit Analysis cram) | Claude asks a question and Orca records the answer | **Fail**: Claude's copy of the connector still had the v0.3 tools (no `add_questions`, `log_evidence`); the bank was empty; a 3/3 answer went unrecorded | 0 | 0 | n/r | Re-adding the connector refreshes the tools; the empty bank was the next blocker |
| 2026-11-10 | Cram setup for Midterm 2 | A plan appears, scope narrowed to lectures 11–16 | **Fail**: cramming set, but the scope held all 151 objectives at weight 1 and there was no time budget, so no plan | 0 | 0 | n/r | Scope picker and a default budget (PR #40), hours per day (PR #41) |
| 2026-11-10 | Questions for the 9 weak spots, with no teaching material | Questions stored and askable for each | **Pass** after PR #42: Claude wrote 18 through `add_questions`, 0 refused, stored as not course-specific | 0 | 0 | ~2 | Written on the developer's Claude session, not Orca's key; before #42 every one was refused (no anchor possible) |
| 2026-11-10 | Quiz through Claude, again | Claude asks one of the 18 and Orca records the answer | pending | | | | Next cram chat |

## Totals so far

| | |
|---|---|
| Attempts | 7 (1 pending) |
| Passed | 0 |
| Success rate | 0 of 7 |
| Model $ | to fill from the first query (the five model-free fails are 0) |
| Tool $ | 0 |
| Human minutes | ~68, about $34 at the stated rate |
| Cost per successful task | **none: no task passed** |

Each fail above has a shipped fix beside it; the next rows are the same tasks run again on the
11-08 deploy, which is the number that matters.

## Summary (attempts through 2026-11-10)

| Measure | Value |
|---|---|
| Attempts completed | 10 (1 more pending) |
| Succeeded | 1 (questions for the 9 weak spots, 11-10) |
| **Success rate** | **10%** |
| **Human fallback minutes** | **70 recorded** (all ~, the owner's recollection) + 2 attempts not recorded (n/r) |
| Human $ at $30/h | $35.00 |
| Tool $ | $0 (Supabase, Vercel Hobby, Trigger.dev free tier billed nothing) |
| Model $ | **not yet measured**: 8 attempts made no model calls ($0); 2 did (the 11-07 syllabus paste, the 11-07 ALD import) and their spend is in production's `model_usage`, not read yet |
| **Cost per successful task** | **$35.00 + the 2 unmeasured runs**, over 1 success |

Not measured yet, so not reported as zero: the model spend of the two 11-07 runs (run the first query
above on the production project, or open `/admin/users/<id>` → Uploads, and fill the rows), and the
human minutes for the two 11-10 attempts marked n/r. The one success cost Orca nothing in model
spend because Claude wrote the questions on the student's side; that is a design choice (cram mode),
not a measurement error.

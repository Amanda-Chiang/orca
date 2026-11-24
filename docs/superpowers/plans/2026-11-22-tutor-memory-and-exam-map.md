# Orca as the tutor's memory and exam map (2026-11-22)

Owner's direction after the Circuit Analysis (E3201) Midterm 2 cram, which went worse than the ALD
cram: "I was wasting time trying to make Orca work for me." Sources: the owner's study record, the
full tutoring transcript and "Orca Learnings from Midterm 2 Cram" (22 dated changes), none of them
committed (course material and a private chat).

## Why the cram went worse than ALD

1. **Orca hid the best source of scope from the tutor.** The Fall25 exam was held back from Claude
   as well as from the student, so a day and a half went to the wrong topics. In ALD, Claude read
   the past exams and the professor's words first.
2. **Orca plans in the wrong unit.** 151 syllabus objectives at recall level, against an exam made of
   about eight problem types (charge sharing, RLC design, op-amp DE...). The plan, the sweep and
   "verified %" measured what the exam doesn't test.
3. **Orca ignored the real work and couldn't hold the real state.** Hours of homework and drills
   showed 0 minutes; the lesson bookmark, the ordered plan and the exam's rules lived in Claude's
   memory.
4. **The student became the integrator**: fixing dates, budgets and scope mid-cram.

## Decisions (owner, 2026-11-22)

- **Orca stops being a second place to study.** Claude teaches; Orca makes sure Claude starts every
  session knowing what's on the exam, where the student is and what happened last time.
- **Problem types are a unit beside objectives.** Each type links the objectives it uses and the past
  exams it appears on; the cram plan and readiness move onto types (Phases 1 and 3).
- **Connector-first.** The app is setup and a dashboard; no more investment in in-app quick reviews
  for cram mode.

## Phases

### Phase 1: Exam map first (this branch, `exam-map`)

- **The tutor reads the vault.** New tool `vault_material`: a held-back exam's pages for Claude, for
  planning, marked do-not-reveal. "Hidden from the student" and "hidden from the tutor" are now two
  things.
- **One exam reserved.** `scope.reservedMaterialId`: that file stays unread even by Claude until the
  student sits it timed (`forMock: true`), so one measured score survives the cram.
- **Problem types.** `scope.problemTypes`: `{ id, name, objectiveIds, materialIds, note? }`, written
  by Claude from the exams it read (Orca makes no model calls in a cram). Recurrence = how many of
  the mapped exams a type is on; fewer than three exams mapped is marked uncertain.
- **Exam rules.** `scope.rules`: notes allowed, calculator, length, free text.
- **Setup asks for every past exam**, and the cram page shows the exam map (types by recurrence,
  the rules, which file is reserved).
- Connector v0.5; no migration (the scope is JSON).

### Phase 2: One session record

- One cheap call for Claude to log a sitting: problems worked, minutes, the specific error type, a
  bookmark ("7.5 half done") and an ordered next-steps list. Time counts from it.
- The cram page shows the record, so a new chat picks up where the last stopped.

**Built (branch `session-record`):** `study_sessions` (migration `20261122090000`, owner-read, server-write;
pgTAP 21), connector tool `log_session` (minutes, summary, `worked` with an outcome and the specific
slip per item, `bookmark`, ordered `next`), `course_state.lastSession`, `GET /api/study-log`, the cram
page's "Where you left off" card. A day's time with Claude is what it logged or the estimate from its
evidence, whichever is more (`claudeMinutesByDay`), on the page and in `course_state` alike. The
instructions tell Claude to open from `lastSession` and to log every sitting, with minutes from the clock.

### Phase 3: Readiness at exam level

- The diagnostic is a cold exam-style problem per type, not recall questions.
- The plan's unit becomes the problem type; readiness is reported per type; the reserved exam gives
  the measured score.

**Built (branch `readiness`):** `problem_attempts` (migration `20261122100000`, owner-read,
server-write; pgTAP 22), connector tool `log_problem` (a kind's id, outcome, cold, minutes, the slip,
and a mock's points), `course_state.readiness` (`src/lib/course/readiness.ts`: ready only when the
latest attempt was cold and solved; shaky after help; not-yet when shown or stuck; the share weighs
each kind by how many exams ask it; `measured` is the reserved exam's latest sitting). With a map the
cram plan's units are the kinds of problem (`typePlanTopics`, `plan.unit`): ready ones are done,
missed ones come first, the diagnostic is a cold problem per kind (12 minutes each, 15 to 120), and
the line reads "Ready for 1 of 8 kinds of problem". The cram page shows a state chip per kind and the
timed score.

### Phase 4: The tutor playbook

- The owner's corrections as the connector's standing instructions: hints-only mode, problems first
  late in a cram, state assumptions and reference directions, say what's optional and what's new,
  verify arithmetic before posting, ask "which ones did you miss?" after releasing answers.

**Built (branch `playbook`):** `PLAYBOOK` in `src/lib/connector/mcp.ts`, the last part of the
connector's instructions: time (real hours, the clock, the stop time, problems first when the exam is
two days off), honesty (no guesses as facts; what's new, what's a scaffold, what's optional; the
exam's rules), problems (exam difficulty and clean numbers, full figures, stated conventions, what
each part is worth, checked arithmetic, batched sets), hints (one at a time, nothing of the answer),
mistakes (the student's actual line, the specific slip, "which ones did you miss?"). Instructions are
advice to the student's Claude, not something Orca can enforce.

### Alongside (small fixes from the change list)

**Built (branch `small-fixes`):**
- **Numeric answers with units (#9).** An exact answer like "2000 A/s" is a quantity, not an
  expression: graded by value within 1% and by unit, SI prefixes converted ("2 kA/s", "2e3 A/s",
  "2,000 A/s" all right); the right number with the unit missing or wrong is partly right
  (`quantityOf`, `gradeExact` in `src/lib/grading.ts`).
- **"I don't know" (#16).** `check_answer` takes it on a multiple-choice or exact question as a miss
  with no guess (`isDontKnow`).
- **A compact `course_state` (#17).** `detail: "weak"`: the summary plus only the weak-spot objectives.
- **A log of scope and budget edits (#19).** `scope.history`: the last 30 edits, each with when, who
  (the student in the app, or Claude through the connector) and what changed in words
  (`src/lib/course/scope-history.ts`); `scopeSummary.history` shows the last five.

**Not built, and why:**
- **Seed questions for every in-scope topic (#18).** Orca makes no model calls in a cram, and with the
  exam map the cram's problems are Claude's, at exam level; seeding recall questions would spend the
  student's daily budget on the unit the plan no longer runs on.
- **A stop-time prompt (#20).** Orca can't interrupt a chat; the playbook tells Claude to ask for the
  stop time and call it.
- **Problem-only copies of exams (#22).** Splitting problems from solutions needs a model pass over
  each exam at upload; for a timed sitting Claude gives the problems as written (`forMock`).

## Status of the 22-item change list

| # | Change | Status |
|---|---|---|
| 1 | Tutor reads held-back exams | Phase 1 |
| 2 | Scope from all past exams | Phase 1 (types and recurrence); weak spots never zeroed shipped in #51/#53 |
| 3 | Import every past exam at setup | Phase 1 (asked for; no folder scan: the app can't see Downloads) |
| 4 | Log study time and evidence from chat | Partly (#52: recorded connector work counts); Phase 2 |
| 5, 6, 7, 8, 12, 21 | Cram end, behind minutes, date, patches, spread, test date | Shipped (#51–#53) |
| 10 | Exam-level readiness | Phase 3 (reserve in Phase 1) |
| 11 | Exam rules | Phase 1 |
| 13 | Budgets from stated availability | Setup asks per day; Claude's side in Phase 4 |
| 14, 15 | Bookmark, ordered plan, error types | Phase 2 |
| 9, 16–20, 22 | Small fixes | Alongside |

# Testing Orca: what to write, where, and when to stop

For anyone (person or agent) changing Orca. The aim is a small number of tests that each protect
something a student would notice, not a test per function. CLAUDE.md's Fix mode and merge gate say
*when* to run what; this says *what to write*.

## 1. Pick the layer

| What changed | Write | Where |
| --- | --- | --- |
| A pure rule: mastery fold, scheduling, weights, grading, parsing, validators | Unit test with plain inputs | `tests/**`, `npm test` |
| A table, column, policy, trigger or SQL function | pgTAP: who can read and write it, what it refuses | `supabase/tests/`, `npm run test:db` |
| An API route or server helper: who may call it, what it writes | One flow step in the HTTP suite | `scripts/check-routes.ts` |
| A connector (MCP) tool | A step in a connector flow | `scripts/check-connector.ts` (or `e2e/connector.spec.ts` when the app's screens are involved) |
| Something the student does across screens | A step in a Playwright flow | `e2e/*.spec.ts` |
| Layout, copy, colour, animation | Nothing automated; check it by hand in `npm run dev` | |

Use the lowest layer that can see the bug. A rounding error in the fold is a unit test, not a
browser test. A student reading another student's data is pgTAP or the HTTP suite, never only a
unit test with a fake client.

## 2. Write flows, not one-offs

A test follows what a student (or their Claude) actually does, in order, and checks the result of
each step before the next: *upload → review → warm-up → miss → weak point*. Before adding a test,
look for the flow it belongs to and add a step there (Playwright `test.step`, or a `section` in the
HTTP suites). Start a new test only for a new journey.

- **Extend a flow** when the change is a new step or a new outcome of an existing journey.
- **New test** when it's a journey no flow covers, or when the setup would make an existing flow
  hard to read.
- **Fold** single-screen checks into the flow that passes through that screen (first-day.spec.ts
  replaced seven).

## 3. The edge cases worth testing (and the ones that aren't)

Every change that touches data gets these, where they apply. They are where Orca's real bugs have been:

1. **Signed out:** 401 (admin routes: 404).
2. **Another student:** their course, run, material, link or question id is refused or changes
   nothing. Check the database afterwards, not only the status code.
3. **Bad input:** one malformed body is a 400. One case per route, not one per field.
4. **Injection:** free text that reaches a model prompt (notes, reflections, connector text) is
   refused or logged when it instructs the model.
5. **Doing it twice:** a second start, stop, delete or upload is safe (409, no-op or duplicate).
6. **The limit:** a cap or rate limit at its boundary (the 4-hour timer, 120 connector calls a
   minute). Test the boundary once, not every value.
7. **Nothing yet:** the empty state says so, never a made-up value (CLAUDE.md's "No silent placeholders").
8. **What the change touches elsewhere:** if it changes evidence, check the state the app and the
   connector read back.

Don't write:

- a test for every validation message or every enum value;
- a test that repeats a lower layer's (if the fold's unit test covers a rule, the browser test only
  checks it shows up);
- snapshot tests of markup, or tests of styling;
- tests that only check a function was called (check what it wrote);
- tests against the real model, hosted Supabase or real Canvas (they cost money or touch real data).

## 4. What a test may fake

- **The model:** always the fake Messages API (`e2e/fake-anthropic.ts`). It recognises each step and
  answers in a fixed way. Its questions anchor on slide 2, so test material needs at least two
  pages.
- **Setup rows students can't write** (runs, timers, sessions, the admin flag) may be written with
  the secret key, to reach the state under test. After that, every action goes through the real
  routes, and every result is read from the database.
- **Nothing else.** The database, auth, RLS, Storage, the Next server and the jobs are real
  (local stack). A test that stubs the database to check a security or data rule doesn't count.

## 5. Make sure it can fail

- **Each check names what it expects:** the exact objective or count, so an empty result can't
  pass. Watch for `every(...)` over a list that might be empty, and `includes(id)` on a whole JSON
  body.
- **Security and data-loss tests:** break the code once (remove the owner filter, the cap or the
  check) and watch the test fail before you trust it. Then restore the code.
- **Flaky tests:** a flaky test is a bug in the test. Wait on what the page or database shows,
  never a fixed sleep.

## 6. How much

- **Bug fix (Fix mode):** a test only for mastery rules, security or data loss, at the lowest layer
  that shows it.
- **New feature:** one flow step for its happy path, plus the edge cases from §3 that apply.
  Usually 1–3 new checks.
- **New route or tool:** signed out, another student, one bad input, the main path.
- **New table:** a pgTAP file for its RLS.
- **Stop** when the next test would only repeat a case that's already covered at another layer.

## 7. Running

- **No database needed:** `npm test`, `npx tsc --noEmit` and `npx eslint` run freely.
- **Local stack:** everything that uses it goes through the stack lock
  (`npm run locked -- npm run check:routes`, `check:connector`, `test:db`, `test:e2e`).
- **One browser spec:** `npm run locked -- npx playwright test e2e/<file>.spec.ts`.
- **CI** runs all of it on every pull request (`.github/workflows/ci.yml`).

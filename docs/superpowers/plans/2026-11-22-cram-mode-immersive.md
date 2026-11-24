# Cram mode you enter: immersive course pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a course is cramming for an exam, its pages become a dark, focused space about that exam only: no quick reviews, no warm-up, no due sidebar; Path and List show the exam's topics; the Atlas greys out the rest; a CRAM MODE banner sits on top; the home island looks different.

**Architecture:** One pure helper decides "is this course in cram mode, for which exam, on which topics" (`crammingExam`, `examTopicIds` in `src/lib/course/exam-card.ts`). Everything else reads it: the to-do cards drop the course, the course pages filter and restyle, the home map marks the island. Dark mode is a scoped override of the colour tokens (`:root[data-cram]` in `globals.css`), set by a small hook while a cramming course's page is mounted, so no component needs dark variants. Nothing new is stored: cram mode ends on its own once the exam date has passed, because it's derived from `exams.cramming && exams.date >= today` (the connector already reads it that way, `src/lib/server/connector.ts:258`).

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (tokens are CSS variables), `motion`, `node:test`, Playwright.

## Decisions (owner, 2026-11-22)

- Cram mode is something the student enters (Cram for this exam → Confirm) and is immersed in, per course.
- **Off-exam reviews: hidden completely** during the cram (no count, no mention). They come back when the cram ends. The FSRS clock keeps running; nothing is stored or changed.
- **In-app study: dives on exam topics only.** Quick reviews, the warm-up and the course-wide "Dive in" pill are hidden; a topic's play button (Path) or node (Atlas) still opens "Dive into [topic]", for exam topics only.
- **Exit:** Stop cramming at any time, and automatically the day after the exam date (derived; no job, no write).
- **Reach:** the course's pages (Path, List, Atlas, the cram page) go dark; the home map's island for that course looks different; the home sidebar drops the course's cards. Other courses are unaffected.
- **Path and List:** only the exam's topics; "Show N other topics" reveals the rest, dimmed, with no play button.
- **Atlas:** topics not on the exam at low opacity, back to full while hovered.
- **Banner:** CRAM MODE at the top of the course pages.

## Assumptions (listed in `docs/TO-DISCUSS.md` by Task 9; not decided by the owner)

1. **One cram per course.** Turning cramming on for an exam turns it off for the course's other exams (the store, the Exams modal and the connector's `set_exam`). Two at once had no defined meaning for filtering.
2. **"Topics on the exam"** = topics with at least one objective `examObjectives` counts (the scope's objectives with weight > 0 when the scope lists objectives, else the exam's `topicIds`, else every topic). The same set the card's "N objectives in scope" counted.
3. **The calendar** drops the crammed course's scheduled quick reviews and dives too (they're paused); exams and homework stay.
4. **A session opened by URL** (`/session/<slug>?kind=quick`) still runs; only the entry points are hidden.
5. **The top bar goes dark too** (the attribute is on `<html>`), so the whole screen reads as cram mode. Modals rendered in place go dark with it.
6. **The banner replaces the exam card while cramming**: CRAM MODE, the exam's title, days left, Open plan, Study with Claude (until connected), Stop cramming. Edit scope moves to the cram page (it's already there). The exam card stays as it is when not cramming.
7. **The home island**: the same island art, dimmed to night (CSS filter) with a "Cram mode" tag under its name pill; its due count reads 0 because its cards are dropped.
8. **Sessions and settings pages** of a cramming course stay light (they're not "the course page").

## Global Constraints

- Colours are tokens only (`CLAUDE.md` Conventions); the dark values come from the Figma "Orca Ocean Dark" variables already in `globals.css` (`#081d33` page, `#0e2a46` card, `#234967` line, `#f3f7fb` ink, `#9fb3c8` muted).
- Pure modules (`src/lib/course/`) use relative imports ending in `.ts` and `import type`.
- Animations come from `src/lib/motion.ts` presets; add new ones there.
- Keep `data-part` attributes stable; new ones are named below and used by the e2e spec.
- No migration. No new dependency.
- Node: `export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH`. e2e and anything touching the local stack through `npm run locked -- …`.
- Per commit (Fix mode checks): `npx tsc --noEmit`, `npx eslint <changed files>`, the one unit test file, the one e2e spec.

## File map

| File | Responsibility |
|---|---|
| `src/lib/course/exam-card.ts` | + `crammingExam`, `examTopicIds` (pure) |
| `tests/course/exam-card.test.ts` | their unit tests |
| `src/lib/store.tsx` | `updateExam`: one cram per course; `useTodos`: drop a cramming course; + `useCramming(courseId)` hook |
| `src/lib/server/connector.ts` | `set_exam`: one cram per course |
| `src/app/calendar/page.tsx` | drop a cramming course's scheduled reviews |
| `src/app/globals.css` | `:root[data-cram]` token overrides |
| `src/components/course/CramTheme.tsx` (new) | `useCramTheme(active)`: sets/clears `data-cram` on `<html>` |
| `src/components/layout/AppShell.tsx` | `sidebar` prop (default true) |
| `src/components/course/CramBanner.tsx` (new) | the CRAM MODE banner |
| `src/app/course/[slug]/page.tsx` | Path: banner, no sidebar, no Dive in / warm-up, exam filter |
| `src/components/path/KnowledgePath.tsx` | `examTopics` filter + "Show N other topics" |
| `src/app/course/[slug]/list/page.tsx` | List: same filter, banner, no sidebar |
| `src/app/course/[slug]/atlas/page.tsx`, `src/components/atlas/TopicGraph.tsx` | dim off-exam topics unless hovered; dives on exam topics only |
| `src/app/course/[slug]/cram/page.tsx` | goes dark |
| `src/components/map/KnowledgeMap.tsx` | night island + "Cram mode" tag |
| `src/lib/onboarding/tips.ts` | a tip on the banner |
| `e2e/cram-immersive.spec.ts` (new) | the browser check |
| `CLAUDE.md`, `docs/TO-DISCUSS.md` | the record |

---

### Task 1: `crammingExam` and `examTopicIds` (pure)

**Files:**
- Modify: `src/lib/course/exam-card.ts`
- Test: `tests/course/exam-card.test.ts`

**Interfaces:**
- Produces:
  - `crammingExam<E extends Pick<Exam, "courseId" | "date" | "cramming">>(exams: readonly E[], courseId: string, today: string): E | null` — the course's exam with `cramming` and `date >= today`, soonest first; null when none (that's the auto-exit).
  - `examTopicIds(exam: Pick<Exam, "topicIds" | "scope">, topics: readonly Topic[], objectives: Readonly<Record<string, Objective>>): Set<string>` — live, surviving topic ids holding at least one of `examObjectives(exam, topics, objectives)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/course/exam-card.test.ts`; `topic`, `objective`, `exam`, `topics`, `objectives` are the file's existing helpers)

```ts
import { crammingExam, examTopicIds } from "../../src/lib/course/exam-card.ts";

test("cram mode: the course's cramming exam from today on; a past one has ended it", () => {
  assert.equal(crammingExam([exam("2026-11-20"), exam("2026-11-25", { cramming: true })], "c", "2026-11-22")?.date, "2026-11-25");
  assert.equal(crammingExam([exam("2026-11-22", { cramming: true })], "c", "2026-11-22")?.date, "2026-11-22", "on the exam's day it's still on");
  assert.equal(crammingExam([exam("2026-11-21", { cramming: true })], "c", "2026-11-22"), null, "the day after, it's off");
  assert.equal(crammingExam([exam("2026-11-25")], "c", "2026-11-22"), null, "an exam not crammed for isn't cram mode");
  assert.equal(crammingExam([exam("2026-11-25", { cramming: true, courseId: "d" })], "c", "2026-11-22"), null);
});

test("the exam's topics: those holding an objective in scope, merges followed", () => {
  assert.deepEqual([...examTopicIds({ topicIds: ["t1"], scope: null }, topics, objectives)], ["t1"]);
  assert.deepEqual([...examTopicIds({ topicIds: ["old"], scope: null }, topics, objectives)].sort(), ["t2"], "a merged topic counts as its survivor");
  const scope = { sources: [], objectives: [{ objectiveId: "b", weight: 1, evidence: [] }, { objectiveId: "a", weight: 0, evidence: [] }] } as unknown as ExamScope;
  assert.deepEqual([...examTopicIds({ topicIds: ["t1", "t2"], scope }, topics, objectives)], ["t2"], "weight 0 leaves a topic out");
  assert.deepEqual([...examTopicIds({ topicIds: [], scope: null }, topics, objectives)].sort(), ["t1", "t2"], "no topics named: every live topic with objectives");
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/course/exam-card.test.ts` → "does not provide an export named 'crammingExam'".

- [ ] **Step 3: Implement** (in `src/lib/course/exam-card.ts`, after `cardExam`)

```ts
/** The exam the course is cramming for: cramming and not yet past (the day after, cram mode is over by itself), soonest first; null when none. */
export function crammingExam<E extends Pick<Exam, "courseId" | "date" | "cramming">>(exams: readonly E[], courseId: string, today: string): E | null {
  return exams.filter((e) => e.courseId === courseId && e.cramming && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

/** The topics an exam is about: the surviving topic of every objective `examObjectives` counts. */
export function examTopicIds(exam: Pick<Exam, "topicIds" | "scope">, topics: readonly Topic[], objectives: Readonly<Record<string, Objective>>): Set<string> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const id of examObjectives(exam, topics, objectives)) {
    const o = objectives[id];
    const t = o && survivingTopic(o.topicId, byId);
    if (t) ids.add(t.id);
  }
  return ids;
}
```

(Check `survivingTopic`'s signature in `src/lib/course/weights.ts` — `examObjectives` already calls it as `survivingTopic(id, byId)?.id`.)

- [ ] **Step 4: Run, expect PASS** — `node --test tests/course/exam-card.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "Cram mode: crammingExam (ends itself after the exam) and examTopicIds"`

---

### Task 2: One cram per course

**Files:**
- Modify: `src/lib/store.tsx` (`updateExam`, ~line 587)
- Modify: `src/lib/server/connector.ts` (`set_exam`, ~line 713)
- Test: `tests/connector/` — the file covering `set_exam` (find with `grep -ln set_exam tests/connector`)

**Interfaces:**
- Consumes: nothing new.
- Produces: the invariant "at most one exam per course has `cramming` true" for later tasks.

- [ ] **Step 1: Failing test** for the connector: `set_exam` with `cramming: true` on exam B while exam A of the same course is cramming → A's row is updated to `cramming: false`. Follow the fake-db pattern already in that test file (it records `upsert`/`update` calls); assert an `update({ cramming: false })` on `exams` filtered by `course_id` and `neq("id", B)`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Connector, right after the upsert succeeds:

```ts
if (cramming) {
  // One cram per course: the others stop (cram mode filters the course by one exam).
  const { error: others } = await db.from("exams").update({ cramming: false }).eq("owner_id", ownerId).eq("course_id", courseId).neq("id", row.id).eq("cramming", true);
  if (others) throw new Error(`Couldn't stop the course's other cram: ${others.message}`);
}
```

Store, in `updateExam`, when `change.cramming === true`:

```ts
const courseId = was?.courseId;
setState((s) => ({ ...s, exams: s.exams.map((e) => (e.id === id ? { ...e, ...change } : change.cramming && e.courseId === courseId ? { ...e, cramming: false } : e)) }));
// …after the row update:
if (change.cramming && courseId) save(async () => mustChange(await browserSupabase().from("exams").update({ cramming: false }).eq("course_id", courseId).neq("id", id).eq("cramming", true).select("id"), { allowNone: true }));
```

(`mustChange` throws on zero rows; check its signature and use the variant that tolerates none, or a plain error check.)

- [ ] **Step 4: Run the connector test, expect PASS;** `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "Cram mode: one exam per course crams at a time"`

---

### Task 3: Pause in-app scheduling for a cramming course

**Files:**
- Modify: `src/lib/store.tsx` (`useTodos` ~line 1077; add `useCramming`)
- Modify: `src/app/calendar/page.tsx` (~line 36)
- Modify: `src/app/course/[slug]/page.tsx` (Dive in pill, warm-up)

**Interfaces:**
- Consumes: `crammingExam`, `examTopicIds` (Task 1).
- Produces: `useCramming(courseId: string | undefined): { exam: Exam; topics: Set<string> } | null` exported from `src/lib/store.tsx`.

- [ ] **Step 1: Add `useCramming`** near `useAgenda`:

```ts
/** The course's cram mode: the exam it's cramming for and that exam's topics; null when it isn't (or the exam has passed). */
export function useCramming(courseId: string | undefined): { exam: Exam; topics: Set<string> } | null {
  const { exams, courses, objectives } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  return useMemo(() => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return null;
    const exam = crammingExam(exams, course.id, dayKey(new Date(nowMs).toISOString()));
    return exam ? { exam, topics: examTopicIds(exam, course.topics, objectives[course.id] ?? {}) } : null;
  }, [exams, courses, objectives, courseId, dayKey, nowMs]);
}
```

- [ ] **Step 2: `useTodos` drops a cramming course.** At the top of the `flatMap` callback:

```ts
// Cram mode pauses the course's quick reviews, dives and warm-up (owner, 2026-11-22): no cards, here or on the home map's count.
if (crammingExam(exams, c.id, dayKey(new Date(nowMs).toISOString()))) return [];
```

(add `exams` to the destructured `useOrca()` and the deps array).

- [ ] **Step 3: Calendar.** In `reviewDates(courses.map(…))`, filter out courses where `crammingExam(exams, c.id, today)` is non-null before mapping. Exams and stored events are untouched.
- [ ] **Step 4: Course page.** `const cram = useCramming(course?.id);` then: don't render the "Dive in" pill when `cram`; pass `warmUp={cram ? null : warmUp}` to `KnowledgePath`.
- [ ] **Step 5:** `npx tsc --noEmit`, `npx eslint` on the three files. Commit — `git commit -m "Cram mode: the course's quick reviews, dives and warm-up pause (sidebar, home count, calendar)"`

(Browser coverage for this is in Task 8's spec.)

---

### Task 4: Dark tokens and the theme hook; AppShell without its sidebar

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/components/course/CramTheme.tsx`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Produces: `useCramTheme(active: boolean): void`; `AppShell` prop `sidebar?: boolean` (default `true`).

- [ ] **Step 1: Tokens.** After the `[data-theme="dark"]` block in `globals.css`:

```css
/* Cram mode (owner, 2026-11-22): a cramming course's pages in Orca Ocean Dark. The light tokens are
   redefined, so every utility (bg-parchment, text-prussian…) turns dark without per-component variants.
   Set on <html> by useCramTheme (src/components/course/CramTheme.tsx). */
:root[data-cram] {
  color-scheme: dark;
  --color-ocean: #081d33;
  --color-parchment: #0e2a46;
  --color-parchment-deep: #234967;
  --color-alice: #163a5c;
  --color-alice-deep: #234967;
  --color-prussian: #f3f7fb;
  --color-ink-deep: #050f1c;
  --color-wisteria-deep: #9fb3c8;
  --color-orca-shadow: #234967;
  --color-page: #081d33;
  --color-card: #0e2a46;
  --color-line: #234967;
  --color-ink: #f3f7fb;
  --color-muted: #9fb3c8;
}
```

(Tailwind v4 compiles `bg-parchment` to `background-color: var(--color-parchment)`, so redefining the variable on `:root[data-cram]` is enough. If a utility was compiled to a literal, grep the built CSS and fix that one.)

- [ ] **Step 2: Hook.**

```tsx
"use client";

import { useEffect } from "react";

/** While mounted with `active`, the whole screen is in cram mode's dark tokens (globals.css, :root[data-cram]). */
export function useCramTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.cram = "1";
    return () => {
      delete root.dataset.cram;
    };
  }, [active]);
}
```

- [ ] **Step 3: AppShell.**

```tsx
export function AppShell({ bg = "parchment", sidebar = true, className, children }: { bg?: "parchment" | "ocean"; sidebar?: boolean; className?: string; children: React.ReactNode }) {
  // …
      {sidebar && <Sidebar />}
```

- [ ] **Step 4:** `npx tsc --noEmit`, eslint. Commit — `git commit -m "Cram mode: dark tokens under :root[data-cram], useCramTheme, AppShell without its sidebar"`

---

### Task 5: The CRAM MODE banner; Path in cram mode

**Files:**
- Create: `src/components/course/CramBanner.tsx`
- Modify: `src/app/course/[slug]/page.tsx`
- Modify: `src/components/path/KnowledgePath.tsx`

**Interfaces:**
- Consumes: `useCramming` (Task 3), `useCramTheme`, `AppShell sidebar` (Task 4), `useConnectorStatus` (`src/components/course/useCram.ts`), `daysUntil` (exam-card.ts).
- Produces: `<CramBanner course={course} exam={exam} />` (`data-part="cram-banner"`); `KnowledgePath` prop `examTopics?: ReadonlySet<string> | null`.

- [ ] **Step 1: Banner.** A full-width strip at the top of the main area (absolute, `left-0 right-0 top-0`, height 44 px, `bg-prussian text-parchment` — in dark tokens that's light ink on dark, so use `bg-wisteria text-parchment` for contrast in both). Content, one line: eyebrow `CRAM MODE` · `{exam.title}` · days text (reuse `daysText` from `ExamCard.tsx`: move it to `src/lib/course/exam-card.ts` as `daysLeftText` and import it in both) · on the right: Open plan (`data-part="cram-plan"`, `/course/<slug>/cram`), Study with Claude (`data-part="study-with-claude"`, only while `!connected`, `/settings#connector`), Stop cramming (`data-part="cram-stop"`, `updateExam(exam.id, { cramming: false })`). Animate with `fadeUp`.
- [ ] **Step 2: Course page.**

```tsx
const cram = useCramming(course?.id);
useCramTheme(!!cram);
// …
<AppShell bg="ocean" sidebar={!cram}>
  {cram && <CramBanner course={course} exam={cram.exam} />}
```

Shift the header down by the banner's height when `cram` (`top-[28px]` → `top-[72px]`), render `ExamCard` only when `!cram`, and pass `examTopics={cram?.topics ?? null}` to `KnowledgePath`. The topic play button keeps opening `DiveModal` (dives on exam topics only: off-exam topics have no play button, Step 3).

- [ ] **Step 3: KnowledgePath filter.** With `examTopics` set, it replaces the weak-spot filter:

```tsx
const onExam = examTopics ? all.filter((t) => examTopics.has(t.id)) : null;
const base = onExam ?? weak;
const filtered = !showAll && base.length < all.length;
const spots = filtered ? defaultTopicPositions(base.length) : null;
const topics = filtered ? base.map((t, i) => ({ ...t, pos: spots![i] })) : all;
const offExam = (t: Topic) => !!examTopics && !examTopics.has(t.id);
```

Off-exam nodes (only visible after "Show all"): `opacity-40`, no play button (`onStart` not wired), `data-off-exam="1"`. The toggle's label in cram mode: `showAll ? "Show exam topics only" : \`Show ${all.length - base.length} other topics\`` (keep `data-part="path-show-all"`).

- [ ] **Step 4:** tsc, eslint, `npm run locked -- npx playwright test e2e/exam-card.spec.ts` (its cramming half moves to the banner: update `card.locator("[data-part=cram-plan]")` etc. to `page.locator("[data-part=cram-banner] …")`, and the card is gone while cramming). Commit — `git commit -m "Cram mode: the CRAM MODE banner; Path dark, without the sidebar, on the exam's topics"`

---

### Task 6: List and Atlas in cram mode; the cram page dark

**Files:**
- Modify: `src/app/course/[slug]/list/page.tsx`
- Modify: `src/app/course/[slug]/atlas/page.tsx`, `src/components/atlas/TopicGraph.tsx`
- Modify: `src/app/course/[slug]/cram/page.tsx`

**Interfaces:**
- Consumes: `useCramming`, `useCramTheme`, `CramBanner`, `AppShell sidebar`.
- Produces: `TopicGraph` prop `muted?: ReadonlySet<string> | null` (topic ids drawn dim).

- [ ] **Step 1: List.** Same three lines as Path (`useCramming`, `useCramTheme`, `sidebar={!cram}`, banner, header pushed down). Rows: when `cram`, `rows` keeps only `cram.topics.has(row.topic.id)`; a "Show N other topics" ghost button (`data-part="list-show-all"`) appends the rest with `opacity-40` and `data-off-exam="1"`. The summary line counts the shown rows.
- [ ] **Step 2: Atlas.** Page: the same theme/banner/sidebar lines; `muted = cram ? new Set(graph.nodes.map((n) => n.topic.id).filter((id) => !cram.topics.has(id))) : null`; `onOpen` ignores muted ids (dives on exam topics only). `TopicNode` gains `muted: boolean`:

```tsx
// Not on the exam being crammed for: faint until hovered (owner, 2026-11-22).
style={{ opacity: dim ? 0.3 : muted && !active ? 0.25 : 1, transition: "opacity 150ms" }}
data-off-exam={muted ? "1" : undefined}
```

- [ ] **Step 3: Cram page.** `useCramTheme(exam?.cramming === true && exam.date >= today)` (the page already has `exam` and `today`). No banner here (its header already says "Cramming for …").
- [ ] **Step 4:** tsc, eslint, `npm run locked -- npx playwright test e2e/atlas.spec.ts e2e/list.spec.ts e2e/cram-page.spec.ts`. Commit — `git commit -m "Cram mode: List and Atlas on the exam's topics, the cram page dark"`

---

### Task 7: The home island; the banner's tip

**Files:**
- Modify: `src/components/map/KnowledgeMap.tsx`
- Modify: `src/lib/onboarding/tips.ts`

- [ ] **Step 1: Island.** `KnowledgeMap` takes `cramming: (courseId: string) => boolean` (the home page passes `(id) => crammingExam(exams, id, today) !== null`). For a cramming course: the island button gets `data-cram="1"` and `style={{ filter: "brightness(0.55) saturate(0.8) hue-rotate(-10deg)" }}` (night), and under the name pill a tag `<span data-part="island-cram" className="eyebrow mt-[6px] rounded-pill bg-prussian px-[10px] py-[3px] text-[11px] text-parchment">Cram mode</span>`. Hand-check in the browser; tune the filter by eye.
- [ ] **Step 2: Tip.** In `tips.ts`, after the course tips: `{ id: "cram-banner", route: COURSE, target: '[data-part="cram-banner"]', title: "Cram mode", body: "This class is all about the exam now. Reviews pause, and you only see its topics. Stop cramming any time; it ends by itself after the exam." }` (check `COURSE` matches List/Atlas too, or add their routes the way other tips do).
- [ ] **Step 3:** tsc, eslint, `node --test tests/onboarding/*.test.ts`. Commit — `git commit -m "Cram mode: the island at night on the map, and a tip on the banner"`

---

### Task 8: Browser spec

**Files:**
- Create: `e2e/cram-immersive.spec.ts`

- [ ] **Step 1: Write the spec** (patterns from `e2e/exam-card.spec.ts`: `seedFixtureCourse`, `admin().from("exams").insert(…)`, `struggled(...)` from `e2e/fixture.ts` so something is due):

```ts
import { admin, expect, F, FIXTURE_STATE, seedFixtureCourse, struggled, seedState, test } from "./fixture";

const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test("cram mode: dark course pages on the exam's topics, reviews paused, banner, night island; ends after the exam", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await seedState(student, struggled(F.boolean)); // a weak point off the exam, due today
  const exam = (date: string, cramming: boolean) => ({ id: crypto.randomUUID(), owner_id: student.id, course_id: F.course, title: "Final", date, topic_ids: [F.twosComplement], cramming, scope: null });
  const live = exam(inDays(5), true);
  if ((await admin().from("exams").insert(live)).error) throw new Error("seed");

  await page.goto(`/course/${SLUG}`);
  await expect(page.locator("html")).toHaveAttribute("data-cram", "1");
  await expect(page.locator("[data-part=cram-banner]")).toContainText("Final");
  await expect(page.locator("[data-part=exam-card]")).toHaveCount(0);
  await expect(page.locator("[data-part=start-deep]")).toHaveCount(0);
  await expect(page.locator("[data-part=nothing-due], [data-part=due-card]")).toHaveCount(0); // no sidebar
  await expect(page.locator(`[data-topic="${F.twosComplementTopic}"]`)).toBeVisible();
  await expect(page.locator(`[data-topic="${F.booleanTopic}"]`)).toHaveCount(0);
  await page.locator("[data-part=path-show-all]").click();
  await expect(page.locator(`[data-topic="${F.booleanTopic}"]`)).toHaveAttribute("data-off-exam", "1");

  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator(`[data-part=topic][data-topic="${F.booleanTopic}"]`)).toHaveAttribute("data-off-exam", "1");

  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-cram", "1");
  await expect(page.locator("[data-part=island-cram]")).toBeVisible();
  await expect(page.locator("[data-part=due-card]")).toHaveCount(0); // the course's quick review is paused

  // After the exam, cram mode is over by itself.
  await admin().from("exams").update({ date: inDays(-1) }).eq("id", live.id);
  await page.goto(`/course/${SLUG}`);
  await expect(page.locator("[data-part=cram-banner]")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-cram", "1");
});
```

(Use the fixture's real names for the topic ids and the path node attribute: check `e2e/fixture.ts` `F` and `KnowledgePath`'s node `data-*`; adjust the selectors, not the assertions.)

- [ ] **Step 2: Run** — `npm run locked -- npx playwright test e2e/cram-immersive.spec.ts`. Expected PASS after Tasks 1–7; fix the code, not the assertions, if it fails.
- [ ] **Step 3: Screenshots for the owner** — Path, List, Atlas, cram page and the home map in cram mode (`page.screenshot` into the scratchpad), and look at each: contrast of text on dark, the island art, modals.
- [ ] **Step 4: Commit** — `git commit -m "Cram mode: browser spec"`

---

### Task 9: Docs

- [ ] `CLAUDE.md` "Start here": a "Since 2026-11-22: cram mode you enter" bullet (what changes, `useCramming`, `:root[data-cram]`, the data-parts `cram-banner`, `island-cram`, `data-off-exam`).
- [ ] `docs/TO-DISCUSS.md`: the eight assumptions above, dated 2026-11-22, for the owner to confirm.
- [ ] Commit — `git commit -m "Docs: cram mode you enter"`

## Merge gate (once, before the PR merges)

`npm test`, `npm run locked -- npm run test:db`, `npm run locked -- npm run test:e2e`, `npm run locked -- npm run check:isolation`, `npm run locked -- npm run check:evidence`.

import type { Page } from "@playwright/test";
import type { AnswerEvent } from "../src/lib/mastery/types";
import { expect, test, pastMiss, stored } from "./fixture";
import { DECK_NAME, makeDeck } from "../tests/fixtures/pdf";
import { fakeModel } from "./fake-model";

/**
 * A student's first day, as one flow: an empty account, a course, a lecture deck uploaded and built
 * by a job (against the fake model), its topics reviewed, the warm-up tried with one miss, and what
 * that miss changes everywhere (trail, island, streak, sidebar). Each step leans on the one before,
 * so this replaces the one-off checks of each screen in its empty state.
 *
 * Deeper checks of single pieces stay in their own specs: what an upload stores (upload.spec.ts),
 * review merges and rejections (review.spec.ts), how misses are scheduled (scheduling.spec.ts).
 */

const DECK = { name: DECK_NAME, mimeType: "application/pdf", buffer: Buffer.from(makeDeck()) };
const anchor = { locator: "slide 12", excerpt: "x + xy = x" };
const LECTURE = {
  topics: [
    { localId: "t1", existingId: null, name: "Boolean Algebra", summary: "Theorems.", slideStart: 2, slideEnd: 12 },
    { localId: "t2", existingId: null, name: "Karnaugh Maps", summary: "Grouping.", slideStart: 13, slideEnd: 18 },
  ],
  objectives: [
    { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o3", existingId: null, topicRef: "t2", name: "Use don't-cares", description: "", origin: "material", places: [anchor], emphasis: null },
  ],
  relations: [{ from: "t1", to: "t2", type: "used-in", anchor: null, reason: "Simplifying with Boolean algebra is how a K-map grouping is justified." }],
};

async function answer(page: Page, text: string) {
  await page.getByPlaceholder("Type your answer").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
}

test("a first day: empty account → course → upload → review → warm-up with a miss → a weak point everywhere", async ({ page, student }) => {
  test.setTimeout(120_000);
  await fakeModel({ extract: LECTURE });

  await test.step("an empty account shows nothing made up", async () => {
    // Old /home links land on the courses map.
    await page.goto("/home");
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByText("No islands yet.")).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveCount(0);
    await expect(page.getByText("0 day streak")).toBeVisible();
    await expect(page.getByText("Nothing. All caught up", { exact: true })).toHaveCount(2);
    // Your progress, Calendar and Add material: Settings is in the top bar.
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveCount(3);
    await page.goto("/calendar");
    await expect(page.locator("[data-today]")).toBeVisible();
    await expect(page.locator('[data-part="event"]')).toHaveCount(0);
    // No in-app chat: the student's own Claude is the tutor.
    expect((await page.goto("/chat"))?.status()).toBe(404);
  });

  await test.step("material needs a course first; the new course is uncharted", async () => {
    await page.goto("/add-material");
    await expect(page.getByText("No course to add material to.")).toBeVisible();
    await page.getByRole("link", { name: "Add Course" }).click();
    await expect(page).toHaveURL(/\/new-course$/);
    await page.getByPlaceholder("Advanced Logic Design").fill("Logic");
    await page.getByRole("button", { name: "Create Course" }).click();
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "uncharted");
    await page.goto("/course/logic");
    await expect(page.getByText("This island is uncharted.")).toBeVisible();
  });

  await test.step("the deck uploads and a job builds the course from it", async () => {
    await page.goto("/add-material");
    await page.locator("[data-part=file-input]").setInputFiles(DECK);
    await page.getByLabel("What kind of material is this?").selectOption("Lecture");
    await page.getByRole("button", { name: "Add to course" }).click();
    await expect(page).toHaveURL(/\/course\/logic\/review\?run=/, { timeout: 30_000 });
    // Nothing is marked in a typed deck, so only the warm-up's questions are written: one per objective.
    await expect(page.locator("[data-part=run-summary]")).toContainText("2 new topics, 3 new objectives, 0 existing objectives covered again, 3 questions added.", { timeout: 60_000 });
  });

  await test.step("the student confirms the topics the upload proposed", async () => {
    const cards = page.locator("[data-part=new-topic]");
    await expect(cards).toHaveCount(2);
    for (const name of ["Boolean Algebra", "Karnaugh Maps"]) await cards.filter({ hasText: name }).getByRole("button", { name: "Confirm topic" }).click();
    await expect(page.getByText("Nothing to review.")).toBeVisible();
    const s = await stored(page, student);
    expect(s.courses[0].topics.map((t) => [t.name, t.review])).toEqual([
      ["Boolean Algebra", "confirmed"],
      ["Karnaugh Maps", "confirmed"],
    ]);
  });

  await test.step("nothing is flagged yet: the trail is empty and offers the warm-up; nothing is locked", async () => {
    await page.goto("/course/logic");
    await expect(page.locator("[data-part=path-no-weak-spots]")).toContainText("No weak spots flagged yet.");
    await expect(page.locator("[data-part=warmup-start]")).toHaveText("Try 3 questions");
    await expect(page.locator('[data-todo="warmup"]')).toContainText("Warm-up");
    await page.locator("[data-part=path-show-all]").click();
    await expect(page.locator('[data-part="start"]')).toHaveCount(1);
    await expect(page.locator('[data-visual="current"]')).toContainText("Boolean Algebra");
    await expect(page.locator("[data-visual] button:disabled")).toHaveCount(0);
  });

  await test.step("the warm-up: one miss, two right", async () => {
    // From the sidebar's card (Show all swapped the trail's warm-up link for START).
    await page.locator('[data-todo="warmup"]').click();
    await expect(page).toHaveURL(/\/session\/logic\?kind=quick&warmup=1$/);
    await expect(page.getByText("1 / 3")).toBeVisible();
    // The fake model's questions are "<objective>: case 1?" with the exact answer 1.
    await answer(page, "nope");
    await expect(page.getByText("Not quite.", { exact: true })).toBeVisible();
    await pastMiss(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await answer(page, "1");
    await expect(page.getByText("Correct.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await answer(page, "1");
    await expect(page.getByText("Correct.")).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("[data-part=quiz-end-summary]")).toBeVisible();
    const evidence = (await stored(page, student)).evidence as AnswerEvent[];
    expect(evidence.map((e) => [e.outcome, e.source]).sort()).toEqual([["correct", "quick-review"], ["correct", "quick-review"], ["incorrect", "quick-review"]]);
    expect(new Set(evidence.map((e) => e.objectiveId)).size).toBe(3);
  });

  await test.step("the miss is a weak point: on the trail, the island sprouts, the streak starts, the warm-up is over", async () => {
    await page.goto("/course/logic");
    await expect(page.locator("[data-visual]")).toHaveCount(1);
    await expect(page.locator('[data-part="label"]').first()).toContainText(/0 of 1 mastered/);
    await expect(page.locator("[data-part=warmup-start]")).toHaveCount(0);
    await expect(page.locator('[data-todo="warmup"]')).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText("1 day streak")).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "sprouting");
  });
});

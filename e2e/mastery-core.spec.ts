import type { Page } from "@playwright/test";
import type { AnswerEvent } from "../src/lib/mastery/types";
import { type Student, expect, test, F, pastMiss, seedFixtureCourse, stored } from "./fixture";

/** The evidence the app saved (through POST /api/evidence), read back from the database. */
async function storedEvidence(page: Page, student: Student) {
  return (await stored(page, student)).evidence as AnswerEvent[];
}

async function answerShort(page: Page, text: string) {
  await page.getByPlaceholder("Type your answer").fill(text);
  await page.getByRole("button", { name: "Check" }).click();
}

/** The empty states and the first course are one flow in first-day.spec.ts; the onboarding screen isn't on it. */
test("onboarding shows all four island looks", async ({ page }) => {
  await page.goto("/welcome");
  for (const level of ["thriving", "growing", "sprouting", "uncharted"]) {
    await expect(page.locator(`[data-level="${level}"]`).first()).toBeVisible();
  }
});

test.describe("a course with uploaded questions", () => {
  test.beforeEach(async ({ student }) => seedFixtureCourse(student));

  test("the warm-up asks one question per objective; a miss makes a weak point and the warm-up is over", async ({ page, student }) => {
    await page.goto("/course/logic-e2e");
    await page.locator("[data-part=warmup-start]").click();
    await expect(page).toHaveURL(/\/session\/logic-e2e\?kind=quick&warmup=1$/);
    await expect(page.getByText("1 / 3")).toBeVisible();
    // Each miss brings back another question on its objective where there is one (Simplify and
    // Convert have more; Sign-extend has one), so the run grows to five.
    for (let i = 0; i < 5; i++) {
      await answerShort(page, "nope");
      await expect(page.getByText("Not quite.", { exact: true })).toBeVisible();
      await pastMiss(page);
      await page.getByRole("button", { name: i === 4 ? "Finish" : "Continue" }).click();
    }
    await expect(page.locator("[data-part=quiz-end-summary]")).toBeVisible();
    const evidence = await storedEvidence(page, student);
    expect(evidence.map((e) => [e.outcome, e.source])).toEqual(Array.from({ length: 5 }, () => ["incorrect", "quick-review"]));
    expect(new Set(evidence.map((e) => e.objectiveId)).size).toBe(3);
    // Every objective is a weak point now: the trail shows both topics, and the warm-up isn't offered again.
    await page.goto("/course/logic-e2e");
    await expect(page.locator("[data-visual]")).toHaveCount(2);
    await expect(page.locator("[data-part=warmup-start]")).toHaveCount(0);
    await expect(page.locator('[data-todo="warmup"]')).toHaveCount(0);
  });

  test("answering quiz questions records evidence, and a miss makes a weak point that moves the trail, island and streak", async ({ page, student }) => {
    await page.goto(`/quiz/logic-e2e/${F.booleanAlgebra}`);
    await answerShort(page, "nope");
    await expect(page.getByText("Not quite.", { exact: true })).toBeVisible();
    await pastMiss(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerShort(page, "a + c");
    await expect(page.getByText("Correct.")).toBeVisible();

    const evidence = await storedEvidence(page, student);
    expect(evidence.map((e) => [e.questionId, e.objectiveId, e.outcome, e.grader])).toEqual([
      [F.ba1, F.simplify, "incorrect", "exact"],
      [F.ba2, F.simplify, "correct", "exact"],
    ]);
    expect(new Set(evidence.map((e) => e.sessionId)).size, "one session per quiz visit").toBe(1);

    await page.goto("/");
    await expect(page.getByText("1 day streak")).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveAttribute("data-level", "sprouting");

    await page.goto("/course/logic-e2e");
    const current = page.locator('[data-visual="current"]');
    await expect(current).toContainText("Boolean Algebra");
    await expect(current).toContainText("0 of 1 mastered");
  });

  test("misses on two topics show weak points on both trail nodes", async ({ page, student }) => {
    await page.goto(`/quiz/logic-e2e/${F.booleanAlgebra}`);
    await answerShort(page, "nope");
    await expect(page.getByText("Not quite.", { exact: true })).toBeVisible();
    await page.goto(`/quiz/logic-e2e/${F.twosComplement}`);
    await answerShort(page, "nope");
    await expect(page.getByText("Not quite.", { exact: true })).toBeVisible();

    const evidence = await storedEvidence(page, student);
    expect(evidence.map((e) => e.objectiveId)).toEqual([F.simplify, F.convert]);
    expect(new Set(evidence.map((e) => e.sessionId)).size, "each quiz visit is its own session").toBe(2);

    await page.goto("/course/logic-e2e");
    // Both topics have weak spots now, so both are on the trail without Show all.
    await expect(page.locator("[data-visual]")).toHaveCount(2);
    for (const name of ["Boolean Algebra", "Two's Complement"]) {
      const label = page.locator('[data-part="label"]').filter({ hasText: name });
      await expect(label).toContainText(/\d+ of \d+ mastered/);
    }
  });
});

import type { AnswerEvent } from "../src/lib/mastery/types";
import { F, FIXTURE_STATE, daysAgo, expect, pastMiss, seedState, stored, struggled, test } from "./fixture";

/** List (owner, 2026-11-10): the topics with weak spots, each with its status and a dive. */
const SLUG = FIXTURE_STATE.courses[0].slug;

test("List shows only topics with weak spots, with their status, and a row's play opens its dive", async ({ page, student }) => {
  await seedState(student, { ...FIXTURE_STATE, evidence: [struggled(F.course, F.twosComplement, F.signExtend, daysAgo(1))] });
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=atlas-switch]").getByRole("link", { name: "List" }).click();
  await expect(page).toHaveURL(new RegExp(`/course/${SLUG}/list$`));
  const rows = page.locator("[data-part=weak-row]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-status", "needs-review");
  await expect(rows.first()).toContainText("Two's Complement");
  await expect(rows.first().locator("[data-part=status-pill]")).toHaveText("Needs review");
  await rows.first().locator("[data-part=weak-row-play]").click();
  await expect(page.locator("[data-part=dive-modal]")).toContainText("Dive into Two's Complement");
});

test("the status slider: Discard leaves it; Mark mastered records a mark that survives a reload; Needs review flags it again", async ({ page, student }) => {
  await seedState(student, { ...FIXTURE_STATE, evidence: [struggled(F.course, F.twosComplement, F.signExtend, daysAgo(1))] });
  await page.goto(`/course/${SLUG}/list`);
  const row = page.locator("[data-part=weak-row]").first();
  await expect(row).toHaveAttribute("data-status", "needs-review");
  // In progress isn't a place to put a topic by hand.
  await expect(row.locator('[data-part=status-stop][data-stop="in-progress"]')).toHaveAttribute("aria-disabled", "true");

  await row.locator('[data-part=status-stop][data-stop="mastered"]').click();
  await expect(page.locator("[data-part=status-confirm]")).toContainText("Mark Two's Complement as mastered?");
  await page.locator("[data-part=status-discard]").click();
  await expect(page.locator("[data-part=status-confirm]")).toHaveCount(0);
  await expect(row.locator("[data-part=status-pill]")).toHaveText("Needs review");

  await row.locator('[data-part=status-stop][data-stop="mastered"]').click();
  await page.locator("[data-part=status-confirm-yes]").click();
  // Mastered topics live under Previous; the row moves there at once and holds Mastered while the server records it.
  await expect(page.locator("[data-part=weak-row]")).toHaveCount(0);
  await expect(page.locator("[data-part=list-empty]")).toContainText("Nothing to work on right now");
  await page.locator('[data-part=list-tab][data-tab="previous"]').click();
  const done = page.locator("[data-part=weak-row]").first();
  await expect(done.locator("[data-part=status-pill]")).toHaveText("Mastered");
  await expect(done).toHaveAttribute("data-status", "mastered");
  await expect(done.locator("[data-part=marked-by-you]")).toBeVisible();
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  await expect(done.locator("[data-part=mastered-on]")).toHaveText(`Mastered ${today}`);
  expect((await stored(page, student)).evidence.filter((e) => e.kind === "mark").map((e) => e.objectiveId)).toEqual([F.signExtend]);
  await page.locator('[data-part=list-tab][data-tab="all"]').click();
  await expect(page.locator("[data-part=weak-row]")).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-part=list-tab][data-tab="previous"]')).toContainText("1");
  await page.locator('[data-part=list-tab][data-tab="previous"]').click();
  await expect(page.locator("[data-part=weak-row]").first()).toHaveAttribute("data-status", "mastered");

  // Back to Needs review from Previous: it returns to Current.
  await page.locator('[data-part=weak-row] [data-part=status-stop][data-stop="needs-review"]').click();
  await expect(page.locator("[data-part=status-confirm]")).toContainText("Move Two's Complement back to Needs review?");
  await page.locator("[data-part=status-confirm-yes]").click();
  await page.locator('[data-part=list-tab][data-tab="current"]').click();
  await expect(page.locator("[data-part=weak-row]").first()).toHaveAttribute("data-status", "needs-review");
});

test("History: a row opens its topic's attempts, with the answer typed in a quiz, the grader's note, the change in mastery and the flags", async ({ page, student }) => {
  const flaggedAt = daysAgo(2);
  const graded: AnswerEvent = {
    kind: "answer", id: crypto.randomUUID(), at: daysAgo(1), courseId: F.course, topicId: F.twosComplement, objectiveId: F.signExtend, questionId: F.tc4, tier: null,
    outcome: "partial", grader: "rubric", source: "quick-review", sessionId: "earlier", response: "Copy the sign bit to the left.",
    graderNote: { feedback: "Right idea, but the result wasn't written out.", satisfied: ["copy the sign bit"], misconception: null },
  };
  await seedState(student, { ...FIXTURE_STATE, evidence: [struggled(F.course, F.twosComplement, F.signExtend, flaggedAt), graded] });

  // A miss in a quick review keeps what was typed.
  await page.goto(`/session/${SLUG}?kind=quick`);
  await page.getByPlaceholder("Type your answer").fill("1010");
  await page.getByRole("button", { name: "Check" }).click();
  await pastMiss(page);
  await expect.poll(async () => (await stored(page, student)).evidence.filter((e) => e.kind === "answer" && e.response === "1010").length).toBe(1);

  await page.goto(`/course/${SLUG}/list`);
  await page.locator("[data-part=weak-row-history]").first().click();
  const modal = page.locator("[data-part=history-modal]");
  await expect(modal).toContainText("Two's Complement");
  const section = modal.locator(`[data-part=history-objective][data-objective="${F.signExtend}"]`);
  const attempts = section.locator("[data-part=history-attempt]");
  // Newest first: today's miss, then the graded answer; the flag is a marker row below them.
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toHaveAttribute("data-outcome", "incorrect");
  await expect(attempts.nth(1)).toHaveAttribute("data-outcome", "partial");
  await expect(section.locator("[data-part=history-marker][data-kind=confusion]")).toContainText("Flagged as hard");
  await expect(attempts.nth(0).locator("[data-part=history-change]")).toHaveText(/^\d+% → \d+%$/);

  await attempts.nth(0).getByRole("button").click();
  await expect(attempts.nth(0).locator("[data-part=history-response]")).toHaveText("1010");
  await expect(attempts.nth(0).locator("[data-part=history-key]")).toHaveText("11111010");
  await attempts.nth(1).getByRole("button").click();
  await expect(attempts.nth(1).locator("[data-part=history-grader]")).toContainText("Right idea, but the result wasn't written out.");
  await expect(attempts.nth(1).locator("[data-part=history-grader]")).toContainText("Got: copy the sign bit");

  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});

import { F, FIXTURE_STATE, daysAgo, expect, seedState, stored, struggled, test } from "./fixture";

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
  await expect(row).toHaveAttribute("data-status", "mastered");
  await expect(row.locator("[data-part=marked-by-you]")).toBeVisible();
  expect((await stored(page, student)).evidence.filter((e) => e.kind === "mark").map((e) => e.objectiveId)).toEqual([F.signExtend]);
  await page.reload();
  await expect(page.locator("[data-part=weak-row]").first()).toHaveAttribute("data-status", "mastered");

  await page.locator('[data-part=weak-row] [data-part=status-stop][data-stop="needs-review"]').click();
  await expect(page.locator("[data-part=status-confirm]")).toContainText("Move Two's Complement back to Needs review?");
  await page.locator("[data-part=status-confirm-yes]").click();
  await expect(page.locator("[data-part=weak-row]").first()).toHaveAttribute("data-status", "needs-review");
});

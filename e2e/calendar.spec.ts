import { expect, F, FIXTURE_STATE, fixtureFlags, seedState, test } from "./fixture";

/** The calendar: a busy day folds into "+n more" (a pop-up lists it all), Week shows it in full, and the filter combines course and type. */
const day = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

test("a busy day opens in a pop-up, Week shows it in full, and the filter combines course and type", async ({ page, student }) => {
  const other = { ...FIXTURE_STATE.courses[0], id: crypto.randomUUID(), slug: "signals", name: "Signals and Systems", short: "SIG", topics: [] };
  const entry = (title: string, courseId: string, kind: "exam" | "hw" = "exam") => ({ id: crypto.randomUUID(), date: day, kind, title, courseId });
  await seedState(student, {
    ...FIXTURE_STATE,
    courses: [...FIXTURE_STATE.courses, other],
    events: [entry("Logic quiz 1", F.course), entry("Logic quiz 2", F.course), entry("Logic HW 4", F.course, "hw"), entry("Signals midterm", other.id)],
    // Weak points, so the fixture course has a quick review today.
    evidence: fixtureFlags(),
  });

  await test.step("month: three entries and +2 more; the pop-up lists all five, exams first", async () => {
    await page.goto("/calendar");
    const today = page.locator("[data-today]");
    await expect(today.locator("[data-part=event]")).toHaveCount(3);
    await expect(today.locator("[data-part=more]")).toHaveText("+2 more");
    await today.locator("[data-part=more]").click();
    const popover = page.locator("[data-part=day-popover]");
    await expect(popover.locator("[data-part=event]")).toHaveCount(5);
    await expect(popover.locator("[data-part=event]").first()).toHaveAttribute("data-kind", "exam");
    await expect(popover.locator("[data-part=event][data-kind=rev]")).toContainText("Quick review");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });

  await test.step("week: every entry in full, with its course's name; the view survives a reload", async () => {
    await page.locator("[data-part=view-switch]").getByRole("button", { name: "Week" }).click();
    await expect(page).toHaveURL(/view=week/);
    const today = page.locator("[data-today]");
    await expect(today.locator("[data-part=event]")).toHaveCount(5);
    await expect(today.locator("[data-part=event][data-kind=hw]")).toContainText("Logic HW 4");
    await page.reload();
    await expect(page.locator("[data-today] [data-part=event]")).toHaveCount(5);
  });

  await test.step("filter: one course, then exams only on top; Show all clears it", async () => {
    await page.locator("[data-part=calendar-filter]").click();
    const panel = page.locator("[data-part=filter-panel]");
    await panel.getByLabel("Signals and Systems").uncheck();
    const today = page.locator("[data-today]");
    await expect(today.locator("[data-part=event]")).toHaveCount(4);
    await panel.getByLabel("Homework").uncheck();
    await panel.getByLabel("Quick reviews").uncheck();
    await expect(today.locator("[data-part=event]")).toHaveCount(2);
    await expect(today.locator("[data-part=event]")).toContainText(["Logic quiz 1", "Logic quiz 2"]);
    await expect(page.locator("[data-part=calendar-filter]")).toContainText("2");
    await panel.getByRole("button", { name: "Show all" }).first().click();
    await panel.getByRole("button", { name: "Show all" }).click();
    await expect(today.locator("[data-part=event]")).toHaveCount(5);
  });
});

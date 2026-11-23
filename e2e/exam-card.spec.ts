import { admin, expect, F, FIXTURE_STATE, seedFixtureCourse, stored, test } from "./fixture";

/**
 * Entering cram mode (cram mode contract, sections 5 and 6; owner, 2026-11-22): the course page has no
 * exam card; Enter cram mode opens the cram page's setup for the next exam (the professor's words, the
 * files, what feels shaky, hours a day), Confirm stores cramming, the scope and the budget (hours by
 * day), the course page then shows the cram mode banner, and Stop cramming clears it. Edit Exams has no
 * Cramming switch.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const WORDS = "Only two's complement, no Boolean algebra.";
const WORRY = "Sign extension, I always mess it up.";
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

test("Enter cram mode opens the next exam's setup; Confirm stores cramming, the scope and the budget, Stop cramming clears it", async ({ page, student }) => {
  await seedFixtureCourse(student);
  const examId = crypto.randomUUID();
  const seeded = await admin()
    .from("exams")
    .insert({ id: examId, owner_id: student.id, course_id: F.course, title: "Midterm", date: inDays(5), topic_ids: [F.twosComplement], cramming: false, scope: null });
  if (seeded.error) throw new Error(`Couldn't seed the exam: ${seeded.error.message}`);

  await page.goto(`/course/${SLUG}`);
  // No exam card on the course page (owner, 2026-11-22): Enter cram mode opens the cram page's setup.
  await expect(page.locator("[data-part=exam-card]")).toHaveCount(0);
  await page.locator("[data-part=enter-cram]").click();
  await expect(page).toHaveURL(`/course/${SLUG}/cram`);
  const setup = page.locator("[data-part=cram-setup]");
  await expect(page.locator("h1")).toContainText("Cram for Midterm");
  // One upload icon on the page (beside the title, not in the setup card) adds a practice exam, held back.
  await expect(page.locator("[data-part=cram-add-material]")).toHaveCount(1);
  await expect(page.locator("[data-part=cram-add-material]")).toHaveAttribute("href", `/add-material?course=${SLUG}&type=Practice%20exam&holdBack=1`);
  // Each day's hours start from the course's exam review duration (the fixture's: 10 hours) over the 5 days; the deck is picked by default.
  await expect(setup.locator("[data-part=cram-hours]")).toHaveValue("2");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`10 hours before ${weekday(inDays(5))}, 5 study days`);
  // Two days differ: an hour tomorrow, nothing in three days.
  const hoursOn = (day: string) => setup.locator(`[data-part=cram-day][data-day="${day}"] [data-part=cram-day-hours]`);
  await hoursOn(inDays(1)).fill("1");
  await hoursOn(inDays(3)).fill("0");
  await expect(setup.locator("[data-part=cram-hours-total]")).toHaveText(`7 hours before ${weekday(inDays(5))}, 4 study days`);
  await expect(setup.locator(`[data-part=cram-material][data-id="${F.material}"]`)).toBeChecked();
  await expect(setup.locator("[data-part=cram-scope-size]")).toHaveText("2 of 2 objectives in scope.");
  await setup.locator("[data-part=professor-words]").fill(WORDS);
  // What feels shaky is free text, kept in the student's words for Claude to map.
  await setup.locator("[data-part=cram-worries]").fill(WORRY);
  await setup.locator("[data-part=cram-confirm]").click();
  await expect(setup).toBeHidden();
  await expect(page.locator("[data-part=cram-page]")).toHaveAttribute("data-cramming", "1");

  // Back on the course page, cram mode: the banner takes the card's place and links to the plan.
  await page.goto(`/course/${SLUG}`);
  const banner = page.locator("[data-part=cram-banner]");
  await expect(banner).toContainText("Midterm");
  await expect(banner.locator("[data-part=cram-plan]")).toHaveText("Open plan");
  await expect(banner.locator("[data-part=cram-plan]")).toHaveAttribute("href", `/course/${SLUG}/cram`);
  await expect(banner.locator("[data-part=study-with-claude]")).toHaveAttribute("href", "/settings#connector");

  let state = await stored(page, student);
  let exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(true);
  expect(exam.scope?.sources).toEqual(["professor"]);
  expect(exam.scope?.objectives.map((o) => [o.objectiveId, o.weight, o.evidence]).sort()).toEqual(
    [
      [F.convert, 1, [{ signal: "professor", strength: "strong", quote: WORDS }]],
      [F.signExtend, 1, [{ signal: "professor", strength: "strong", quote: WORDS }]],
    ].sort(),
  );
  expect(exam.scope?.budget).toMatchObject({ hours: 7, daysOut: [inDays(3)], perDay: { [inDays(0)]: 2, [inDays(1)]: 1, [inDays(2)]: 2, [inDays(3)]: 0, [inDays(4)]: 2 } });
  expect(exam.scope?.materialIds).toEqual([F.material]);
  expect(typeof exam.scope?.budget?.since).toBe("string");
  expect(exam.scope?.worries).toBe(WORRY);
  // Nothing is flagged at setup: Claude maps the words to objectives in the first session.
  expect(state.evidence.filter((e) => e.kind === "confusion" && e.flagSource === "manual")).toEqual([]);

  // Edit on the plan reopens the setup with the words and each day's hours already there.
  await banner.locator("[data-part=cram-plan]").click();
  await expect(page).toHaveURL(`/course/${SLUG}/cram`);
  await page.locator("[data-part=cram-edit]").click();
  await expect(setup.locator("[data-part=professor-words]")).toHaveValue(WORDS);
  await expect(setup.locator("[data-part=cram-worries]")).toHaveValue(WORRY);
  await expect(hoursOn(inDays(1))).toHaveValue("1");
  await expect(hoursOn(inDays(3))).toHaveValue("0");

  await page.goto(`/course/${SLUG}`);
  await banner.locator("[data-part=cram-stop]").click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator("[data-part=enter-cram]")).toBeVisible();
  state = await stored(page, student);
  exam = state.exams.find((e) => e.id === examId)!;
  expect(exam.cramming).toBe(false);
  expect(exam.scope?.sources).toEqual(["professor"]);

  // Edit Exams has no Cramming switch (owner, 2026-11-22): cram mode is entered from the course page.
  await page.locator("[data-part=edit-exams]").click();
  await expect(page.locator("[data-part=exams-modal] input[aria-label='Exam name']")).toHaveValue("Midterm");
  await expect(page.locator("[data-part=exams-modal] [data-part=exam-cramming]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-part=enter-cram]")).toHaveAttribute("href", `/course/${SLUG}/cram`);
});

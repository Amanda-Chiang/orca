import { admin, expect, F, FIXTURE_STATE, fixtureFlags, seedState, stored, test } from "./fixture";

/**
 * Cram mode you enter (owner, 2026-11-22; plan docs/superpowers/plans/2026-11-22-cram-mode-immersive.md):
 * while a course crams for an exam its pages go dark (data-cram on <html>), the due sidebar, quick
 * reviews, warm-up and the course-wide dive go, Path and List show the exam's topics (the rest behind
 * "Show N other topics"), the Atlas fades the others, a CRAM MODE banner sits on top, and the home
 * map's island is at night with its cards dropped. One exam per course crams at a time, and cram mode
 * ends by itself once the exam has passed.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("cram mode: dark course pages on the exam's topics, reviews paused, banner, night island; one cram per course; ends after the exam", async ({ page, student }) => {
  // Every fixture objective is a due weak spot, so the course has a quick review and a dive to pause.
  await seedState(student, { ...FIXTURE_STATE, evidence: fixtureFlags() });
  const exam = (title: string, date: string, cramming: boolean) => ({ id: crypto.randomUUID(), owner_id: student.id, course_id: F.course, title, date, topic_ids: [F.twosComplement], cramming, scope: null });
  const final = exam("Final", inDays(5), true);
  const quiz = exam("Quiz", inDays(10), false);
  const seeded = await admin().from("exams").insert([final, quiz]);
  if (seeded.error) throw new Error(`Couldn't seed the exams: ${seeded.error.message}`);

  // Path: dark, banner instead of the exam card, no sidebar or dive pill, only the exam's topic.
  await page.goto(`/course/${SLUG}`);
  const banner = page.locator("[data-part=cram-banner]");
  await expect(banner).toContainText("Final");
  await expect(page.locator("html")).toHaveAttribute("data-cram", "1");
  await expect(page.locator("[data-part=exam-card]")).toHaveCount(0);
  await expect(page.locator("[data-part=start-deep]")).toHaveCount(0);
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator(`[data-visual][data-topic="${F.twosComplement}"] [data-part=node]`)).toBeVisible();
  await expect(page.locator(`[data-visual][data-topic="${F.booleanAlgebra}"]`)).toHaveCount(0);
  await page.locator("[data-part=path-show-all]").click();
  await expect(page.locator(`[data-visual][data-topic="${F.booleanAlgebra}"]`)).toHaveAttribute("data-off-exam", "1");

  // List: the exam's topic; the other behind "Show 1 other topic", faint and without a play button.
  await page.goto(`/course/${SLUG}/list`);
  await expect(banner).toBeVisible();
  await expect(page.locator(`[data-part=weak-row][data-topic="${F.twosComplement}"]`)).toBeVisible();
  await expect(page.locator(`[data-part=weak-row][data-topic="${F.booleanAlgebra}"]`)).toHaveCount(0);
  await page.locator("[data-part=list-show-all]").click();
  const other = page.locator(`[data-part=weak-row][data-topic="${F.booleanAlgebra}"]`);
  await expect(other).toHaveAttribute("data-off-exam", "1");
  await expect(other.locator("[data-part=weak-row-play]")).toHaveCount(0);

  // Atlas: the topic not on the exam is marked off-exam (drawn faint until hovered).
  await page.goto(`/course/${SLUG}/atlas`);
  await expect(page.locator(`[data-part=topic][data-topic="${F.booleanAlgebra}"]`)).toHaveAttribute("data-off-exam", "1");
  await expect(page.locator(`[data-part=topic][data-topic="${F.twosComplement}"]`)).not.toHaveAttribute("data-off-exam", "1");

  // Home: light again, the island at night, the course's cards gone from the sidebar.
  await page.goto("/");
  await expect(page.locator("[data-part=island-cram]")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-cram", "1");
  await expect(page.locator("aside [data-todo]")).toHaveCount(0);

  // One cram per course: cramming for the Quiz stops the Final's.
  await page.goto(`/course/${SLUG}`);
  await page.locator("[data-part=edit-exams]").click();
  await page.locator("[data-part=exams-modal] [data-part=exam-cramming]").getByRole("switch", { name: "Cramming for Quiz" }).click();
  await page.keyboard.press("Escape");
  await expect(banner).toContainText("Quiz");
  await expect.poll(async () => (await stored(page, student)).exams.map((e) => [e.title, e.cramming]).sort()).toEqual([["Final", false], ["Quiz", true]]);

  // Once the exam has passed, cram mode is over by itself: no banner, light, the dive pill and the card back.
  await admin().from("exams").update({ date: inDays(-1) }).eq("id", quiz.id);
  await page.goto(`/course/${SLUG}`);
  await expect(page.locator("[data-part=exam-card]")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-cram", "1");
  await expect(page.locator("[data-part=start-deep]")).toBeVisible();
});

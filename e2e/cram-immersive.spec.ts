import { admin, expect, F, FIXTURE_STATE, fixtureFlags, seedState, test } from "./fixture";

/**
 * Cram mode you enter (owner, 2026-11-22; plan docs/superpowers/plans/2026-11-22-cram-mode-immersive.md):
 * while a course crams for an exam its pages go dark under a dark grey top bar (data-cram), the due sidebar, quick
 * reviews, warm-up and the course-wide dive go, Path and List show the exam's topics (the rest behind
 * "Show N other topics"), the Atlas fades the others, a CRAM MODE banner sits on top, and the home
 * map's island is at night with its cards dropped. Cram mode ends by itself once the exam has passed.
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("cram mode: dark course pages on the exam's topics, reviews paused, banner, night island; ends after the exam", async ({ page, student }) => {
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
  await expect(page.locator("main").locator("xpath=..")).toHaveAttribute("data-cram", "1");
  // The top bar is dark grey over a course in cram mode.
  await expect(page.locator("[data-part=top-bar]")).toHaveAttribute("data-cram", "1");
  // The nav (your progress, calendar, add material, the course's settings) stays, floating at the bottom right.
  await expect(page.locator("[data-cram] nav[aria-label=Primary] a")).toHaveCount(4);
  await expect(page.locator("[data-part=enter-cram]")).toHaveCount(0);
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
  await expect(page.locator("[data-part=island-spot][data-cramming] [data-part=island-halo]")).toHaveCount(1);
  // The island and its name in cram mode's dark look; the top bar is the usual light one off the course's pages.
  await expect(page.locator("[data-part=island-spot][data-cramming] [data-cram]")).toHaveCount(2);
  await expect(page.locator("[data-part=top-bar]")).not.toHaveAttribute("data-cram", "1");
  await expect(page.locator("aside [data-todo]")).toHaveCount(0);
  // The sidebar's cram card, first: the course, the exam, days left and the share ready; it opens the plan.
  const cramCard = page.locator("aside [data-part=cram-card]");
  await expect(cramCard).toContainText("Cram for Logic Fixture");
  await expect(cramCard).toContainText("Final");
  await expect(cramCard.locator("[data-part=cram-card-days]")).toHaveText("5 days left");
  await expect(cramCard.locator("[data-part=cram-card-progress]")).toHaveText("0% ready");
  await expect(cramCard).toHaveAttribute("href", `/course/${SLUG}/cram`);

  // Calendar: a Cramming key, and the course marked in the filter.
  await page.goto("/calendar");
  await expect(page.locator("[data-part=cram-legend]")).toBeVisible();
  await expect(page.locator("[data-part=course-filter]")).toContainText("Logic Fixture · cramming");

  // Once the exam has passed, cram mode is over by itself: no banner, light, Enter cram mode back (for the Quiz).
  await admin().from("exams").update({ date: inDays(-1) }).eq("id", final.id);
  await page.goto(`/course/${SLUG}`);
  await expect(banner).toHaveCount(0);
  await expect(page.locator("[data-cram]")).toHaveCount(0);
  await expect(page.locator("[data-part=enter-cram]")).toHaveAttribute("href", `/course/${SLUG}/cram`);
});

test("cram mode's sound: bubbles when it starts or stops, unless the banner's speaker turned it off (kept in this browser)", async ({ page, student }) => {
  // Count what the page tries to play (a headless browser has no speakers to listen to).
  await page.addInitScript(() => {
    const w = window as unknown as { plays: string[] };
    w.plays = [];
    HTMLMediaElement.prototype.play = function () {
      w.plays.push(this.src);
      return Promise.resolve();
    };
  });
  const plays = () => page.evaluate(() => (window as unknown as { plays: string[] }).plays);
  await seedState(student, FIXTURE_STATE);
  const final = { id: crypto.randomUUID(), owner_id: student.id, course_id: F.course, title: "Final", date: inDays(5), topic_ids: [F.twosComplement], cramming: true, scope: null };
  if ((await admin().from("exams").insert(final)).error) throw new Error("Couldn't seed the exam");

  // Opening a page already in cram mode plays nothing.
  await page.goto(`/course/${SLUG}`);
  const sound = page.locator("[data-part=cram-banner] [data-part=cram-sound]");
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  expect(await plays()).toEqual([]);

  // Stop cramming: the bubbles play once, with the dive back up.
  await page.locator("[data-part=cram-banner] [data-part=cram-stop]").click();
  await expect.poll(plays).toHaveLength(1);
  expect((await plays())[0]).toContain("/sounds/cram-bubbles.mp3");

  // Muted on the banner, kept after a reload: stopping again plays nothing.
  await admin().from("exams").update({ cramming: true }).eq("id", final.id);
  await page.goto(`/course/${SLUG}`);
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await page.locator("[data-part=cram-banner] [data-part=cram-stop]").click();
  await expect(page.locator("[data-part=cram-banner]")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await plays()).toEqual([]);
});

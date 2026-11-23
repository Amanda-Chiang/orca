import { admin, daysAgo, expect, F, FIXTURE_STATE, seedState, test } from "./fixture";

/**
 * Your progress (owner, 2026-11-22): every minute studied across courses and sources, each exam's
 * time, and the study timer (start, the floating pill elsewhere, stop records the time).
 */
const SLUG = FIXTURE_STATE.courses[0].slug;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

test("the progress page adds up a quiz and a timer once where they overlap, per course and exam", async ({ page, student }) => {
  await seedState(student, {
    ...FIXTURE_STATE,
    results: [{ courseId: F.course, topicId: F.booleanAlgebra, mode: "topic", sessionId: "p-1", correct: 3, total: 4, seconds: 30 * 60, finishedAt: daysAgo(1) }],
  });
  // A 45-minute timer that ended when the quiz did: 15 minutes of it are new.
  const ended = new Date(Date.parse(daysAgo(1)));
  const timer = await admin()
    .from("study_timers")
    .insert({ owner_id: student.id, course_id: F.course, started_at: new Date(ended.getTime() - 45 * 60_000).toISOString(), ended_at: ended.toISOString() });
  if (timer.error) throw new Error(`Couldn't seed the timer: ${timer.error.message}`);
  const exam = await admin().from("exams").insert({ id: crypto.randomUUID(), owner_id: student.id, course_id: F.course, title: "Midterm", date: inDays(10), topic_ids: [] }).select("id").single();
  if (exam.error) throw new Error(`Couldn't seed the exam: ${exam.error.message}`);

  await page.goto("/progress");
  await expect(page.locator("[data-part=progress-all]")).toHaveText("45m");
  await expect(page.locator("[data-part=progress-source][data-source=app]")).toContainText("30m");
  await expect(page.locator("[data-part=progress-source][data-source=timer]")).toContainText("15m");
  await expect(page.locator(`[data-part=progress-exam][data-exam="${exam.data.id}"] [data-part=progress-exam-minutes]`)).toHaveText("45m");

  // Start a session: the timer runs here, floats on other pages, and Discard drops it.
  await page.locator("[data-part=study-timer-start]").click();
  await expect(page.locator("[data-part=study-timer]")).toHaveAttribute("data-running", "1");
  await page.goto(`/course/${SLUG}`);
  await expect(page.locator("[data-part=timer-pill]")).toBeVisible();
  await expect(page.locator("[data-part=course-start-timer]")).toHaveCount(0);
  await page.goto("/progress");
  await page.locator("[data-part=study-timer-discard]").click();
  await expect(page.locator("[data-part=study-timer]")).not.toHaveAttribute("data-running", "1");
  await expect(page.locator("[data-part=progress-all]")).toHaveText("45m");
});

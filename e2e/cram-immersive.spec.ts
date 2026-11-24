import type { Page } from "@playwright/test";
import { admin, expect, F, FIXTURE_STATE, fixtureFlags, seedPages, seedState, stored, test } from "./fixture";

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
  // The view switch: the exam's topics with weak spots, all of the exam's (the default), or every topic (the rest faint).
  const view = page.locator("[data-part=path-cram-view]");
  await expect(view.locator("[data-view=exam]")).toHaveAttribute("aria-selected", "true");
  await view.locator("[data-view=weak]").click();
  await expect(page.locator(`[data-visual][data-topic="${F.twosComplement}"] [data-part=node]`)).toBeVisible();
  await expect(page.locator(`[data-visual][data-topic="${F.booleanAlgebra}"]`)).toHaveCount(0);
  await view.locator("[data-view=all]").click();
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

  // Every other page of the course is dark too: uploads & review, objectives, settings (owner, 2026-11-22).
  for (const tab of ["review?tab=uploads", "review?tab=review", "objectives", "settings"]) {
    await page.goto(`/course/${SLUG}/${tab}`);
    await expect(page.locator("[data-cram]:not([data-part=top-bar])")).toHaveCount(1);
    await expect(page.locator("[data-part=top-bar]")).toHaveAttribute("data-cram", "1");
  }

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

/** One JSON-RPC tool call on the connector, as the student's Claude makes it; the tool's JSON result. */
let rpcId = 1;
async function tool(page: Page, url: string, name: string, args: unknown): Promise<Record<string, unknown>> {
  const res = await page.request.post(url, { data: { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } } });
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  if (body.result.isError) throw new Error(`${name} refused: ${body.result.content[0].text}`);
  return JSON.parse(body.result.content[0].text) as Record<string, unknown>;
}

test("a cram started from Claude: the app goes dark, a dive into an exam topic counts in the chat, Stop cramming ends it for both", async ({ page, student }) => {
  test.setTimeout(90_000);
  await seedState(student, FIXTURE_STATE);
  await seedPages(student, { [F.material]: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ n, text: `Slide ${n}: logic.` })) });
  await page.goto("/");
  const minted = await page.request.post("/api/connector");
  const url = ((await minted.json()) as { url: string }).url;

  await test.step("Claude sets the exam and starts the cram", async () => {
    const exam = await tool(page, url, "set_exam", { courseId: F.course, title: "Final", date: inDays(5), topicIds: [F.booleanAlgebra], cramming: true });
    expect(exam.mode).toBe("exam-week");
  });

  await test.step("the app follows: dark course pages, the banner, the exam's topic only", async () => {
    await page.goto(`/course/${SLUG}`);
    await expect(page.locator("[data-part=cram-banner]")).toContainText("Final");
    await expect(page.locator("[data-part=top-bar]")).toHaveAttribute("data-cram", "1");
    await expect(page.locator(`[data-visual][data-topic="${F.twosComplement}"]`)).toHaveCount(0);
  });

  await test.step("a dive into the exam's topic writes harder questions and the student answers them", async () => {
    // The fake model anchors its questions on slide 2, which Boolean Algebra is taught on.
    await page.locator(`[data-visual][data-topic="${F.booleanAlgebra}"] [data-part=node]`).click();
    const modal = page.locator("[data-part=dive-modal]");
    await expect(modal).toContainText("Dive into Boolean Algebra");
    await modal.locator('[data-part=dive-minutes][data-minutes="10"]').click();
    await modal.locator("[data-part=dive-start]").click();
    await expect(page).toHaveURL(new RegExp(`/session/${SLUG}\\?kind=deep&topic=${F.booleanAlgebra}&minutes=10`));
    await expect(page.getByText("1 / 3")).toBeVisible({ timeout: 30_000 });
    let previous: string | null = null;
    for (;;) {
      if (previous !== null) await expect(page.locator("h1").first()).not.toHaveText(previous);
      const prompt = (await page.locator("h1").first().textContent())!.trim();
      previous = prompt;
      // The fake API's dive questions ("…: deep case 3?") have the case number as their answer.
      const answer = /deep case (\d+)\?$/.exec(prompt)?.[1];
      if (answer === undefined) throw new Error(`Not a dive question: "${prompt}"`);
      await page.getByPlaceholder("Type your answer").fill(answer);
      await page.getByRole("button", { name: "Check" }).click();
      await expect(page.getByText("Correct.")).toBeVisible();
      const finish = page.getByRole("button", { name: "Finish" });
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await page.getByRole("button", { name: "Continue" }).click();
    }
    const evidence = (await stored(page, student)).evidence as Array<{ source: string; objectiveId: string; outcome: string }>;
    expect(evidence).toHaveLength(3);
    expect(evidence.every((e) => e.source === "deep-review" && e.outcome === "correct" && e.objectiveId === F.simplify)).toBe(true);
  });

  await test.step("the next chat sees the dive's answers", async () => {
    const state = (await tool(page, url, "course_state", { courseId: F.course })) as { cramming: string | null; objectives: Array<{ id: string; status: string }> };
    expect(state.cramming).not.toBeNull();
    const answered = new Set(((await stored(page, student)).evidence as Array<{ objectiveId: string }>).map((e) => e.objectiveId));
    const seen = state.objectives.filter((x) => answered.has(x.id));
    expect(seen.map((o) => [o.id, o.status])).toEqual([[F.simplify, "verified"]]);
  });

  await test.step("Stop cramming in the app ends the cram for Claude too", async () => {
    await page.goto(`/course/${SLUG}`);
    await page.locator("[data-part=cram-banner] [data-part=cram-stop]").click();
    await expect(page.locator("[data-part=cram-banner]")).toHaveCount(0);
    await expect(page.locator("[data-part=top-bar]")).not.toHaveAttribute("data-cram", "1");
    await expect.poll(async () => ((await tool(page, url, "course_state", { courseId: F.course, detail: "summary" })) as { cramming: string | null }).cramming).toBeNull();
  });
});

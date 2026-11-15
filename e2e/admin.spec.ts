import { F, admin, expect, seedFixtureCourse, test } from "./fixture";

/**
 * The admin view (2026-11-10) is the owner's alone: `profiles.is_admin`, set only in the database.
 * A plain student gets the app's 404 on its pages and its API (never a 401 or 403 that would say
 * they exist); once the flag is set the pages render and the API answers.
 */
test("a plain student gets 404 on /admin and its API; an admin sees the view", async ({ page, student }) => {
  await seedFixtureCourse(student);
  const denied = await page.goto("/admin");
  expect(denied?.status()).toBe(404);
  await expect(page.locator('[data-part="admin"]')).toHaveCount(0);
  const api = await page.request.get("/api/admin/users");
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: "Not found" });
  expect((await page.request.get("/api/admin/overview")).status()).toBe(404);
  expect((await page.request.get(`/api/admin/users/${student.id}`)).status()).toBe(404);
  // No door to it on the map either.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Add Course" })).toBeVisible();
  await expect(page.locator('[data-part="admin-link"]')).toHaveCount(0);

  // A student can't flag themselves (RLS + trigger); the owner does it in the database.
  const self = await student.db.from("profiles").update({ is_admin: true }).eq("owner_id", student.id);
  expect(self.error?.code).toBe("42501");
  const { error } = await admin().from("profiles").update({ is_admin: true }).eq("owner_id", student.id);
  expect(error).toBeNull();

  // The map now shows the Admin badge, which opens the view (owner, 2026-11-10).
  await page.goto("/");
  await page.locator('[data-part="admin-link"]').click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.locator('[data-part="admin-tiles"]')).toContainText("Users");
  const users = page.locator('[data-part="admin-users"]');
  await expect(users).toContainText(student.email);
  await expect(users).toContainText("admin");

  const listed = await page.request.get("/api/admin/users?sort=spend");
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as { users: Array<{ id: string; email: string; courses: number; isAdmin: boolean }> };
  const me = body.users.find((u) => u.id === student.id);
  expect(me).toMatchObject({ email: student.email, courses: 1, isAdmin: true });

  await page.goto("/admin/users?sort=active");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.locator(`[data-part="admin-users"] a[href="/admin/users/${student.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${student.id}$`));
  await expect(page.locator('[data-part="admin-user-courses"]')).toContainText("Logic Fixture");
  await expect(page.locator('[data-part="admin-user-uploads"]')).toContainText("L01_Fixture.pdf");
  await expect(page.getByText("Page views and time on the app: not recorded")).toBeVisible();

  // What this student is doing, by kind of study (2026-11-15): nothing yet, then seeded sessions.
  await expect(page.locator('[data-part="admin-user-activity"]')).toHaveCount(0);
  await expect(page.getByText("No sessions yet.", { exact: true })).toHaveCount(2);
  const seeded = await admin()
    .from("session_results")
    .insert([
      { owner_id: student.id, course_id: F.course, mode: "quick", session_id: "e2e-quick", correct: 3, total: 4, seconds: 300, warmup: false },
      { owner_id: student.id, course_id: F.course, mode: "quick", session_id: "e2e-warm", correct: 2, total: 5, seconds: 180, warmup: true },
      { owner_id: student.id, course_id: F.course, mode: "deep", session_id: "e2e-deep", correct: 6, total: 8, seconds: 1200, warmup: false },
    ]);
  expect(seeded.error).toBeNull();
  await page.reload();
  const kinds = page.locator('[data-part="admin-user-activity"]');
  await expect(kinds.locator("tbody tr")).toHaveCount(6);
  // Kind, then sessions / minutes / answers for today, 7 days and all time (answers come from evidence: none seeded).
  await expect(kinds.locator("tr", { has: page.locator('[data-kind="warmup"]') }).locator("td")).toHaveText(["Warm-up", "1", "3", "0", "1", "3", "0", "1", "3", "0"]);
  await expect(kinds.locator("tr", { has: page.locator('[data-kind="quick"]') }).locator("td").nth(2)).toHaveText("5");
  await expect(kinds.locator("tr", { has: page.locator('[data-kind="connector"]') }).locator("td").nth(2)).toHaveText("0 est.");
  // Today's row of the per-day table: day, then topic, quick, dive, re-quiz, warm-up, connector, minutes, answers.
  const days = page.locator('[data-part="admin-user-activity-days"] tbody tr');
  await expect(days).toHaveCount(30);
  await expect(days.first().locator("td")).toHaveText([new Date().toISOString().slice(0, 10), "0", "1", "1", "0", "1", "0", "28", "0"]);
  await expect(page.locator('[data-part="admin-user-sessions"]')).toContainText("quick (warm-up)");
  await page.goto("/admin");
  await expect(page.locator('[data-part="admin-activity"] tbody tr')).toHaveCount(6);
  await expect(page.locator('[data-part="admin-activity"] [data-kind="warmup"]')).toHaveText("Warm-up");

  await page.goto("/admin/questions");
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
  await expect(page.getByText("No thumbs down yet.")).toBeVisible();

  await page.goto("/admin/spend");
  await expect(page.getByRole("heading", { name: "Spend" })).toBeVisible();
  await expect(page.locator('[data-part="admin-spend-days"] tbody tr')).toHaveCount(30);

  // Every admin read was logged.
  const { data: events } = await admin().from("security_events").select("quote").eq("owner_id", student.id).eq("kind", "admin_read");
  const routes = (events ?? []).map((e) => e.quote);
  expect(routes).toEqual(expect.arrayContaining(["/admin", "/api/admin/users?sort=spend", "/admin/spend", "/admin/questions"]));
});

test("the heartbeat records when a signed-in tab was last open", async ({ page, student }) => {
  const before = await admin().from("profiles").select("last_active_at").eq("owner_id", student.id).single();
  expect(before.data?.last_active_at).toBeNull();
  const beat = page.waitForResponse((r) => r.url().endsWith("/api/heartbeat") && r.request().method() === "POST");
  await page.goto("/");
  expect((await beat).status()).toBe(204);
  await expect.poll(async () => (await admin().from("profiles").select("last_active_at").eq("owner_id", student.id).single()).data?.last_active_at).not.toBeNull();
  const faked = await student.db.from("profiles").update({ last_active_at: new Date(0).toISOString() }).eq("owner_id", student.id);
  expect(faked.error?.code).toBe("42501");
});

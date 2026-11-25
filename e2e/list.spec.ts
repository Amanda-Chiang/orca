import type { QuizQuestion } from "../src/lib/data";
import type { AnswerEvent, EvidenceEvent } from "../src/lib/mastery/types";
import { fakeModel } from "./fake-model";
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

test("History: an essay answer in a quick review keeps the rubric grader's note, the kind of mistake and the words", async ({ page, student }) => {
  const prose: QuizQuestion = {
    id: crypto.randomUUID(), kind: "Short answer", tier: "mechanism", topic: "Two's Complement", prompt: "Why does sign extension copy the top bit?", options: [], answer: -1,
    rubric: { requiredIdeas: ["The top bit is the sign"], acceptableAlternatives: [], knownMisconceptions: [{ description: "thinks zeros are added", indicativePhrasing: ["add zeros"] }] }, explanation: "The new bits' weights cancel.", anchor: { locator: "slide 9", excerpt: "fixture" }, objectiveId: F.signExtend,
  };
  const bank = FIXTURE_STATE.questionBank[F.course];
  await seedState(student, {
    ...FIXTURE_STATE,
    questionBank: { [F.course]: { ...bank, [F.twosComplement]: [...bank[F.twosComplement].filter((q) => q.objectiveId !== F.signExtend), prose] } },
    evidence: [struggled(F.course, F.twosComplement, F.signExtend, daysAgo(1))],
  });
  await fakeModel({ grade: { outcome: "partial", feedback: "Half there: say why the value stays the same.", satisfied: ["The top bit is the sign"], misconception: "thinks zeros are added", errorType: "concept" } });

  await page.goto(`/session/${SLUG}?kind=quick`);
  await page.getByPlaceholder(/One or two sentences/).fill("Because the top bit is the sign.");
  await page.getByRole("button", { name: "Check" }).click();
  await pastMiss(page);
  await expect
    .poll(async () => (await stored(page, student)).evidence.find((e) => e.kind === "answer" && e.questionId === prose.id))
    .toMatchObject({
      grader: "rubric",
      outcome: "partial",
      response: "Because the top bit is the sign.",
      errorType: "concept",
      graderNote: { feedback: "Half there: say why the value stays the same.", satisfied: ["The top bit is the sign"], misconception: "thinks zeros are added" },
    });

  await page.goto(`/course/${SLUG}/list`);
  await page.locator("[data-part=weak-row-history]").first().click();
  const attempt = page.locator("[data-part=history-attempt]").first();
  await expect(attempt).toHaveAttribute("data-outcome", "partial");
  await attempt.getByRole("button").click();
  await expect(attempt.locator("[data-part=history-response]")).toHaveText("Because the top bit is the sign.");
  await expect(attempt.locator("[data-part=history-key]")).toHaveText("The top bit is the sign");
  const grader = attempt.locator("[data-part=history-grader]");
  await expect(grader).toContainText("Half there: say why the value stays the same.");
  await expect(grader).toContainText("Got: The top bit is the sign");
  await expect(grader).toContainText("Mix-up: thinks zeros are added");
  await expect(attempt).toContainText("Kind of mistake: The idea itself");
});

test("History: older answers, Claude's questions and problems, marks and signals each show as they should", async ({ page, student }) => {
  const claudes: QuizQuestion = { ...FIXTURE_STATE.questionBank[F.course][F.twosComplement][3], id: crypto.randomUUID(), prompt: "Sign-extend 0110 to 8 bits.", exact: ["00000110"], source: "claude" };
  const bank = FIXTURE_STATE.questionBank[F.course];
  const base = { courseId: F.course, topicId: F.twosComplement, objectiveId: F.signExtend, tier: null, sessionId: "earlier" } as const;
  const chat = { courseId: F.course, topicId: F.twosComplement, objectiveId: F.signExtend, source: "connector", sessionId: "chat" } as const;
  const evidence: EvidenceEvent[] = [
    struggled(F.course, F.twosComplement, F.signExtend, daysAgo(6)),
    // Saved before answers kept their words: none.
    { ...base, kind: "answer", id: crypto.randomUUID(), at: daysAgo(5), questionId: F.tc4, outcome: "incorrect", grader: "exact", source: "quick-review" },
    // "Don't know": self-marked, nothing typed.
    { ...base, kind: "answer", id: crypto.randomUUID(), at: daysAgo(4, Date.now() - 3_600_000), questionId: F.tc4, outcome: "incorrect", grader: "self", source: "quiz" },
    { ...chat, kind: "answer", id: crypto.randomUUID(), at: daysAgo(4), questionId: claudes.id, tier: null, outcome: "correct", grader: "exact", response: "00000110", help: "hint" },
    { ...chat, kind: "work", id: crypto.randomUUID(), at: daysAgo(3), problem: "Sign-extend 1001 to 6 bits.", response: "111001", basis: "known-answer", outcome: "correct" },
    { ...chat, kind: "signal", id: crypto.randomUUID(), at: daysAgo(3, Date.now() - 3_600_000), signal: "asked-harder", note: null },
    { ...chat, kind: "signal", id: crypto.randomUUID(), at: daysAgo(2), signal: "lost", note: null },
    { kind: "mark", id: crypto.randomUUID(), at: daysAgo(1), courseId: F.course, topicId: F.twosComplement, objectiveId: F.signExtend },
  ];
  await seedState(student, { ...FIXTURE_STATE, questionBank: { [F.course]: { ...bank, [F.twosComplement]: [...bank[F.twosComplement], claudes] } }, evidence });

  await page.goto(`/course/${SLUG}/list`);
  await page.locator('[data-part=list-tab][data-tab="all"]').click();
  await page.locator("[data-part=weak-row-history]").first().click();
  const section = page.locator(`[data-part=history-objective][data-objective="${F.signExtend}"]`);
  // Newest first: the mark, the signal, Claude's problem, Claude's question, "Don't know", the old answer, the flag.
  const markers = section.locator("[data-part=history-marker]");
  await expect(markers).toHaveCount(3);
  await expect(markers.nth(0)).toHaveAttribute("data-kind", "mark");
  await expect(markers.nth(0)).toContainText("You marked it mastered");
  await expect(markers.nth(1)).toContainText("You told your AI you were lost");
  await expect(markers.nth(2)).toContainText("Flagged as hard: you flagged it");
  // Asking for something harder changes nothing, so it isn't listed.
  await expect(section).not.toContainText("harder");

  const attempts = section.locator("[data-part=history-attempt]");
  await expect(attempts).toHaveCount(4);
  await expect(attempts.nth(0)).toContainText("Your AI's problem");
  await expect(attempts.nth(0)).toContainText("Sign-extend 1001 to 6 bits.");
  await expect(attempts.nth(1)).toContainText("Your AI's question · with a hint");
  await expect(attempts.nth(2)).toContainText("Topic quiz · marked by you");
  await expect(attempts.nth(3)).toContainText("Quick review");

  await attempts.nth(0).getByRole("button").click();
  await expect(attempts.nth(0).locator("[data-part=history-response]")).toHaveText("111001");
  await expect(attempts.nth(0)).toContainText("Checked against a known answer");
  await expect(attempts.nth(0).locator("[data-part=history-key]")).toHaveCount(0);
  await attempts.nth(2).getByRole("button").click();
  await expect(attempts.nth(2).locator("[data-part=history-response]")).toHaveText("Don't know, or not saved");
  await attempts.nth(3).getByRole("button").click();
  await expect(attempts.nth(3).locator("[data-part=history-response]")).toHaveText("Not saved");
  await expect(attempts.nth(3).locator("[data-part=history-key]")).toHaveText("11111010");
  await expect(attempts.nth(3).locator("[data-part=history-grader]")).toHaveCount(0);

  // Closing by the button too.
  await page.locator("[data-part=history-modal]").getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-part=history-modal]")).toHaveCount(0);
});

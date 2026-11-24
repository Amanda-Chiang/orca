/**
 * The Claude connector (MCP, `POST /api/mcp/<token>`) as a student's chat uses it, over real HTTP
 * against Supabase and the fake model, in flows rather than one call at a time. The same endpoint
 * serves Claude and ChatGPT (both speak MCP over HTTP), so a ChatGPT-style client is a flow too.
 *
 * 1. The link: minted, only its hash stored, replaced, revoked (the Settings card's API).
 * 2. A course built from the chat: Claude pastes the student's notes (add_material), Orca's upload job
 *    builds topics and objectives and writes warm-up questions; Claude asks one, the student misses it,
 *    the objective becomes a weak point that the app's due list sees; Claude writes a question of its
 *    own, records a hinted answer, logs the sitting, and the next chat (and the app's study log) picks up
 *    the bookmark. A past exam pasted in goes to the vault, never to material_for.
 * 3. Another student's link reaches nothing of this course, read or write.
 * 4. A ChatGPT-style client: an older protocol version, tool schemas a strict client accepts, a batch
 *    refused, and the per-link rate limit.
 *
 * The e2e spec (e2e/connector.spec.ts) covers the graders, cram mode and the exam map on a seeded
 * course; this suite covers what spans the chat and the rest of Orca.
 *
 *   npm run check:connector                                   # local stack; starts next dev + fake model
 */
import { randomUUID } from "node:crypto";
import { type Reply, type Student, call, check, createCourse, createUser, deleteUsers, fakeScenario, report, rows, section, startApp, startFakeModel, stopChildren } from "./support/http-check.ts";

let APP = "";
const api = (path: string, opts: Parameters<typeof call>[2] = {}) => call(APP, path, opts);
const body = <T>(r: Reply) => r.body as T;

let rpcId = 0;
const rpc = (path: string, method: string, params?: unknown) => api(path, { method: "POST", body: { jsonrpc: "2.0", id: ++rpcId, method, ...(params === undefined ? {} : { params }) } });

interface ToolReply {
  status: number;
  isError: boolean;
  // Tool results are whatever JSON the tool returned.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}
async function tool(path: string, name: string, args: Record<string, unknown>): Promise<ToolReply> {
  const r = await rpc(path, "tools/call", { name, arguments: args });
  const result = body<{ result?: { content: Array<{ text: string }>; isError?: boolean } }>(r).result;
  return { status: r.status, isError: result?.isError ?? true, value: result ? JSON.parse(result.content[0].text) : r.body };
}

async function mintLink(student: Student): Promise<string> {
  const minted = await api("/api/connector", { method: "POST", token: student.token, body: {} });
  if (minted.status !== 201) throw new Error(`Setup: couldn't mint a connector link: ${JSON.stringify(minted)}`);
  return new URL(body<{ url: string }>(minted).url).pathname;
}

async function until<T>(what: string, read: () => Promise<T>, done: (v: T) => boolean, ms = 90_000): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(last).slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 1000));
    last = await read();
  }
  return last;
}

/** What the fake model finds in the pasted notes: two topics, one a page, three objectives. */
const anchor = { locator: "page 1", excerpt: "x + xy = x" };
const kmapAnchor = { locator: "page 2", excerpt: "groups adjacent ones" };
const NOTES_EXTRACT = {
  topics: [
    { localId: "t1", existingId: null, name: "Boolean Algebra", summary: "Theorems.", slideStart: 1, slideEnd: 1 },
    { localId: "t2", existingId: null, name: "Karnaugh Maps", summary: "Grouping.", slideStart: 2, slideEnd: 2 },
  ],
  objectives: [
    { localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", origin: "material", places: [anchor], emphasis: null },
    { localId: "o2", existingId: null, topicRef: "t2", name: "Group ones on a K-map", description: "", origin: "material", places: [kmapAnchor], emphasis: null },
    { localId: "o3", existingId: null, topicRef: "t2", name: "Use don't-cares", description: "", origin: "material", places: [kmapAnchor], emphasis: null },
  ],
  relations: [],
};
// Two pages (pasted text is cut into pages of about 12,000 characters, at line breaks): the fake model anchors its questions on page 2.
const NOTES = [
  `Lecture 3 notes. Absorption: x + xy = x. ${"Worked examples of absorption and consensus. ".repeat(180)}`,
  `Karnaugh maps group adjacent ones in powers of two; don't-cares may join a group. ${"Worked K-map groupings. ".repeat(300)}`,
].join("\n");

async function linkLifecycle(A: Student): Promise<string> {
  section("1. The connector link (Settings → Claude connector)");
  const before = await api("/api/connector", { token: A.token });
  check("not connected at first", body<{ connected: boolean }>(before).connected === false, before);
  const first = await mintLink(A);
  const token = first.split("/").pop()!;
  const stored = await rows(`connector_tokens?owner_id=eq.${A.id}&select=*`);
  check("a link is minted; only a hash of its token is stored", stored.length === 1 && !JSON.stringify(stored).includes(token), stored.length);
  check("Settings now says connected", body<{ connected: boolean }>(await api("/api/connector", { token: A.token })).connected === true, "");
  const init = await rpc(first, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } });
  check("Claude's handshake: initialize answers with Orca's instructions", init.status === 200 && typeof body<{ result: { instructions?: string } }>(init).result.instructions === "string", init);
  const second = await mintLink(A);
  check("a new link stops the old one at once (401)", (await rpc(first, "tools/list")).status === 401, "");
  check("and the new one works", (await rpc(second, "tools/list")).status === 200, "");
  await api("/api/connector", { method: "DELETE", token: A.token });
  check("Disconnect revokes it (401)", (await rpc(second, "tools/list")).status === 401, "");
  check("an unknown link is a 401", (await rpc(`/api/mcp/${randomUUID()}`, "tools/list")).status === 401, "");
  return mintLink(A);
}

async function courseFromTheChat(A: Student, link: string, modelUrl: string): Promise<{ courseId: string; objectiveIds: string[] }> {
  section("2. A course built and studied from the chat");
  const courseId = await createCourse(A, "Logic Design");
  await fakeScenario(modelUrl, { extract: NOTES_EXTRACT, perObjective: 2 });

  // The student pastes their notes into the chat; Claude hands them to Orca.
  const added = await tool(link, "add_material", { courseId, type: "Typed notes", text: NOTES, filename: "Lecture 3 notes" });
  const materialId: string | undefined = added.value?.material?.id;
  check("add_material turns the pasted notes into a material", !added.isError && Boolean(materialId) && added.value.material.heldBack === false, added);
  const run = await until("the upload job", () => rows<{ status: string; error: string | null }>(`pipeline_runs?owner_id=eq.${A.id}&material_id=eq.${materialId}&kind=eq.upload&select=status,error`), (r) => r.length > 0 && ["done", "failed"].includes(r[0].status));
  check("Orca's upload job builds from it", run[0]?.status === "done", run);

  // The next chat opens with course_state: the topics and objectives the job built, nothing due yet.
  const state = await tool(link, "course_state", { courseId });
  const objectives: Array<{ id: string; name: string; status: string; questions: number }> = state.value.objectives ?? [];
  const byName = Object.fromEntries(objectives.map((o) => [o.name, o]));
  check("course_state shows the topics and objectives built from the notes", !state.isError && state.value.topics?.length === 2 && objectives.length === 3, state.value?.topics);
  check("every objective starts unflagged and nothing is due", objectives.every((o) => o.status === "unseen") && state.value.dueNow?.length === 0, objectives);
  check("the warm-up wrote questions for them", objectives.every((o) => o.questions >= 1), { questions: objectives.map((o) => o.questions), steps: await (await fetch(`${modelUrl}/__calls`)).json(), run });
  const absorption = byName["Simplify with absorption"];

  // Claude teaches from the course's own pages, then asks Orca's question.
  const pieces = await tool(link, "material_for", { courseId, objectiveIds: [absorption.id] });
  check("material_for gives the pages that teach the objective", !pieces.isError && JSON.stringify(pieces.value).includes("Absorption"), pieces.value);
  const next = await tool(link, "next_questions", { courseId, objectiveIds: [absorption.id] });
  const q = next.value.questions?.[0];
  check("next_questions gives a question on it, without its key", !next.isError && q?.objectiveId === absorption.id && !("exact" in q) && !("answer" in q && typeof q.answer === "number"), next.value);

  // The student gets it wrong: a weak point, due in Orca's own review.
  const missed = await tool(link, "check_answer", { courseId, questionId: q.id, response: "definitely not the answer" });
  check("check_answer grades the miss and hands back the key", !missed.isError && missed.value.outcome === "incorrect" && missed.value.status === "learning" && missed.value.recorded === true, missed.value);
  const events = await rows<{ source: string; outcome: string }>(`evidence_events?owner_id=eq.${A.id}&question_id=eq.${q.id}&select=source,outcome`);
  check("the miss is evidence from the connector, like any answer", events.length === 1 && events[0].source === "connector" && events[0].outcome === "incorrect", events);
  const state2 = await api(`/api/state?course=${courseId}`, { token: A.token });
  check("the app's state for the course reads the same evidence", state2.status === 200 && JSON.stringify(state2.body).includes(absorption.id), state2.status);
  const after = await tool(link, "course_state", { courseId, detail: "weak" });
  check("course_state now lists it as a weak point", JSON.stringify(after.value).includes(absorption.id), after.value);

  // Claude writes a question of its own from the material and the student answers it with a hint.
  const own = await tool(link, "add_questions", {
    courseId,
    questions: [{ objectiveId: absorption.id, kind: "Short answer", prompt: "Simplify a + ab.", exact: ["a"], explanation: "Absorption: a + ab = a.", anchor: { locator: "page 1", excerpt: "x + xy = x", materialId } }],
  });
  const ownId: string | undefined = own.value.added?.[0]?.id;
  check("add_questions stores Claude's anchored question", !own.isError && Boolean(ownId) && (own.value.refused ?? []).length === 0, own.value);
  const asked = await tool(link, "next_questions", { courseId, objectiveIds: [absorption.id], count: 5 });
  check("next_questions can serve Claude's question", (asked.value.questions ?? []).some((x: { id: string }) => x.id === ownId), asked.value);
  const hinted = await tool(link, "record_answer", { courseId, questionId: ownId, outcome: "correct", response: "a", help: "hint", confidence: 2 });
  check("record_answer takes Claude's grade with the hint it gave", !hinted.isError && hinted.value.recorded === true, hinted.value);
  const hintedEvent = await rows<{ help: string | null; grader: string }>(`evidence_events?owner_id=eq.${A.id}&question_id=eq.${ownId}&select=help,grader`);
  check("stored with help: hint (half credit) and grader claude", hintedEvent[0]?.help === "hint" && hintedEvent[0]?.grader === "claude", hintedEvent);

  // The student says they're lost on K-maps: a struggled flag puts that objective in rotation too.
  const kmap = byName["Group ones on a K-map"];
  const flagged = await tool(link, "flag_check", { courseId, objectiveIds: [kmap.id], said: "I'm lost on grouping", strength: "struggled" });
  check("flag_check with struggled makes it a weak point", !flagged.isError && flagged.value.flagged?.[0]?.status === "learning", flagged.value);
  const flags = await rows<{ flag_source: string }>(`evidence_events?owner_id=eq.${A.id}&objective_id=eq.${kmap.id}&kind=eq.confusion&select=flag_source`);
  check("recorded as the connector's struggled flag", flags.some((f) => f.flag_source === "connector-struggled"), flags);

  // The sitting ends: logged, so the next chat and the app both pick it up.
  const logged = await tool(link, "log_session", { courseId, minutes: 40, summary: "Absorption and K-map grouping.", worked: [{ what: "Absorption drills", outcome: "with-hints", objectiveIds: [absorption.id] }], bookmark: "K-maps: grouping not started", next: ["Group ones on a 4-variable K-map"] });
  check("log_session records the sitting", !logged.isError, logged.value);
  const reopened = await tool(link, "course_state", { courseId, detail: "summary" });
  check("the next chat opens where this one stopped (lastSession)", reopened.value.lastSession?.bookmark === "K-maps: grouping not started", reopened.value.lastSession);
  const studyLog = await api(`/api/study-log?courseId=${courseId}`, { token: A.token });
  check("the app's study log shows the sitting", body<{ sittings: Array<{ minutes: number }> }>(studyLog).sittings.some((s) => s.minutes === 40), studyLog);
  const studyTime = await api("/api/study-time", { token: A.token });
  check("and Your progress counts its minutes", body<{ sittings: Array<{ minutes: number }> }>(studyTime).sittings.some((s) => s.minutes === 40), studyTime);

  // A past exam pasted into the chat goes to the vault: Claude may plan from it, the student isn't quizzed from it.
  const exam = await tool(link, "add_material", { courseId, type: "Past exam", text: "Midterm 2025. Q1. Simplify x + xy. Q2. Group the ones on this K-map.", filename: "Midterm 2025" });
  check("a past exam is held back by default", !exam.isError && exam.value.material?.heldBack === true, exam.value);
  const vault = await tool(link, "course_state", { courseId, detail: "summary" });
  check("course_state lists it in the vault by name", JSON.stringify(vault.value.vault ?? []).includes("Midterm 2025"), vault.value.vault);
  const fromVault = await tool(link, "material_for", { courseId, objectiveIds: [absorption.id] });
  check("material_for never quotes it", !JSON.stringify(fromVault.value).includes("Midterm 2025. Q1"), fromVault.value);
  const link2 = await tool(link, "add_material", { courseId, type: "Lecture", file: true });
  check("a file is sent through an upload link to Add material", !link2.isError && /\/add-material\?course=/.test(link2.value.uploadLink ?? ""), link2.value);

  return { courseId, objectiveIds: objectives.map((o) => o.id) };
}

async function anotherStudentsLink(A: Student, B: Student, courseId: string, objectiveIds: string[]) {
  section("3. Another student's link reaches nothing of this course");
  const bLink = await mintLink(B);
  const [objectiveId] = objectiveIds;
  const [question] = await rows<{ id: string }>(`questions?course_id=eq.${courseId}&select=id&limit=1`);
  const before = (await rows(`evidence_events?course_id=eq.${courseId}&select=id`)).length;
  const attempts: Array<[string, Record<string, unknown>]> = [
    ["course_state", { courseId }],
    ["next_questions", { courseId }],
    ["material_for", { courseId, objectiveIds: [objectiveId] }],
    ["check_answer", { courseId, questionId: question.id, response: "x" }],
    ["record_answer", { courseId, questionId: question.id, outcome: "correct", response: "x" }],
    ["flag_check", { courseId, objectiveIds: [objectiveId], said: "help" }],
    ["log_evidence", { courseId, objectiveId, kind: "signal", signal: "lost" }],
    ["add_questions", { courseId, questions: [{ objectiveId, kind: "True or false", prompt: "x + xy = x.", options: ["True", "False"], answer: 0, explanation: "Absorption." }] }],
    ["add_material", { courseId, type: "Typed notes", text: "Planted notes." }],
    ["set_exam", { courseId, title: "Fake final", date: "2027-01-10", topicIds: [] }],
    ["log_session", { courseId, minutes: 5, summary: "Planted.", worked: [] }],
  ];
  for (const [name, args] of attempts) {
    const r = await tool(bLink, name, args);
    check(`B's ${name} on A's course is refused`, r.isError, r.value);
  }
  const listed = await tool(bLink, "course_state", {});
  check("B's course list doesn't include A's course", !JSON.stringify(listed.value).includes(courseId), listed.value);
  check("no evidence was added to A's course", (await rows(`evidence_events?course_id=eq.${courseId}&select=id`)).length === before, "");
  check("no exam, material or sitting was added to A's course", (await rows(`exams?course_id=eq.${courseId}&select=id`)).length === 0 && (await rows(`materials?course_id=eq.${courseId}&filename=ilike.*Planted*&select=id`)).length === 0 && (await rows(`study_sessions?course_id=eq.${courseId}&minutes=eq.5&select=id`)).length === 0, "");
}

async function chatgptStyleClient(C: Student) {
  section("4. A ChatGPT-style MCP client");
  const link = await mintLink(C);
  const init = await rpc(link, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "openai-mcp", version: "1.0.0" } });
  check("an older protocol version is answered in kind", body<{ result: { protocolVersion: string } }>(init).result?.protocolVersion === "2025-03-26", init);
  const unknown = await rpc(link, "initialize", { protocolVersion: "1999-01-01", capabilities: {} });
  check("an unknown version gets Orca's own", body<{ result: { protocolVersion: string } }>(unknown).result?.protocolVersion === "2025-06-18", unknown);
  const note = await api(link, { method: "POST", body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { accept: "application/json, text/event-stream" } });
  check("notifications get 202 and no body", note.status === 202 && note.body === "", note);
  const list = await rpc(link, "tools/list");
  const tools = body<{ result: { tools: Array<{ name: string; description: string; inputSchema: { type: string; properties?: object } }> } }>(list).result?.tools ?? [];
  check("every tool has a name, a description and an object input schema", tools.length >= 14 && tools.every((t) => /^[a-z_]+$/.test(t.name) && t.description.length > 0 && t.inputSchema?.type === "object"), tools.map((t) => t.name));
  check("the tool names are unique", new Set(tools.map((t) => t.name)).size === tools.length, "");
  const batch = await api(link, { method: "POST", body: [{ jsonrpc: "2.0", id: 1, method: "ping" }] });
  check("a JSON-RPC batch is refused as a malformed message (400)", batch.status === 400, batch);
  const unknownMethod = await rpc(link, "resources/list");
  check("an unknown method is a JSON-RPC error, not a crash", unknownMethod.status === 200 && Boolean(body<{ error?: unknown }>(unknownMethod).error), unknownMethod);
  const unknownTool = await tool(link, "delete_everything", {});
  check("an unknown tool is refused", unknownTool.isError, unknownTool.value);
  const empty = await createCourse(C, "Empty course");
  const nothing = await tool(link, "next_questions", { courseId: empty, write: false });
  check("next_questions on a course with nothing says why, never an empty list alone", !nothing.isError && (nothing.value.questions ?? []).length === 0 && typeof (nothing.value.reason ?? nothing.value.pending?.reason) === "string", nothing.value);

  // The link is the only credential, so a leaked one is bounded: 120 calls a minute.
  let limited: Reply | null = null;
  for (let i = 0; i < 125 && !limited; i++) {
    const r = await rpc(link, "ping");
    if (r.status === 429) limited = r;
  }
  check("past 120 calls a minute: 429 with retry-after", limited !== null && Number(limited.headers.get("retry-after")) > 0, limited);
}

async function main() {
  const modelUrl = await startFakeModel();
  APP = await startApp({ modelUrl });
  try {
    const A = await createUser("a");
    const B = await createUser("b");
    const C = await createUser("c");
    const link = await linkLifecycle(A);
    const built = await courseFromTheChat(A, link, modelUrl);
    await anotherStudentsLink(A, B, built.courseId, built.objectiveIds);
    await chatgptStyleClient(C);
  } catch (e) {
    check("the suite ran to the end", false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  } finally {
    await deleteUsers();
    stopChildren();
  }
  report(APP);
}

await main();

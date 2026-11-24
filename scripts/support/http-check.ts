/**
 * Shared pieces for the HTTP checks in scripts/ (check-routes, check-connector): the local stack's
 * keys, a fetch wrapper, throwaway accounts, a `next dev` of the app on a free port, the fake model
 * API, and the ok/FAIL report. Plain Node (relative imports, no `@/`), like the scripts themselves.
 *
 * The app server never gets a real model key: either none at all, or the fake Messages API from
 * e2e/fake-anthropic.ts on a free port.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

function localEnv(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(
    out.split("\n").flatMap((line) => {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      return m ? [[m[1], m[2]]] : [];
    }),
  );
}

const env = process.env.SUPABASE_URL ? process.env : { ...localEnv(), ...process.env };
export const SUPABASE = (env.SUPABASE_URL ?? env.API_URL)!;
export const PUBLISHABLE = (env.SUPABASE_PUBLISHABLE_KEY ?? env.PUBLISHABLE_KEY)!;
export const SECRET = (env.SUPABASE_SECRET_KEY ?? env.SECRET_KEY)!;
if (!SUPABASE || !PUBLISHABLE || !SECRET) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, or start the local stack");

export interface Reply {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface CallOptions {
  method?: string;
  /** A student's access token. */
  token?: string;
  /** Use the secret key (Supabase only). */
  secret?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call(base: string, path: string, opts: CallOptions = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  if (base === SUPABASE) headers.apikey = opts.secret ? SECRET : PUBLISHABLE;
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (opts.secret) headers.Authorization = `Bearer ${SECRET}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/** Supabase REST/Auth/Storage. */
export const db = (path: string, opts: CallOptions = {}) => call(SUPABASE, path, opts);
export const PREFER = { Prefer: "return=representation" };

/** A row the secret key writes, as the server would; throws if refused (it's setup, not a check). */
export async function seed(table: string, row: Record<string, unknown> | Array<Record<string, unknown>>): Promise<void> {
  const r = await db(`/rest/v1/${table}`, { method: "POST", secret: true, body: row });
  if (r.status >= 300) throw new Error(`Setup: couldn't write ${table}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Rows read with the secret key, for checking what a route wrote. */
export async function rows<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const r = await db(`/rest/v1/${path}`, { secret: true });
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`Couldn't read ${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as T[];
}

export interface Student {
  id: string;
  token: string;
}

const made: Student[] = [];

export async function createUser(label: string): Promise<Student> {
  const email = `routes-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const user = await db("/auth/v1/admin/users", { method: "POST", secret: true, body: { email, password, email_confirm: true, user_metadata: { timezone: "UTC" } } });
  if (user.status !== 200) throw new Error(`Couldn't create test user ${label}: ${user.status} ${JSON.stringify(user.body)}`);
  const session = await db("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (session.status !== 200) throw new Error(`Couldn't sign in test user ${label}: ${session.status} ${JSON.stringify(session.body)}`);
  const student = { id: (user.body as { id: string }).id, token: (session.body as { access_token: string }).access_token };
  made.push(student);
  return student;
}

export async function deleteUsers(): Promise<void> {
  for (const u of made.splice(0)) await db(`/auth/v1/admin/users/${u.id}`, { method: "DELETE", secret: true });
}

/** A course the student owns, made through REST under their own session, as the app does. */
export async function createCourse(student: Student, name = "Test course"): Promise<string> {
  const id = randomUUID();
  const r = await db("/rest/v1/courses", { method: "POST", token: student.token, body: { id, slug: `c-${id.slice(0, 8)}`, name, short: name.slice(0, 4), variant: "ald", pos_x: 0, pos_y: 0, review_config: {} } });
  if (r.status !== 201) throw new Error(`Setup: couldn't create a course: ${r.status} ${JSON.stringify(r.body)}`);
  return id;
}

/* ── Child processes: the fake model and the app ── */

const children: ChildProcess[] = [];

export function stopChildren(): void {
  for (const child of children.splice(0)) {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function launch(command: string, args: string[], extraEnv: Record<string, string>): { child: ChildProcess; output: () => string } {
  const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));
  return { child, output: () => output };
}

async function waitFor(what: string, ready: () => Promise<boolean>, child: ChildProcess, output: () => string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${what} exited (${child.exitCode}):\n${output()}`);
    try {
      if (await ready()) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} didn't answer within ${ms / 1000} s:\n${output()}`);
}

/** The fake Messages API (e2e/fake-anthropic.ts) on a free port; returns its base URL. */
export async function startFakeModel(): Promise<string> {
  const port = await freePort();
  const { child, output } = launch("node", ["--experimental-strip-types", "--no-warnings", "e2e/fake-anthropic.ts", String(port)], {});
  const url = `http://127.0.0.1:${port}`;
  await waitFor("The fake model", async () => (await fetch(`${url}/__health`)).ok, child, output, 30_000);
  return url;
}

/** Replace the fake model's scenario (see e2e/fake-anthropic.ts). */
export async function fakeScenario(modelUrl: string, scenario: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${modelUrl}/__scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scenario) });
  if (!r.ok) throw new Error(`The fake model refused the scenario: ${r.status}`);
}

/**
 * The app under test. ORCA_URL uses a server that's already running; otherwise `next dev` on a free
 * port against the stack, with jobs inline and the fake model when `modelUrl` is given (else no model).
 */
export async function startApp(opts: { modelUrl?: string } = {}): Promise<string> {
  if (process.env.ORCA_URL) return process.env.ORCA_URL.replace(/\/$/, "");
  const port = await freePort();
  const model = opts.modelUrl
    ? { ANTHROPIC_API_KEY: "e2e-fake-key", ANTHROPIC_BASE_URL: opts.modelUrl, ORCA_MODEL_PROVIDER: "anthropic" }
    : { ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: "", ORCA_MODEL_PROVIDER: "" };
  const { child, output } = launch("npx", ["next", "dev", "--port", String(port)], {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    SUPABASE_SECRET_KEY: SECRET,
    ...model,
    ORCA_MODEL: "",
    ORCA_READ_MODEL: "",
    ORCA_GRADE_MODEL: "",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    ORCA_JOBS: "inline",
    ORCA_UPLOAD_PIPELINE: "",
    ORCA_DAILY_BUDGET_USD: "",
  });
  const url = `http://localhost:${port}`;
  // The first request compiles the route; a 401 means it's up and asking for a session.
  await waitFor("next dev", async () => (await fetch(`${url}/api/usage`)).status === 401, child, output, 180_000);
  return url;
}

/* ── Report ── */

const results: Array<{ ok: boolean; name: string; detail: string }> = [];

export function check(name: string, ok: boolean, detail: unknown): boolean {
  results.push({ ok, name, detail: typeof detail === "string" ? detail : String(JSON.stringify(detail, (k, v) => (k === "headers" ? undefined : v))).slice(0, 500) });
  return ok;
}

export function section(title: string): void {
  results.push({ ok: true, name: `── ${title}`, detail: "" });
}

/** Print every check and exit 1 if any failed. */
export function report(target: string): never {
  for (const r of results) {
    if (r.name.startsWith("── ")) console.log(`\n${r.name}`);
    else console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  }
  const counted = results.filter((r) => !r.name.startsWith("── "));
  const failed = counted.filter((r) => !r.ok).length;
  console.log(`\n${counted.length - failed} of ${counted.length} checks passed against ${target} and ${SUPABASE}`);
  process.exit(failed ? 1 : 0);
}

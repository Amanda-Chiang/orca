/**
 * Limits (Phase 4 plan, decision 10). Each is checked on the server before any work that costs
 * something; the browser may check them too, but only to say so sooner. The budgets and rate limits
 * live here so there is one place to read what Orca allows; the code that enforces them is in
 * `src/lib/jobs/budget.ts` (decisions), `src/lib/server/usage.ts` (metering and the daily sums),
 * `src/lib/server/rate-limit.ts` (the counters) and `src/lib/llm-server.ts` (bounded calls).
 */
export const LIMITS = {
  /** Largest file a student can upload (the `materials` bucket enforces the same). */
  uploadBytes: 50 * 1024 * 1024,
  /** Most pages (or slides) read from one file. */
  pagesPerFile: 150,
  /** Longest the server spends reading one file (the process route may run 60 s). */
  readMs: 40_000,
  /** A read that started longer ago than this died (its function was stopped): another request may take it over. */
  staleReadingMs: 5 * 60_000,
  /** Longest reflection note and prose answer sent to the model. */
  noteChars: 2000,
  answerChars: 2000,
  /** Longest Notes for Orca, per account and per course (the columns' check says the same). */
  notesChars: 1000,
  /** Longest description of how the student marks confusion in their notes (profiles.marker_notes; the column's check says the same). */
  markerChars: 300,
  /** Weekly class meetings a course's schedule may list. */
  classMeetings: 14,

  /**
   * Pages of material one student may put through the model in one of their days (uploads). 1,000
   * since 2026-11-07 (owner): a Canvas import brings a whole course's decks in one day, and 300 left
   * most of ALD waiting; the token cap below is the backstop.
   */
  pagesPerDay: 1000,
  /** Tokens (input, output and cache) one student's calls may use in one of their days; a cap on pages can't be dodged with dense pages. */
  tokensPerDay: 2_000_000,

  /** Requests per student: a fixed window counted in Postgres (`hit_rate_limit`). */
  rate: {
    /** Matching a reflection note (POST /api/reflect). */
    reflect: { max: 10, windowSeconds: 3600 },
    /** Grading a prose answer (POST /api/grade). */
    grade: { max: 60, windowSeconds: 60 },
    /** Asking for a top-up after a session (POST /api/top-up); each one is a run row and a job. */
    topUp: { max: 30, windowSeconds: 3600 },
    /** "Find connections" on the Atlas (POST /api/relink): one model call over the course's topics. */
    relink: { max: 10, windowSeconds: 3600 },
    /** Importing a Canvas course (POST /api/canvas/import): each run can pull many files. */
    /**
     * Importing a Canvas course (POST /api/canvas/import). The import page calls it up to 10 times in
     * a row for a big course (200 s of pulling each), so the hour must hold a few whole loops; each
     * call only works on the student's own courses, so this bounds cost, not access (2026-11-08).
     */
    canvasImport: { max: 30, windowSeconds: 3600 },
    /** Pasting text or a chat link (POST /api/materials/text): each call stores pages and starts a job (2026-11-08). */
    text: { max: 30, windowSeconds: 3600 },
    /** Adding a website (POST /api/materials/web): an outbound fetch of up to 10 MB and a job per call. */
    web: { max: 20, windowSeconds: 3600 },
    /** Connecting Canvas (POST /api/canvas): a DNS lookup and an outbound request to the site named. */
    canvasConnect: { max: 10, windowSeconds: 3600 },
    /** Listing a Canvas course's files for the picker (GET /api/canvas/courses/:id/files): two outbound calls each. */
    canvasFiles: { max: 60, windowSeconds: 3600 },
    /** A Claude connector call (POST /api/mcp/<token>): the link is the only credential, so a leaked one is bounded (2026-11-08). */
    connector: { max: 120, windowSeconds: 60 },
    /** The browser's "still here" (POST /api/heartbeat): once per 5 minutes per tab; a few tabs fit, a loop doesn't (2026-11-10). */
    heartbeat: { max: 6, windowSeconds: 300 },
    /** Starting or stopping the study timer (POST /api/study-timer, 2026-11-22). */
    timer: { max: 30, windowSeconds: 3600 },
    /** Asking the server to check runs (POST /api/runs/check): pages following a staged run ask once a minute per browser; a few tabs fit, a loop doesn't. */
    runsCheck: { max: 20, windowSeconds: 300 },
    /** A feedback answer or dismissal (POST /api/feedback, 2026-11-25): a few prompts a day; a loop doesn't. */
    feedback: { max: 30, windowSeconds: 3600 },
    /** Making a calendar feed link (POST /api/calendar-feed, 2026-11-25): each replaces the last. */
    calendarFeed: { max: 10, windowSeconds: 3600 },
    /** A Google Docs, Slides or Drive link as material (POST /api/materials/google, 2026-11-25): an outbound fetch of up to 50 MB and a job per call. */
    google: { max: 20, windowSeconds: 3600 },
    /** Connecting Notion (POST /api/notion, 2026-11-25): one outbound request to Notion. */
    notionConnect: { max: 10, windowSeconds: 3600 },
    /** Listing the pages shared with the integration (GET /api/notion/pages). */
    notionPages: { max: 60, windowSeconds: 3600 },
    /** Importing Notion pages (POST /api/notion/import): each page is a few Notion calls and a job. */
    notionImport: { max: 30, windowSeconds: 3600 },
    /** Starting or finishing Google sign-in (GET /api/google/connect, 2026-11-27): one token exchange with Google. */
    googleConnect: { max: 20, windowSeconds: 3600 },
    /** Reading the student's Google Calendar for Orca's calendar page (GET /api/google/calendar/events, 2026-11-28): one call per calendar, each page turn. */
    googleEvents: { max: 300, windowSeconds: 3600 },
    /** A short-lived Drive token for the file picker (POST /api/google/picker-token): one token refresh. */
    googleToken: { max: 60, windowSeconds: 3600 },
  },

  /** A feedback prompt stops asking at a spot after this many dismissals (2026-11-25). */
  feedbackDismissals: 2,

  /** One model call: the longest it may take, and how often a transient failure is retried. */
  modelTimeoutMs: 10 * 60_000,
  modelRetries: 2,
} as const;

export type RateAction = keyof typeof LIMITS.rate;

/**
 * The service-wide ceiling for one UTC day, USD (`ORCA_DAILY_BUDGET_USD`). Past it every new model
 * call waits until tomorrow, for everyone: the backstop against many new accounts (decision 10).
 * Unset means no ceiling, which is only right for local development; production sets it.
 */
export function globalDailyBudgetUsd(): number | null {
  const raw = process.env.ORCA_DAILY_BUDGET_USD;
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`ORCA_DAILY_BUDGET_USD must be a non-negative number of dollars (it is "${raw}")`);
  return n;
}

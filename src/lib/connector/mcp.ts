/**
 * The Claude connector: Orca as an MCP server that Claude calls on its own while a student studies
 * in a chat. Claude does the teaching; Orca holds what the exam covers, which objectives are weak,
 * the question bank, and records the answers Claude grades (as self-marked: half credit, never
 * clearing a mix-up). This module is the protocol and the tool contract, pure: the route gives it
 * a `ConnectorTools` backed by Supabase, the tests a fake one.
 *
 * Protocol: MCP over "Streamable HTTP" (spec 2025-06-18), one JSON-RPC request per POST, answered
 * as JSON. No server-to-client stream (nothing here is long-running), no sessions.
 */

import { SCOPE_STRENGTH } from "../course/scope.ts";
import { MATERIAL_TYPES, type CramBudget, type ExamRules, type ExamScope, type MaterialType, type ProblemType, type ScopeEdit, type ScopeEvidence, type ScopeSignal } from "../data.ts";
import type { ExamMap } from "../course/exam-map.ts";
import { ATTEMPT_OUTCOMES, type ExamReadiness, type ProblemAttempt } from "../course/readiness.ts";
import { BUDGET_DAYS_MAX, HOURS_PER_DAY_MAX, HOUR_STEP, isDay, isHalfHours, type CramBudgetInput } from "../mastery/cram-budget.ts";
import type { CramPlan } from "../mastery/cram-plan.ts";
import type { ErrorType, FlagStrength, Help, SignalEvent, WorkEvent } from "../mastery/types.ts";
import { checkNotes } from "../pipeline/notes.ts";
import type { ScreenHit } from "../untrusted/screen.ts";

export const PROTOCOL_VERSION = "2025-06-18";
const KNOWN_VERSIONS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
export const SERVER_INFO = { name: "orca", version: "0.5" } as const;

/** What Claude is told when it connects: the study session as a script; the tool descriptions do the rest. */
/**
 * The tutor playbook (plan `2026-11-22-tutor-memory-and-exam-map.md`, Phase 4): how to run a sitting,
 * from the corrections the owner made about twenty times across the ALD and Circuit Analysis crams.
 * A student who doesn't know to ask for these gets them anyway. Part of INSTRUCTIONS.
 */
export const PLAYBOOK =
  "HOW TO TUTOR (the student shouldn't have to ask for any of this). " +
  "Time: ask what hours the student really has today and when they stop, and save them (set_exam, " +
  "scope.budget); check the clock with a tool before stating a time or a duration, never estimate one; at " +
  "the stop time, say so and log the sitting. With two days or less to the exam, problems come first and a " +
  "lesson is something to look up when a problem needs it. " +
  "Honesty: never state a guess as a fact; say what you inferred and from what. Say when something is new " +
  "to the student and whether the course expects it, when a step is a teaching scaffold and not how it's " +
  "done in the exam, and when something is optional. Use the exam's rules (scope.rules): no formula sheet " +
  "means the formulas are memorised, and a plan must not assume one. " +
  "Problems: write them at the past exams' difficulty with numbers as clean as the exams'; draw every " +
  "figure in full (every element, switch and label) and name the parts you refer to; state any reference " +
  "direction or convention you chose. Before a multi-part problem, say what each part is worth for the " +
  "exam and which parts are only arithmetic; once the method is clearly right, give the arithmetic's " +
  "result and move on. Check every worked example's arithmetic, and any review sheet against the worked " +
  "examples, before posting. Prefer a set the student can work on paper and have graded in one pass. " +
  "Hints: when the student asks for a hint, give one hint, the smallest that unblocks them, and nothing " +
  "of the answer or of later parts; wait for their next attempt. When they are copying from a solution, " +
  "walk through the reasoning instead. " +
  "Mistakes: read the student's actual line before naming the slip; name the specific slip (which branch, " +
  "which sign, which formula), not just right or wrong, and record it (errorNote). After giving an answer " +
  "key, ask which ones they missed and record those: a key handed over with no report teaches Orca nothing.";

export const INSTRUCTIONS =
  "Orca keeps this student's courses: what each exam covers, every learning objective and how well " +
  "the student can do it, a bank of questions from their course material, and a vault of past and " +
  "practice exams kept for a practice test. Orca stores, counts and schedules; you teach. Run a " +
  "study session like this. 0) Any question about a course is a study session, even with no course named (a " +
  "pasted problem, 'explain this', a why): call course_state (summary) before answering and pick the " +
  "course; with no matching course, answer without Orca and don't ask. Teach, then flag_check the " +
  "objectives touched: asked about means to be checked, not weak; lost, or the same question twice, is a " +
  "miss (log_evidence). After teaching something new or after a miss, offer one next step, a quick check " +
  "from the bank (next_questions for that topic) or a practice problem of that kind (log_problem on a " +
  "mapped exam, else log_evidence), but not mid-problem and not while a cram plan runs, since the plan " +
  "schedules practice. 1) Call course_state first (detail summary for a check-in, full when " +
  "you need objective ids); it says what's due, the next exam's topics (examFocus), the course's " +
  "mode, which exam is being crammed for (cramming), the vault, whether Orca's daily model budget " +
  "is spent (budget) and whether questions are being written (writing). When plan isn't null (an " +
  "exam is being crammed for), start the session by saying plan.line as is, then work through it as a " +
  "queue, one topic at a time, in this order: when plan.diagnostic isn't null, first a sweep (one " +
  "question per topic in plan.diagnostic.topicIds, from next_questions with that topicId and count 1, " +
  "no teaching yet; the misses are the weak spots); when plan.mockToday isn't null, the practice test " +
  "(vault_material with forMock true, given as written and timed at its minutes, then grade it and record each problem with " +
  "log_evidence); then plan.today's topics in order, each taught and checked until it's verified or " +
  "its minutes are used, before the next. Never call the student behind or late: missed time only " +
  "moves topics to plan.cut, which you name as what goes if time runs short. Time with you counts as " +
  "study when you record answers, work or signals. When plan.defaulted is true the student set no time budget and Orca " +
  "assumed 2 hours a study day: say so and ask if it's different (set_exam with scope.budget). When " +
  "the student says how much time they have today or on a named day, save it with " +
  "set_exam (scope.budget.today for today, or perDay for the days named; leave objectives and " +
  "sources out to keep the scope) and read back the new plan.line from course_state. plan.days is " +
  "the schedule (each day's topics and minutes, and each topic's covered state in plan.topics): when " +
  "the student asks what's on which day, read it rather than inventing one. On " +
  "the eve (mode day-of, or plan.daysLeft is 1 or less), mention " +
  "topErrors: the kinds of mistake the student makes most. Follow mode: normal, a " +
  "short review of what's due; exam-week, work through the exam's scope, heaviest first; day-of, a " +
  "quick pass over what's weak and nothing new. 2) Exam map first: before planning or teaching for an " +
  "exam, ask for EVERY past and practice exam the student has (add_material holds them back) and for " +
  "the exam's rules (closed book? formula sheet? calculator? how long? how it's graded), and store the " +
  "rules as scope.rules. With two or more exams in the vault, agree which one to reserve " +
  "(scope.reservedMaterialId) so one timed score survives. Read the others with vault_material, then " +
  "record what kinds of problem they ask as scope.problemTypes, each with the objectives it uses and " +
  "the exams it's on. Plan from that map: teach the types that recur across exams first, at the " +
  "exams' difficulty, and say so when scopeSummary.examMap.uncertain is true (fewer than three exams " +
  "read: a type on none of them can still appear). An exam with a vault but no problemTypes hasn't " +
  "been mapped: do that before anything else. Attachments: Orca never sees a file or text the " +
  "student gives you in the chat. When they attach or paste course material (slides, notes, a " +
  "syllabus, homework, an exam), ask once whether to add it to Orca, and on a yes call add_material: " +
  "the text when you can read all of it, else file true for an upload link; a past or practice exam " +
  "held back. Never add it unasked, and don't ask again about the same file. Setup: when an exam is near and has no scope, " +
  "ask what the professor said it covers, whether there's a practice exam or study guide " +
  "(add_material: pasted text, or file true for an upload link; past and practice exams are held " +
  "back), and what the student is worried about (flag_check with strength struggled); then record " +
  "the scope with set_exam (cramming true when they're cramming). When an exam's scope has worries " +
  "(what the student said feels shaky at cram setup, in their words), match them to objectives at the " +
  "start of the first session, flag those with flag_check (strength struggled) and tell the student " +
  "which ones you'll start with; with no worries, check first and let the misses find the weak spots. When the student names which " +
  "lectures or files the exam covers, map them to the course's materials by filename (course_state " +
  "detail full lists materials, and each objective's materialIds) and record the scope with weight 0 " +
  "for objectives taught only elsewhere (evidence professor, quote \"not in the files the exam " +
  "covers\"), passing scope.materialIds; an objective no file teaches, or a weak spot, follows its topic (in " +
  "scope when the topic is), and Orca keeps it in. To turn a few objectives on or off, send just those with " +
  "scope.patchObjectives true. To change an exam's scope or budget, leave its date out. Call set_exam too when the " +
  "student says what an exam covers or when it's cancelled. 3) Check first: before explaining, ask " +
  "one question at a time from next_questions (it picks what's due, then exam focus, then the " +
  "heaviest unflagged objectives; pass objectiveIds or topicIds to steer it). Before revealing an " +
  "answer, ask how sure they are (confidence 1 to 3). 4) Send the student's answer, in their words, " +
  "to check_answer with their confidence and the help you gave: Orca grades it, records it and " +
  "returns the key and explanation; teach from those, then go to the next question. If " +
  "check_answer says needsSelfGrade (always for prose in a cram: Orca makes no model calls then), " +
  "grade against the key it returns and call record_answer, " +
  "reporting help: none, hint, or shown when you revealed the answer first. Never record an answer " +
  "the student didn't give. 5) Call material_for before teaching an objective or writing questions, " +
  "so you teach what the course teaches, in its notation. When the bank is thin, budget.ok is " +
  "false, or the course is in a cram (mode isn't normal: Orca writes no questions then), write " +
  "questions yourself with add_questions, anchored to material_for's pieces; when material_for " +
  "returns no pieces for an objective, write from general knowledge without an anchor and tell the " +
  "student the question isn't from their material. Then " +
  "grade them against the key you stored and report help. Record a problem you set and judged, or " +
  "what the student did (got-it, lost, asked-answer, asked-harder), with log_evidence. 6) When " +
  "next_questions returns pending, Orca is writing questions: teach from the material meanwhile " +
  "and ask again after retryAfterSeconds, or write them yourself. When budget.ok is false, say so: " +
  "Orca can't write or grade prose until it resets (resetsAt). 7) The vault is hidden from the " +
  "student, not from you: read every held-back exam with vault_material to plan, but never show, " +
  "quote or walk through its problems or solutions; write your own problems of the same kinds. The " +
  "reserved exam (vault[].reserved) you don't read either until the student sits it timed. 8) Call flag_check " +
  "only for objectives the student asked about or got wrong in this chat. 9) Every few answers, " +
  "send a one-line progress note unasked: what's verified, what's still weak, what's next. 10) The " +
  "session record: when course_state has a lastSession, open by saying where the student stopped " +
  "(its bookmark) and offering its next steps in order, before anything else. When a sitting ends or " +
  "pauses, call log_session with the minutes actually spent (check the clock; never guess), what you " +
  "worked on and how each went (with the specific slip, not just right or wrong), the bookmark and " +
  "the ordered next steps. Homework, lessons and drills count: without it Orca shows no time studied " +
  "and the next chat starts blind. 11) Readiness is measured by problems, not recall: once the exam " +
  "has a map (problemTypes), the plan's units are its kinds of problem and readiness says which the " +
  "student is ready for. The diagnostic (plan.diagnostic) is then one cold exam-style problem per kind: " +
  "your own problem of that kind, at the past exams' difficulty with clean numbers, no hints, timed; log " +
  "each with log_problem (cold true). Teach the kinds that aren't ready, most recurrent first; after " +
  "teaching one, re-test it cold with a fresh problem and log that too. Don't say the student is ready " +
  "from recall questions or from a walk-through. When the reserved exam is sat (plan.mockToday), log each " +
  "of its problems with mockMaterialId, points and outOf: readiness.measured is their real score. " +
  PLAYBOOK;

/** An exam scope as set_exam takes it: the budget is an input merged over the exam's (src/lib/mastery/cram-budget.ts `mergeBudget`), and `objectives` and `sources` left out keep the exam's. */
/** `reservedMaterialId` null clears the reservation. */
export type ScopeInput = Omit<ExamScope, "budget" | "objectives" | "sources" | "reservedMaterialId"> & { objectives?: ExamScope["objectives"]; sources?: ScopeSignal[]; budget?: CramBudgetInput; patchObjectives?: boolean; reservedMaterialId?: string | null };
export type { CramBudgetInput };

/* ── Tool results: plain data the implementations return; the protocol wraps them ── */

export interface CourseSummary {
  id: string;
  name: string;
}

export interface ObjectiveLine {
  id: string;
  topicId: string;
  topic: string;
  name: string;
  /** Orca's derived status: unseen (not flagged), verified, check-due, learning, mixed-up, mastered, fading, retired. */
  status: string;
  /** Predicted chance of recalling it now, 0–1, or null before any answer. */
  recall: number | null;
  /** How many questions Orca has for it (0: it can't be checked until some are written). */
  questions: number;
  /** The materials it's taught in (the one that created it and the ones its signals name), among course_state's materials. */
  materialIds: string[];
}

/** The course's footing: day-of when an exam is today; exam-week when an exam is cramming or within 7 days; else normal. */
export type CourseMode = "normal" | "exam-week" | "day-of";

export interface ExamLine {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** Topic ids it covers; empty means the whole course. */
  topicIds: string[];
  /** The student is cramming for it (the exam window applies whatever the date). */
  cramming: boolean;
  /** Per-objective weights inside the window and where they came from; null = no scope beyond topicIds. Left out with detail summary (scopeSummary says its size). */
  scope?: ExamScope | null;
  /** With detail summary: the scope's size instead of its entries; null without a scope. */
  scopeSummary?: ScopeSummary | null;
  /** The mode this exam puts the course in: day-of today, exam-week while cramming or within 7 days, else normal. */
  mode: CourseMode;
  /** From set_exam: what Orca changed in what was sent, and why. */
  note?: string;
}

/** An exam's scope by its counts (course_state detail summary): over the live objectives of the exam's topics, as the exam card counts them. */
export interface ScopeSummary {
  /** Objectives weighing more than 0 (unlisted ones weigh 1). */
  inScope: number;
  /** Objectives the scope excludes (weight 0). */
  excluded: number;
  sources: ScopeSignal[];
  budget?: CramBudget;
  /** What the student said feels shaky at cram setup, in their words. */
  worries?: string;
  rules?: ExamRules;
  /** The exam map: problem types by how many of the mapped past exams ask them; absent until you write scope.problemTypes. */
  examMap?: ExamMap;
  reservedMaterialId?: string;
  /** The last five edits to the scope or budget, and who made them (the student in the app, or you). */
  history?: ScopeEdit[];
}

/** A material of the course (not removed), so Claude can map "lectures 11 to 16" to files. */
export interface MaterialLine {
  id: string;
  filename: string;
  type: MaterialType;
  /** Kept for a practice test: never opened, never used to write questions. */
  heldBack: boolean;
}

/** A held-back material (a past or practice exam kept for a practice test): listed by name only, never opened. */
export interface VaultLine {
  materialId: string;
  filename: string;
  type: MaterialType;
  /** Kept unread, even by you, until the student sits it timed (an exam's scope.reservedMaterialId). */
  reserved: boolean;
}

/** A held-back exam's pages, for the tutor's planning only. */
export interface VaultMaterial {
  materialId: string;
  filename: string;
  type: MaterialType;
  pages: Array<{ n: number; text: string }>;
  /** The page to ask for next (`fromPage`) when the file has more; absent at the end. */
  nextPage?: number;
  totalPages: number;
  doNotReveal: true;
  note: string;
}

export interface TopicLine {
  id: string;
  name: string;
  /** Live objectives in the topic. */
  objectives: number;
  /** Of those, weak points (in rotation) or open checks. */
  weak: number;
  /** Of those, with at least one question Orca can ask. */
  askable: number;
}

/** Whether Orca's model can be called for this student right now (the daily budget, src/lib/jobs/budget.ts). */
export interface BudgetLine {
  ok: boolean;
  /** Why not, when it isn't. */
  reason?: string;
  /** When the student's day (and the budget) resets, ISO. */
  resetsAt: string;
}

/** A question-writing job in flight for the course. */
export interface WritingLine {
  runId: string;
  objectiveIds: string[];
  state: "queued" | "waiting" | "running";
}

/** How much of the scoping exam's scope is verified: over objectives in scope (weight > 0), and per topic. */
export interface CoverageLine {
  verified: number;
  total: number;
  share: number;
  byTopic: Array<{ topicId: string; verified: number; total: number }>;
}

/** A kind of mistake and how often the student made it (answer and work events' errorType). */
export interface TopError {
  errorType: ErrorType;
  count: number;
}

export interface CourseState {
  course: CourseSummary;
  /** The student's day, YYYY-MM-DD, in their timezone. */
  today: string;
  exams: ExamLine[];
  topics: TopicLine[];
  /** Every live objective (detail "full"); left out for "summary". */
  objectives?: ObjectiveLine[];
  /** The course's materials, not removed (detail "full"); left out for "summary". */
  materials?: MaterialLine[];
  /** Objective ids Orca would have the student work on now, most urgent first. */
  dueNow: string[];
  /** Topic ids an exam within the next week covers (every topic when it names none). */
  examFocus: string[];
  budget: BudgetLine;
  writing: WritingLine[];
  /** Held-back materials, by name only. */
  vault: VaultLine[];
  mode: CourseMode;
  /** The exam being crammed for, or null. */
  cramming: string | null;
  /** The cram plan over the cramming exam (src/lib/mastery/cram-plan.ts); null when no exam is cramming. Without a budget it's computed from an assumed one (2 hours a study day) and says `defaulted`. */
  plan: CramPlan | null;
  /** Coverage of the scoping exam's scope (the cramming exam, else the soonest within the window); null outside every window. */
  coverage: CoverageLine | null;
  /** The kinds of mistake since the cram started (else the last 30 days), most frequent first, at most 6. */
  topErrors: TopError[];
  /**
   * Readiness per kind of problem, for the exam being crammed for (else the soonest with a map), from
   * the exam-style problems attempted (log_problem): null until the exam has problemTypes. Only a cold
   * solve says ready. `measured` is the reserved exam's score once it's sat.
   */
  readiness: ExamReadiness | null;
  /** The last sitting logged with log_session: where the student stopped and what comes next. Null before any. Start from it. */
  lastSession: SessionLine | null;
}

/** One thing worked in a sitting. */
export interface SessionWork {
  /** What it was: "HW08 E8 to E12", "Drill 2: RLC damping", "Lesson 7: values that jump". */
  what: string;
  outcome?: (typeof SESSION_OUTCOMES)[number];
  /** The specific slip, in words: "flipped the divider fraction", "used ω₀ where ω_d was asked". */
  errorNote?: string;
  objectiveIds?: string[];
  /** A problem type's id from the exam map (scope.problemTypes). */
  problemTypeId?: string;
}

/** A sitting as log_session takes it. */
export interface SessionEntry {
  minutes: number;
  summary: string;
  worked: SessionWork[];
  bookmark?: string;
  next?: string[];
  examId?: string;
}

/** A logged sitting. */
export interface SessionLine {
  id: string;
  at: string;
  /** The student's day it counts on, YYYY-MM-DD. */
  day: string;
  minutes: number;
  summary: string;
  worked: SessionWork[];
  bookmark: string | null;
  next: string[];
}

/** How a piece of work went: alone, with hints, after being shown, or not finished. */
export const SESSION_OUTCOMES = ["solved", "with-hints", "shown", "stuck"] as const;

/** What next_questions answers: questions to ask, or why there are none yet. */
export interface NextQuestions {
  questions: QuestionLine[];
  /** Questions are being written (started now, or already in flight): ask again after retryAfterSeconds. */
  pending?: { runId: string | null; objectiveIds: string[]; state: "started" | "queued" | "waiting" | "busy"; retryAfterSeconds: number; reason: string };
  /** Why the list is empty, when it is and nothing is pending. */
  reason?: string;
}

/** A question as Claude asks it: no key (Orca grades through check_answer, which returns the key afterwards). */
export interface QuestionLine {
  id: string;
  objectiveId: string;
  kind: "Multiple choice" | "True or false" | "Short answer";
  prompt: string;
  /** Choices for a choice question, in the order to show them; empty for short answer. */
  options: string[];
  /** Where in the course material it's grounded, when it is. */
  anchor?: { locator: string; excerpt: string };
}

export type Outcome = "correct" | "partial" | "incorrect";

export interface Rubric {
  requiredIdeas: string[];
  acceptableAlternatives: string[];
  knownMisconceptions: Array<{ description: string; indicativePhrasing: string[] }>;
}

/** The key, returned once an answer is checked (or when Orca can't check it). */
export interface AnswerKey {
  /** The right answer as text: the right option, the first accepted exact form, or the ideas a full prose answer needs. */
  answer: string;
  /** Every accepted spelling of an exact answer. */
  exact?: string[];
  /** How a prose answer is judged. */
  rubric?: Rubric;
  explanation: string;
}

/** An answer Orca graded and recorded (full credit, with Orca's own grader). */
export interface CheckedAnswer extends AnswerKey {
  recorded: true;
  outcome: Outcome;
  grader: "choice" | "exact" | "rubric";
  feedback: string;
  /** The kind of mistake the rubric grader named, from the fixed list; null for choice and exact answers, or when none fits. */
  errorType: ErrorType | null;
  objectiveId: string;
  /** The objective's status after the answer. */
  status: string;
  note?: string;
}

/** Orca couldn't grade a prose answer now (no model, the day's budget, a rate limit, grading off), or won't during a cram (no model calls then): Claude grades against the key and calls record_answer. */
export interface SelfGradeNeeded extends AnswerKey {
  needsSelfGrade: true;
  reason: string;
}

export interface RecordedAnswer {
  recorded: boolean;
  objectiveId: string;
  /** The objective's status after the answer. */
  status: string;
  /** The stored key for a choice or exact question disagreed with the outcome sent: Orca's result was recorded instead. */
  corrected?: true;
  note?: string;
}

/** What Claude reports with an answer it graded: how much help it gave, the student's confidence and the kind of mistake. */
export interface AnswerReport {
  help: Help;
  confidence?: 1 | 2 | 3;
  errorType?: ErrorType;
}

/** What material_for returns: each objective's anchored pages (never from a held-back or removed material). */
export interface MaterialFor {
  objectives: Array<{ objectiveId: string; pieces: Array<{ materialId: string; filename: string; page: number; text: string }> }>;
  /** Held-back materials skipped. */
  heldBack: number;
}

/** A question Claude wrote, validated like a generated one and stored with source claude. */
export interface AddQuestion {
  objectiveId: string;
  kind: "Multiple choice" | "True or false" | "Short answer";
  prompt: string;
  /** Choices for a choice question; empty or absent for short answer. */
  options?: string[];
  /** Index into options for a choice question. */
  answer?: number;
  /** Short answer with an exact form: every accepted spelling. */
  exact?: string[];
  /** Short answer graded in prose. */
  rubric?: Rubric;
  explanation: string;
  /** Where in the material it comes from; materialId (a live material) becomes the question's. */
  anchor?: { locator: string; excerpt: string; materialId?: string };
}

export interface AddQuestionsResult {
  /** `note` only on a question stored without an anchor because no live material teaches its objective. */
  added: Array<{ id: string; objectiveId: string; note?: string }>;
  /** Questions not stored, by their position in the list, and why. */
  refused: Array<{ index: number; reason: string }>;
}

/** What add_material takes: pasted text, or a request for an upload link. */
export interface AddMaterialInput {
  type: MaterialType;
  text?: string;
  filename?: string;
  holdBack: boolean;
  file?: true;
}

/** With text: the text route's result. With file: an absolute link to the add-material page with the type and hold-back preset. */
export type AddMaterialResult = { material: { id: string; filename: string; type: MaterialType; heldBack: boolean } } | { duplicate: { id: string; filename: string } } | { uploadLink: string };

/** A piece of work Claude set and judged, or what the student did, as log_evidence takes it. */
export type EvidenceEntry =
  | { kind: "work"; problem: string; response?: string; basis: WorkEvent["basis"]; outcome: Outcome; help?: Help; confidence?: 1 | 2 | 3; errorType?: ErrorType }
  | { kind: "signal"; signal: SignalEvent["signal"]; note?: string };

export interface LoggedEvidence {
  recorded: true;
  objectiveId: string;
  /** The objective's status after the event. */
  status: string;
}

export interface FlagCheckResult {
  /** The objectives flagged (each a live objective of the course), with their status after the flag. */
  flagged: Array<{ objectiveId: string; status: string }>;
  /** Ids that aren't live objectives of this course: nothing was recorded for them. */
  unknown: string[];
  /** Flagged objectives with no questions yet. */
  withoutQuestions: string[];
  note?: string;
}

/** What the route implements against the student's data. Every method is scoped to one student. */
export interface ConnectorTools {
  courses(): Promise<CourseSummary[]>;
  /** The course in full, or a summary without the objective lines (or only some topics' objectives). Null: no such course. */
  courseState(courseId: string, options?: { detail?: "summary" | "weak" | "full"; topicIds?: string[]; asOf?: string }): Promise<CourseState | null>;
  /** The next questions to ask (unanswered first, then least recently seen), writing some when none exist. Null: no such course. */
  nextQuestions(courseId: string, options: { objectiveIds?: string[]; topicIds?: string[]; count: number; write: boolean }): Promise<NextQuestions | null>;
  /** Remove an exam. */
  removeExam(courseId: string, examId: string): Promise<{ removed: true } | { error: string }>;
  /** The questions, and which of the objectives asked for have none (deep-review questions don't count). Null: no such course. */
  questionsFor(courseId: string, objectiveIds: string[] | null, limit: number): Promise<{ questions: QuestionLine[]; withoutQuestions: string[] } | null>;
  /** Grade the student's answer with Orca's own graders and record it (full credit); or say Orca can't right now and hand over the key. `response` arrives cleaned. `report`: the help given and the student's confidence, when Claude says. */
  checkAnswer(courseId: string, questionId: string, response: string, sessionId: string, report?: Partial<AnswerReport>): Promise<CheckedAnswer | SelfGradeNeeded | { error: string }>;
  /** An answer Claude graded against the key: recorded with the help it reports (none = full credit). `response`, when given, is the student's words, cleaned and screened. */
  recordAnswer(courseId: string, questionId: string, outcome: Outcome, sessionId: string, response: string | undefined, report: AnswerReport): Promise<RecordedAnswer | { error: string }>;
  setExam(courseId: string, exam: { id?: string; title?: string; date?: string; topicIds?: string[]; cramming?: boolean; scope?: ScopeInput }): Promise<ExamLine | { error: string }>;
  /** One flag per known live objective: check (source connector) or struggled (source connector-struggled). `said` arrives cleaned and screened. */
  flagCheck(courseId: string, objectiveIds: string[], said: string, strength: FlagStrength): Promise<FlagCheckResult | { error: string }>;
  /** The anchored pages of some objectives, never from a held-back or removed material. Null: no such course. */
  materialFor(courseId: string, objectiveIds: string[]): Promise<MaterialFor | null>;
  /** A held-back exam's pages for planning (never the reserved one unless `forMock`); an error when it isn't in the vault. */
  vaultMaterial(courseId: string, materialId: string, options: { fromPage?: number; forMock?: boolean }): Promise<VaultMaterial | { error: string }>;
  /** Store questions Claude wrote (validated like generated ones, source claude). */
  addQuestions(courseId: string, questions: AddQuestion[]): Promise<AddQuestionsResult | { error: string }>;
  /** Add pasted text as material, or hand back a link to upload a file. */
  addMaterial(courseId: string, input: AddMaterialInput): Promise<AddMaterialResult | { error: string }>;
  /** Record a piece of work or a signal on one objective. Free text (`problem`, `response`, `note`) arrives cleaned and screened. */
  logEvidence(courseId: string, objectiveId: string, entry: EvidenceEntry, sessionId: string): Promise<LoggedEvidence | { error: string }>;
  /** Record an exam-style problem the student attempted, for a problem type on an exam's map; returns the type's readiness after it. */
  logProblem(courseId: string, examId: string, attempt: Omit<ProblemAttempt, "at">): Promise<{ recorded: true; typeId: string; state: string; ready: number; total: number } | { error: string }>;
  /** Store a sitting: its minutes count as study on the student's day, and its bookmark and next steps open the next chat. */
  logSession(courseId: string, entry: SessionEntry): Promise<SessionLine | { error: string }>;
  /** Log the screen's hits on what the student said (refused or not). */
  screened(hits: ScreenHit[]): Promise<void>;
}

/* ── Tool list, as Claude sees it ── */

const UUID = { type: "string", description: "An id from course_state." };
const HELPS = ["none", "hint", "shown"] as const satisfies readonly Help[];
const ERROR_TYPES = ["arithmetic", "units", "sign", "misread", "notation", "concept"] as const satisfies readonly ErrorType[];
const BASES = ["official-solution", "known-answer", "claude"] as const satisfies readonly WorkEvent["basis"][];
const SIGNALS = ["got-it", "lost", "asked-answer", "asked-harder"] as const satisfies readonly SignalEvent["signal"][];
const SCOPE_SIGNALS = ["practice-exam", "professor", "study-guide", "homework", "lecture-emphasis", "guess"] as const satisfies readonly ScopeSignal[];
const SCOPE_KINDS = ["Multiple choice", "True or false", "Short answer", "Problem"] as const;
const RULE_NOTES = ["none", "sheet", "open"] as const;
const RULE_CALCULATORS = ["none", "simple", "any"] as const;
/** The most problem types an exam map holds. */
const PROBLEM_TYPES_MAX = 40;
type ScopeKind = (typeof SCOPE_KINDS)[number];
const QUESTION_KINDS = ["Multiple choice", "True or false", "Short answer"] as const;
/** The same bounds as a generated question (src/lib/pipeline/schemas.ts). */
const SHORT_CHARS = 240;
const TEXT_CHARS = 1200;
/** A problem as the student saw it (evidence_events.problem). */
const PROBLEM_CHARS = 4000;
/** Pasted material, as the text route takes it. */
/** A scope quote: the words a weight rests on. */
const QUOTE_CHARS = 500;
const BUDGET_HOURS_MAX = 1000;
const BUDGET_DAYS_OUT_MAX = BUDGET_DAYS_MAX;
const MATERIALS_MAX = 200;

export const TOOLS = [
  {
    name: "course_state",
    description:
      "The student's courses, or one course in full: its exams and what each covers, its topics, every " +
      "learning objective with Orca's status for it (unseen = not flagged, verified, check-due, learning, " +
      "mixed-up, mastered, fading, retired) and predicted recall, and which objectives are due now. Orca " +
      "only schedules weak points: objectives the student struggled with, missed or asked to be checked " +
      "on. Call this first, also when the student only pastes a problem or asks for an explanation: it says " +
      "which course it belongs to. check_answer and record_answer already return each objective's new status, so " +
      "there's no need to call it after every answer; detail summary is a cheap check-in (topics with " +
      "counts, each exam's scope by its size, what's due, exam focus, budget, what's being written), full " +
      "lists every objective with the materials it's taught in, the course's materials and each exam's full scope. While an " +
      "exam is being crammed for, plan holds the day's plan (plan.line is the one-line summary to say), " +
      "coverage how much of the exam's scope is verified, and topErrors the kinds of mistake made most. " +
      "With no course, lists the courses so you can pick one.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: { ...UUID, description: "The course to describe. Omit to list the courses." },
        detail: { type: "string", enum: ["summary", "weak", "full"], description: "summary: no objective or material lines, exams' scopes by size; weak: the summary plus only the weak-spot objectives (the cheap view for a session: use it unless you need every objective id); full (default): every objective, the materials, full scopes." },
        topicIds: { type: "array", items: { type: "string" }, description: "With full: only these topics' objectives." },
        asOf: { type: "string", description: "Testing only: YYYY-MM-DD, within 60 days of today. The exams, mode and cram plan are worked out as if today were that day (statuses and recall stay as of now); nothing is written. Use it to check how a cram plays out on later days instead of editing a real exam's date." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "next_questions",
    description:
      "The next questions to ask, picked by Orca: what's due now, then the next exam's topics, then the " +
      "heaviest objectives nobody has flagged; within an objective, questions the student hasn't seen first. " +
      "Pass objectiveIds or topicIds to steer it. Ask one at a time and send each answer to check_answer. " +
      "When nothing askable exists, Orca writes questions (write true, the default) and answers pending: " +
      "teach from the material and ask again after retryAfterSeconds. In a cram (mode isn't normal) Orca " +
      "writes none: write them with add_questions. The reply always says why when it's empty.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, maxItems: 20, description: "Objectives to draw from." },
        topicIds: { type: "array", items: { type: "string" }, maxItems: 20, description: "Topics to draw from (ignored when objectiveIds is given)." },
        count: { type: "integer", minimum: 1, maximum: 5, description: "How many (default 1)." },
        write: { type: "boolean", description: "Write questions when none exist (default true)." },
      },
      required: ["courseId"],
      additionalProperties: false,
    },
  },
  {
    name: "set_exam",
    description:
      "Record an exam and what it covers: its date and the topic ids it tests (empty for the whole " +
      "course). Use it when the student says what's on an exam, from the professor, the syllabus or a " +
      "classmate. Pass an existing exam's id to change it, or with remove true to delete it (a cancelled " +
      "exam). Orca schedules reviews from this.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        examId: { ...UUID, description: "An existing exam to change or remove; omit to add one." },
        title: { type: "string", description: "What the student calls it, e.g. Midterm, Final. With examId, omit to keep it." },
        date: { type: "string", description: "YYYY-MM-DD. With examId, omit to keep the exam's date (don't resend it just to change the scope or budget)." },
        topicIds: { type: "array", items: { type: "string" }, description: "Topic ids it covers; empty for every topic. With examId, omit to keep them." },
        cramming: { type: "boolean", description: "The student is cramming for it: Orca treats it as this week's exam whatever the date. Omit to leave as is." },
        scope: {
          type: "object",
          description: "What the exam weighs, from the practice exam, the professor's words, a study guide, homework, lecture emphasis or a guess. Omit to leave as is; omit objectives and sources together (keeping the exam's) to change only the budget.",
          properties: {
            objectives: {
              type: "array",
              maxItems: 400,
              description: "Per-objective weight inside the exam window; 0 = excluded. Objectives not listed weigh 1.",
              items: {
                type: "object",
                properties: {
                  objectiveId: UUID,
                  weight: { type: "number", minimum: 0, maximum: 10 },
                  evidence: {
                    type: "array",
                    maxItems: 8,
                    items: {
                      type: "object",
                      properties: {
                        signal: { type: "string", enum: SCOPE_SIGNALS },
                        quote: { type: "string", maxLength: QUOTE_CHARS, description: "The words it rests on, e.g. what the professor said (at most 500 characters)." },
                        materialId: { ...UUID, description: "The material it comes from, when one does." },
                      },
                      required: ["signal"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["objectiveId", "weight", "evidence"],
                additionalProperties: false,
              },
            },
            format: {
              type: "object",
              properties: {
                minutes: { type: "integer", minimum: 1, maximum: 600 },
                problems: { type: "integer", minimum: 1, maximum: 200 },
                kinds: { type: "array", items: { type: "string", enum: SCOPE_KINDS }, maxItems: 4 },
              },
              additionalProperties: false,
            },
            sources: { type: "array", items: { type: "string", enum: SCOPE_SIGNALS }, maxItems: 6, description: "Where the scope came from, for the exam card." },
            rules: {
              type: "object",
              description: "The exam's rules, from the syllabus or the professor. Ask for them at setup: they change how to study (no formula sheet means the formulas are memorised).",
              properties: {
                notes: { type: "string", enum: RULE_NOTES, description: "none: closed book; sheet: a formula sheet; open: open book." },
                calculator: { type: "string", enum: RULE_CALCULATORS },
                minutes: { type: "integer", minimum: 1, maximum: 600, description: "How long the exam runs." },
                text: { type: "string", maxLength: QUOTE_CHARS, description: "Anything else, in the syllabus's or professor's words (how it's graded, what's given)." },
              },
              additionalProperties: false,
            },
            problemTypes: {
              type: "array",
              maxItems: PROBLEM_TYPES_MAX,
              description: "The exam map: the kinds of problem the past exams ask, from the exams you read with vault_material. Replaces the list, so send every type each time. Plan the cram from it: what recurs across exams is what to teach first.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "A short slug you choose and keep, e.g. charge-sharing." },
                  name: { type: "string", description: "What the problem asks, e.g. Charge sharing between two capacitors." },
                  objectiveIds: { type: "array", items: UUID, maxItems: 40, description: "The objectives a problem of this kind uses (empty when none fits)." },
                  materialIds: { type: "array", items: UUID, description: "The past or practice exams it appears on (material ids)." },
                  note: { type: "string", maxLength: QUOTE_CHARS, description: "What it asks for and where points are lost; no problem text from a held-back exam." },
                },
                required: ["id", "name", "objectiveIds", "materialIds"],
                additionalProperties: false,
              },
            },
            reservedMaterialId: { type: ["string", "null"], description: "The one held-back exam to keep unread, even by you, until the student sits it timed (their measured score). With two or more past exams, reserve one before reading the rest; null clears it." },
            patchObjectives: { type: "boolean", description: "true: objectives lists only the ones to change; each replaces that objective's entry and every other objective keeps its weight (sources optional, added to the exam's). Use it to turn a few objectives on or off without resending the whole list." },
            budget: {
              type: "object",
              description:
                "The student's time budget for the cram, hours per day; the plan is derived from it. Merged over the budget the exam has " +
                "(none yet: 2 hours a study day): perDay replaces the days it names, today sets today only, hours without perDay is a total " +
                "spread evenly over the days not out. Omit to keep what the exam has.",
              properties: {
                perDay: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: HOURS_PER_DAY_MAX }, description: `Hours by day, YYYY-MM-DD, in steps of ${HOUR_STEP}; 0 for a day off. At most ${BUDGET_DAYS_MAX} days.` },
                today: { type: "number", minimum: 0, maximum: HOURS_PER_DAY_MAX, description: `Hours for today only, in steps of ${HOUR_STEP}: "I have until 7".` },
                hours: { type: "number", minimum: 0, maximum: BUDGET_HOURS_MAX, description: "A total before the exam, spread evenly over the days not out (the older form; use perDay when days differ)." },
                daysOut: { type: "array", items: { type: "string" }, maxItems: BUDGET_DAYS_OUT_MAX, description: "Days with no study, YYYY-MM-DD (0 hours each)." },
                since: { type: "string", description: "When cramming started, ISO: minutes studied since then count against the budget. Omit to keep the exam's (now for a new budget)." },
              },
              additionalProperties: false,
            },
            materialIds: { type: "array", items: UUID, maxItems: MATERIALS_MAX, description: "The materials the exam covers (ids from course_state's materials), when the student named files or lectures; objectives taught only elsewhere weigh 0." },
          },
          additionalProperties: false,
        },
        remove: { type: "boolean", description: "With examId: remove the exam instead." },
      },
      required: ["courseId"],
      additionalProperties: false,
    },
  },
  {
    name: "questions_for",
    description:
      "Questions from Orca's bank to check the student with, each with its objective. They come without " +
      "their keys: ask one, then send the student's answer to check_answer, which grades it, records it and " +
      "returns the key and explanation. For a choice question, show the options in the order given. Leave " +
      "objectiveIds out to get questions for what's due now (only weak points are ever due; pass " +
      "objectiveIds to practise others).",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, description: "Objectives to draw from; omit for what's due now." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "How many at most (default 5)." },
      },
      required: ["courseId"],
      additionalProperties: false,
    },
  },
  {
    name: "check_answer",
    description:
      "Send the student's answer to one of Orca's questions, in their own words, and Orca grades and " +
      "records it: a choice question by the option they picked (its number as shown, 1 to 4, its letter, " +
      "or its text), a short answer by exact match or, for a prose answer, by Orca's grader against the " +
      "question's rubric. The reply carries the outcome, feedback, the key and the explanation: teach from " +
      "those. If it says needsSelfGrade, Orca couldn't grade it now (or won't: it grades no prose during a cram); " +
      "grade against the key yourself and call record_answer. 'I don't know' is an answer too: send it.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questionId: { ...UUID, description: "The question's id from questions_for." },
        response: { type: "string", maxLength: 2000, description: "The student's answer, as they gave it (at most 2000 characters)." },
        confidence: { type: "integer", minimum: 1, maximum: 3, description: "How sure the student said they were before the answer was revealed: 1 (guessing) to 3 (sure)." },
        help: { type: "string", enum: HELPS, description: "How much help you gave before the answer: none (default), hint, or shown (you revealed the answer first)." },
      },
      required: ["courseId", "questionId", "response"],
      additionalProperties: false,
    },
  },
  {
    name: "record_answer",
    description:
      "Record one answer you graded yourself against the key: correct, partial or incorrect, with how much " +
      "help you gave (help: none = full credit, hint = half credit, shown = you revealed the answer first, so it " +
      "counts as a miss). Use it after check_answer said needsSelfGrade, or for a question you graded during a " +
      "cram. Orca derives the objective's new status; for a choice or exact question Orca checks the stored key " +
      "and its result wins (corrected). Pass the student's words too, so Orca can look at the grading later, " +
      "their confidence before the reveal, and the kind of mistake. 'I don't know' is incorrect.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questionId: { ...UUID, description: "The question's id from questions_for." },
        outcome: { type: "string", enum: ["correct", "partial", "incorrect"] },
        response: { type: "string", maxLength: 2000, description: "The student's answer, as they gave it (at most 2000 characters)." },
        help: { type: "string", enum: HELPS, description: "How much help you gave before the answer: none (default), hint, or shown." },
        confidence: { type: "integer", minimum: 1, maximum: 3, description: "How sure the student said they were before the answer was revealed: 1 (guessing) to 3 (sure)." },
        errorType: { type: "string", enum: ERROR_TYPES, description: "The kind of mistake behind a partial or incorrect answer." },
      },
      required: ["courseId", "questionId", "outcome"],
      additionalProperties: false,
    },
  },
  {
    name: "flag_check",
    description:
      "Ask Orca to check the student later on objectives they asked about or got wrong in this chat: each gets one " +
      "check-me question in their next quick review (a miss makes it a weak point Orca keeps practising). Flag only " +
      "what the student asked about or got wrong, never everything the chat touched. Pass what they said, in their " +
      "words. Orca writes questions for any objective that has none yet.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Objective ids from course_state." },
        said: { type: "string", maxLength: 200, description: "What the student said or asked, in their words (at most 200 characters)." },
        strength: { type: "string", enum: ["check", "struggled"], description: "check (default): one question later. struggled: the student is lost on it, so Orca puts it back to learning and keeps practising it." },
      },
      required: ["courseId", "objectiveIds", "said"],
      additionalProperties: false,
    },
  },
  {
    name: "material_for",
    description:
      "The course material behind some objectives: the pages each one is anchored to, as text, with the " +
      "material's name and page number. Read it before teaching or writing questions, so you teach what the " +
      "course teaches, in its notation. At most 6 pieces per objective, each cut at 2,500 characters; held-back " +
      "materials (past and practice exams kept for a practice test) are never returned, only counted (heldBack).",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "1 to 10 objective ids from course_state." },
      },
      required: ["courseId", "objectiveIds"],
      additionalProperties: false,
    },
  },
  {
    name: "vault_material",
    description:
      "A held-back past or practice exam, as text, for YOU to plan from: what kinds of problem the exam asks, how hard, " +
      "in what notation. Read every exam in course_state's vault at the start of a cram, except the reserved one. Never " +
      "show the student its problems or solutions, quote them, or teach by walking through them: write your own " +
      "problems of the same kinds. The reserved exam is refused until the student sits it timed (forMock true). Up to 8 " +
      "pages a call; pass fromPage (the result's nextPage) for the rest.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        materialId: { ...UUID, description: "A material id from course_state's vault." },
        fromPage: { type: "integer", minimum: 1, description: "The page to start from (default 1)." },
        forMock: { type: "boolean", description: "true only when the student is sitting this exam timed now: the one case the reserved exam is returned." },
      },
      required: ["courseId", "materialId"],
      additionalProperties: false,
    },
  },
  {
    name: "add_questions",
    description:
      "Store questions you wrote for the student's objectives, from the material (material_for) and in the " +
      "course's notation. Orca validates each like its own (multiple choice has four options and the right " +
      "index, true or false two; a short answer has exact forms or a rubric; math between \\( \\) must render; " +
      "an exact answer is never an expression; a question for an objective the material teaches has an anchor " +
      "from material_for) and lists the ones it refused with why. When material_for returns no pieces for an " +
      "objective (nothing live teaches it), send no anchor: the question is stored as not course-specific, " +
      "with a note, and you tell the student it isn't from their material. Stored questions come back from " +
      "next_questions and questions_for and are graded by check_answer like any other.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              objectiveId: UUID,
              kind: { type: "string", enum: QUESTION_KINDS },
              prompt: { type: "string", maxLength: TEXT_CHARS },
              options: { type: "array", items: { type: "string", maxLength: SHORT_CHARS }, maxItems: 4, description: "Four choices for multiple choice, two for true or false; omit for short answer." },
              answer: { type: "integer", minimum: 0, maximum: 3, description: "Index into options; omit for short answer." },
              exact: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 12, description: "Short answer with an exact form: every accepted spelling." },
              rubric: {
                type: "object",
                description: "Short answer graded in prose.",
                properties: {
                  requiredIdeas: { type: "array", items: { type: "string", maxLength: SHORT_CHARS }, minItems: 1, maxItems: 8 },
                  acceptableAlternatives: { type: "array", items: { type: "string", maxLength: SHORT_CHARS }, maxItems: 12 },
                  knownMisconceptions: {
                    type: "array",
                    maxItems: 8,
                    items: { type: "object", properties: { description: { type: "string", maxLength: SHORT_CHARS }, indicativePhrasing: { type: "array", items: { type: "string", maxLength: SHORT_CHARS }, maxItems: 8 } }, required: ["description", "indicativePhrasing"], additionalProperties: false },
                  },
                },
                required: ["requiredIdeas", "acceptableAlternatives", "knownMisconceptions"],
                additionalProperties: false,
              },
              explanation: { type: "string", maxLength: TEXT_CHARS },
              anchor: {
                type: "object",
                description: "Where in the material it comes from (from material_for).",
                properties: { locator: { type: "string", maxLength: 60, description: "e.g. 'slide 14'" }, excerpt: { type: "string", maxLength: SHORT_CHARS }, materialId: UUID },
                required: ["locator", "excerpt"],
                additionalProperties: false,
              },
            },
            required: ["objectiveId", "kind", "prompt", "explanation"],
            additionalProperties: false,
          },
        },
      },
      required: ["courseId", "questions"],
      additionalProperties: false,
    },
  },
  {
    name: "add_material",
    description:
      "Add material to the course: text the student pasted (the professor's words, a study guide, a problem " +
      "set; any length), or, with file true, a link the student opens to upload a file (a PDF or " +
      "slides). A past or practice exam is held back by default: Orca maps it to objectives but never writes " +
      "questions from it or shows it, so it can be a practice test.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        type: { type: "string", enum: MATERIAL_TYPES },
        text: { type: "string", minLength: 1, description: "The material's text, any length." },
        filename: { type: "string", maxLength: 200, description: "What to call it, e.g. 'Professor's review notes'." },
        holdBack: { type: "boolean", description: "Keep it hidden for a practice test (default true for Past exam and Practice exam, else false)." },
        file: { type: "boolean", description: "true, with no text: return an upload link instead." },
      },
      required: ["courseId", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "log_problem",
    description:
      "Record an exam-style problem the student attempted, for one kind of problem on the exam's map " +
      "(scope.problemTypes). This is how readiness is measured: Orca reports ready only for a kind whose latest " +
      "attempt was cold (no help first, at the exam's difficulty, your own problem of that kind) and solved. Use it " +
      "for the diagnostic (one cold problem per kind, before teaching), for the re-test after you teach a kind, and " +
      "for each problem of the reserved exam when the student sits it timed (mockMaterialId, points, outOf: their " +
      "measured score). Give the specific slip in errorNote. Call it as each problem is finished, not at the end.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        examId: { ...UUID, description: "The exam whose map names the kind." },
        problemTypeId: { type: "string", description: "The kind's id from scope.problemTypes." },
        outcome: { type: "string", enum: ATTEMPT_OUTCOMES, description: "solved alone, with-hints, shown the answer, or stuck (not finished)." },
        cold: { type: "boolean", description: "true when the student attempted it with no help first, as in the exam." },
        minutes: { type: "integer", minimum: 1, maximum: 600, description: "How long it took, from the clock." },
        errorNote: { type: "string", maxLength: 200, description: "The specific slip: missed a KCL branch; sign flip on v_L; used ω₀ where ω_d was asked." },
        mockMaterialId: { ...UUID, description: "The reserved exam's material id, when this is one of its problems sat timed." },
        points: { type: "number", minimum: 0, description: "Points earned on it, with outOf (a mock's problem)." },
        outOf: { type: "number", exclusiveMinimum: 0, description: "Points the problem is worth." },
      },
      required: ["courseId", "examId", "problemTypeId", "outcome", "cold"],
      additionalProperties: false,
    },
  },
  {
    name: "log_session",
    description:
      "Log a sitting with the student: how long it ran, what you worked on together, where they stopped and what " +
      "comes next. Call it whenever a sitting ends or pauses (the student says they're done, takes a break, or " +
      "switches course), and at least every couple of hours in a long one. This is what makes homework, drills and " +
      "lessons done in the chat count as time studied, and what lets a new chat pick up where this one stopped " +
      "(course_state's lastSession). Minutes are the time actually spent since the last log_session, from the clock, " +
      "not a guess. Objective-level results still go through check_answer, record_answer and log_evidence.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        examId: { ...UUID, description: "The exam it was for, when one is being crammed for." },
        minutes: { type: "integer", minimum: 1, maximum: 720, description: "Minutes actually spent since the last log_session." },
        summary: { type: "string", maxLength: 500, description: "One or two sentences: what the sitting covered." },
        worked: {
          type: "array",
          maxItems: 30,
          description: "What was worked, in order.",
          items: {
            type: "object",
            properties: {
              what: { type: "string", maxLength: 200, description: "e.g. HW08 E8 to E12; Drill 2: RLC damping; Lesson 7." },
              outcome: { type: "string", enum: SESSION_OUTCOMES, description: "solved alone, with-hints, shown the answer, or stuck (not finished)." },
              errorNote: { type: "string", maxLength: 200, description: "The specific slip, when there was one: flipped the divider fraction; used ω₀ where ω_d was asked." },
              objectiveIds: { type: "array", items: UUID, maxItems: 10 },
              problemTypeId: { type: "string", description: "A problem type's id from the exam map." },
            },
            required: ["what"],
            additionalProperties: false,
          },
        },
        bookmark: { type: "string", maxLength: 500, description: "Where the student stopped, exactly: Lesson 7.5 half done (I_2F found); Practice 8 not tried." },
        next: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 10, description: "What to do next, in order: HW07 P4, then a switched RC circuit, then an AC problem." },
      },
      required: ["courseId", "minutes", "summary", "worked"],
      additionalProperties: false,
    },
  },
  {
    name: "log_evidence",
    description:
      "Record what happened on one objective that wasn't an answer to one of Orca's questions. kind work: a " +
      "problem you set and judged (the problem as the student saw it, what the judgement rested on: the " +
      "official solution, a known answer, or you alone, the outcome, and the help you gave). kind signal: " +
      "what the student did: got-it (they said they get it: Orca checks it later), lost (they're lost: back " +
      "to learning), asked-answer or asked-harder. Signals never add credit.",
    inputSchema: {
      type: "object",
      properties: {
        courseId: UUID,
        objectiveId: UUID,
        kind: { type: "string", enum: ["work", "signal"] },
        problem: { type: "string", maxLength: PROBLEM_CHARS, description: "work: the problem as the student saw it (at most 4000 characters)." },
        response: { type: "string", maxLength: 2000, description: "work: the student's answer, in their words (at most 2000 characters)." },
        basis: { type: "string", enum: BASES, description: "work: what the judgement rested on." },
        outcome: { type: "string", enum: ["correct", "partial", "incorrect"], description: "work: how it went." },
        help: { type: "string", enum: HELPS, description: "work: how much help you gave: none (default), hint or shown." },
        confidence: { type: "integer", minimum: 1, maximum: 3, description: "work: the student's confidence before the reveal, 1 to 3." },
        errorType: { type: "string", enum: ERROR_TYPES, description: "work: the kind of mistake." },
        signal: { type: "string", enum: SIGNALS, description: "signal: what the student did." },
        note: { type: "string", maxLength: 2000, description: "signal: what they said, in their words (at most 2000 characters)." },
      },
      required: ["courseId", "objectiveId", "kind"],
      additionalProperties: false,
    },
  },
] as const;

/* ── JSON-RPC over one POST ── */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface RpcReply {
  /** HTTP status: 200 with a body, 202 for a notification, 400 for a malformed request. */
  status: number;
  body: unknown | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function result(id: RpcRequest["id"], value: unknown): RpcReply {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, result: value } };
}
function failure(id: RpcRequest["id"], code: number, message: string, status = 200): RpcReply {
  return { status, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}
/** A tool's answer, or its refusal, as MCP content. */
function toolText(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const isConfidence = (v: unknown): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3;
const isStringList = (v: unknown, max: number, maxLength: number, maxItems: number): v is string[] => Array.isArray(v) && v.length <= maxItems && v.every((x) => typeof x === "string" && x.length <= maxLength) && v.length <= max;

/**
 * Free text a tool records (what the student said, a problem, a note, a quote), screened like a
 * reflection note: cleaned, a strong injection hit refused, every hit logged. `text` is null when
 * nothing readable was sent.
 */
async function screenText(tools: ConnectorTools, raw: string, maxChars: number, what: string): Promise<{ ok: true; text: string | null } | { ok: false; error: string }> {
  const said = checkNotes(raw, maxChars);
  if (said.hits.length) await tools.screened(said.hits);
  if (!said.ok) return { ok: false, error: `Orca can't record that ${what} ("${said.quote}"); send it in plain words.` };
  return { ok: true, text: said.text };
}

/** An exam scope as set_exam takes it: ids, weights, evidence (quotes screened), format, sources and the budget checked field by field; objectives and sources may be left out together (the exam's are kept). */
async function parseScope(tools: ConnectorTools, raw: unknown): Promise<{ scope: ScopeInput } | { error: string }> {
  if (!isObject(raw)) return { error: "scope is an object: objectives, sources and optionally format, budget and materialIds." };
  if (raw.patchObjectives !== undefined && typeof raw.patchObjectives !== "boolean") return { error: "scope.patchObjectives is true or false." };
  const patch = raw.patchObjectives === true;
  if (patch && !Array.isArray(raw.objectives)) return { error: "scope.patchObjectives needs scope.objectives: the ones to change." };
  const keepScope = raw.objectives === undefined && raw.sources === undefined;
  if (!keepScope && (!Array.isArray(raw.objectives) || raw.objectives.length > 400)) return { error: "scope.objectives is a list of up to 400 { objectiveId, weight, evidence } (left out with sources, the exam's are kept)." };
  if (!keepScope && !(patch && raw.sources === undefined) && (!Array.isArray(raw.sources) || raw.sources.length > 6 || !raw.sources.every((x) => isOneOf(SCOPE_SIGNALS, x)))) return { error: `scope.sources is a list of ${SCOPE_SIGNALS.join(", ")}.` };
  const objectives: ExamScope["objectives"] = [];
  for (const [i, o] of ((raw.objectives as unknown[] | undefined) ?? []).entries()) {
    if (!isObject(o) || !isUuid(o.objectiveId)) return { error: `scope.objectives[${i}].objectiveId must be an objective id from course_state.` };
    if (typeof o.weight !== "number" || !Number.isFinite(o.weight) || o.weight < 0 || o.weight > 10) return { error: `scope.objectives[${i}].weight is a number from 0 (excluded) to 10.` };
    if (!Array.isArray(o.evidence) || o.evidence.length > 8) return { error: `scope.objectives[${i}].evidence is a list of up to 8 { signal, quote?, materialId? }.` };
    const evidence: ScopeEvidence[] = [];
    for (const [j, ev] of o.evidence.entries()) {
      if (!isObject(ev) || !isOneOf(SCOPE_SIGNALS, ev.signal)) return { error: `scope.objectives[${i}].evidence[${j}].signal is one of ${SCOPE_SIGNALS.join(", ")}.` };
      if (ev.materialId !== undefined && !isUuid(ev.materialId)) return { error: `scope.objectives[${i}].evidence[${j}].materialId must be a material id.` };
      let quote: string | undefined;
      if (ev.quote !== undefined) {
        if (typeof ev.quote !== "string" || ev.quote.length > QUOTE_CHARS) return { error: `scope.objectives[${i}].evidence[${j}].quote is at most ${QUOTE_CHARS} characters.` };
        const screened = await screenText(tools, ev.quote, QUOTE_CHARS, "quote");
        if (!screened.ok) return { error: screened.error };
        quote = screened.text ?? undefined;
      }
      evidence.push({ signal: ev.signal, strength: SCOPE_STRENGTH[ev.signal], ...(quote !== undefined ? { quote } : {}), ...(ev.materialId !== undefined ? { materialId: ev.materialId as string } : {}) });
    }
    objectives.push({ objectiveId: o.objectiveId, weight: o.weight, evidence });
  }
  let format: ExamScope["format"];
  if (raw.format !== undefined) {
    const f = raw.format;
    if (!isObject(f)) return { error: "scope.format is an object: minutes, problems, kinds." };
    const whole = (v: unknown, max: number) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max);
    if (!whole(f.minutes, 600)) return { error: "scope.format.minutes is a whole number from 1 to 600." };
    if (!whole(f.problems, 200)) return { error: "scope.format.problems is a whole number from 1 to 200." };
    if (f.kinds !== undefined && (!Array.isArray(f.kinds) || f.kinds.length > 4 || !f.kinds.every((k) => isOneOf(SCOPE_KINDS, k)))) return { error: `scope.format.kinds is a list of ${SCOPE_KINDS.join(", ")}.` };
    format = { ...(f.minutes !== undefined ? { minutes: f.minutes as number } : {}), ...(f.problems !== undefined ? { problems: f.problems as number } : {}), ...(f.kinds !== undefined ? { kinds: [...new Set(f.kinds as ScopeKind[])] } : {}) };
  }
  let budget: CramBudgetInput | undefined;
  if (raw.budget !== undefined) {
    const b = raw.budget;
    if (!isObject(b)) return { error: "scope.budget is an object: perDay, today, hours, daysOut, since." };
    budget = {};
    if (b.perDay !== undefined) {
      if (!isObject(b.perDay) || Object.keys(b.perDay).length > BUDGET_DAYS_MAX) return { error: `scope.budget.perDay is an object of at most ${BUDGET_DAYS_MAX} days (YYYY-MM-DD) to hours.` };
      for (const [day, h] of Object.entries(b.perDay)) {
        if (!isDay(day)) return { error: `scope.budget.perDay: "${day}" isn't a day, YYYY-MM-DD.` };
        if (!isHalfHours(h)) return { error: `scope.budget.perDay["${day}"] is hours from 0 to ${HOURS_PER_DAY_MAX} in steps of ${HOUR_STEP}.` };
      }
      budget.perDay = { ...(b.perDay as Record<string, number>) };
    }
    if (b.today !== undefined) {
      if (!isHalfHours(b.today)) return { error: `scope.budget.today is hours from 0 to ${HOURS_PER_DAY_MAX} in steps of ${HOUR_STEP}.` };
      budget.today = b.today;
    }
    if (b.hours !== undefined) {
      if (typeof b.hours !== "number" || !Number.isFinite(b.hours) || b.hours < 0 || b.hours > BUDGET_HOURS_MAX) return { error: `scope.budget.hours is a number from 0 to ${BUDGET_HOURS_MAX}.` };
      budget.hours = b.hours;
    }
    if (b.daysOut !== undefined) {
      if (!Array.isArray(b.daysOut) || b.daysOut.length > BUDGET_DAYS_OUT_MAX || !b.daysOut.every(isDay)) return { error: "scope.budget.daysOut is a list of days, YYYY-MM-DD." };
      budget.daysOut = [...new Set(b.daysOut as string[])].sort();
    }
    if (b.since !== undefined) {
      if (typeof b.since !== "string" || Number.isNaN(Date.parse(b.since))) return { error: "scope.budget.since is an ISO date-time: when cramming started." };
      budget.since = new Date(b.since).toISOString();
    }
    if (Object.keys(budget).length === 0) return { error: "scope.budget names at least one of perDay, today, hours, daysOut, since." };
  }
  let materialIds: string[] | undefined;
  if (raw.materialIds !== undefined) {
    if (!Array.isArray(raw.materialIds) || raw.materialIds.length > MATERIALS_MAX || !raw.materialIds.every(isUuid)) return { error: `scope.materialIds is a list of up to ${MATERIALS_MAX} material ids from course_state.` };
    materialIds = [...new Set(raw.materialIds as string[])];
  }
  let rules: ExamRules | undefined;
  if (raw.rules !== undefined) {
    const r = raw.rules;
    if (!isObject(r)) return { error: "scope.rules is an object: notes, calculator, minutes, text." };
    if (r.notes !== undefined && !isOneOf(RULE_NOTES, r.notes)) return { error: `scope.rules.notes is one of ${RULE_NOTES.join(", ")}.` };
    if (r.calculator !== undefined && !isOneOf(RULE_CALCULATORS, r.calculator)) return { error: `scope.rules.calculator is one of ${RULE_CALCULATORS.join(", ")}.` };
    if (r.minutes !== undefined && (typeof r.minutes !== "number" || !Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > 600)) return { error: "scope.rules.minutes is a whole number from 1 to 600." };
    let text: string | undefined;
    if (r.text !== undefined) {
      if (typeof r.text !== "string" || r.text.length > QUOTE_CHARS) return { error: `scope.rules.text is at most ${QUOTE_CHARS} characters.` };
      const screened = await screenText(tools, r.text, QUOTE_CHARS, "rules");
      if (!screened.ok) return { error: screened.error };
      text = screened.text ?? undefined;
    }
    rules = { ...(r.notes !== undefined ? { notes: r.notes } : {}), ...(r.calculator !== undefined ? { calculator: r.calculator } : {}), ...(r.minutes !== undefined ? { minutes: r.minutes as number } : {}), ...(text ? { text } : {}) };
  }
  let problemTypes: ProblemType[] | undefined;
  if (raw.problemTypes !== undefined) {
    if (!Array.isArray(raw.problemTypes) || raw.problemTypes.length > PROBLEM_TYPES_MAX) return { error: `scope.problemTypes is a list of up to ${PROBLEM_TYPES_MAX} { id, name, objectiveIds, materialIds, note? }.` };
    problemTypes = [];
    const seen = new Set<string>();
    for (const [i, t] of raw.problemTypes.entries()) {
      if (!isObject(t) || typeof t.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(t.id)) return { error: `scope.problemTypes[${i}].id is a short slug you choose (lowercase letters, digits and dashes, at most 40), e.g. "charge-sharing".` };
      if (seen.has(t.id)) return { error: `scope.problemTypes[${i}].id repeats "${t.id}".` };
      seen.add(t.id);
      if (typeof t.name !== "string" || t.name.trim().length === 0 || t.name.length > 120) return { error: `scope.problemTypes[${i}].name is 1 to 120 characters.` };
      if (!Array.isArray(t.objectiveIds) || t.objectiveIds.length > 40 || !t.objectiveIds.every(isUuid)) return { error: `scope.problemTypes[${i}].objectiveIds is a list of up to 40 objective ids from course_state (empty when no objective fits).` };
      if (!Array.isArray(t.materialIds) || t.materialIds.length > MATERIALS_MAX || !t.materialIds.every(isUuid)) return { error: `scope.problemTypes[${i}].materialIds is the list of exams (material ids from course_state's vault or materials) it appears on.` };
      const name = await screenText(tools, t.name.trim(), 120, "problem type");
      if (!name.ok) return { error: name.error };
      let note: string | undefined;
      if (t.note !== undefined) {
        if (typeof t.note !== "string" || t.note.length > QUOTE_CHARS) return { error: `scope.problemTypes[${i}].note is at most ${QUOTE_CHARS} characters.` };
        const screened = await screenText(tools, t.note, QUOTE_CHARS, "note");
        if (!screened.ok) return { error: screened.error };
        note = screened.text ?? undefined;
      }
      problemTypes.push({ id: t.id, name: name.text ?? t.name.trim(), objectiveIds: [...new Set(t.objectiveIds as string[])], materialIds: [...new Set(t.materialIds as string[])], ...(note ? { note } : {}) });
    }
  }
  if (raw.reservedMaterialId !== undefined && raw.reservedMaterialId !== null && !isUuid(raw.reservedMaterialId)) return { error: "scope.reservedMaterialId is a material id from course_state's vault, or null to clear it." };
  const extras = { ...(format !== undefined ? { format } : {}), ...(budget !== undefined ? { budget } : {}), ...(materialIds !== undefined ? { materialIds } : {}), ...(rules !== undefined ? { rules } : {}), ...(problemTypes !== undefined ? { problemTypes } : {}), ...(raw.reservedMaterialId !== undefined ? { reservedMaterialId: raw.reservedMaterialId as string | null } : {}) };
  if (patch) return { scope: { objectives, patchObjectives: true, ...(raw.sources !== undefined ? { sources: [...new Set(raw.sources as ScopeSignal[])] } : {}), ...extras } };
  return { scope: { ...(keepScope ? {} : { objectives, sources: [...new Set(raw.sources as ScopeSignal[])] }), ...extras } };
}

/** One question as add_questions takes it, checked field by field (the deeper checks, like a generated question's, are the implementation's). */
function parseQuestion(raw: unknown, i: number): { question: AddQuestion } | { error: string } {
  const at = `questions[${i}]`;
  if (!isObject(raw)) return { error: `${at} is an object: objectiveId, kind, prompt, explanation and the key.` };
  if (!isUuid(raw.objectiveId)) return { error: `${at}.objectiveId must be an objective id from course_state.` };
  if (!isOneOf(QUESTION_KINDS, raw.kind)) return { error: `${at}.kind is ${QUESTION_KINDS.join(", ")}.` };
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0 || raw.prompt.length > TEXT_CHARS) return { error: `${at}.prompt is 1 to ${TEXT_CHARS} characters.` };
  if (typeof raw.explanation !== "string" || raw.explanation.trim().length === 0 || raw.explanation.length > TEXT_CHARS) return { error: `${at}.explanation is 1 to ${TEXT_CHARS} characters.` };
  if (raw.options !== undefined && !isStringList(raw.options, 4, SHORT_CHARS, 4)) return { error: `${at}.options is up to 4 choices of at most ${SHORT_CHARS} characters.` };
  if (raw.answer !== undefined && (typeof raw.answer !== "number" || !Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer > 3)) return { error: `${at}.answer is the index of the right option, 0 to 3.` };
  if (raw.exact !== undefined && !isStringList(raw.exact, 12, 120, 12)) return { error: `${at}.exact is up to 12 accepted spellings of at most 120 characters.` };
  let rubric: Rubric | undefined;
  if (raw.rubric !== undefined) {
    const r = raw.rubric;
    if (!isObject(r) || !isStringList(r.requiredIdeas, 8, SHORT_CHARS, 8) || r.requiredIdeas.length < 1 || !isStringList(r.acceptableAlternatives, 12, SHORT_CHARS, 12) || !Array.isArray(r.knownMisconceptions) || r.knownMisconceptions.length > 8) {
      return { error: `${at}.rubric is { requiredIdeas (1 to 8), acceptableAlternatives (up to 12), knownMisconceptions (up to 8 of { description, indicativePhrasing }) }.` };
    }
    for (const m of r.knownMisconceptions) {
      if (!isObject(m) || typeof m.description !== "string" || m.description.length > SHORT_CHARS || !isStringList(m.indicativePhrasing, 8, SHORT_CHARS, 8)) return { error: `${at}.rubric.knownMisconceptions is a list of { description, indicativePhrasing }.` };
    }
    rubric = { requiredIdeas: r.requiredIdeas, acceptableAlternatives: r.acceptableAlternatives, knownMisconceptions: r.knownMisconceptions as Rubric["knownMisconceptions"] };
  }
  let anchor: AddQuestion["anchor"];
  if (raw.anchor !== undefined) {
    const a = raw.anchor;
    if (!isObject(a) || typeof a.locator !== "string" || a.locator.length > 60 || typeof a.excerpt !== "string" || a.excerpt.length > SHORT_CHARS || (a.materialId !== undefined && !isUuid(a.materialId))) {
      return { error: `${at}.anchor is { locator (at most 60 characters), excerpt (at most ${SHORT_CHARS}), materialId? }.` };
    }
    anchor = { locator: a.locator, excerpt: a.excerpt, ...(a.materialId !== undefined ? { materialId: a.materialId as string } : {}) };
  }
  const choice = raw.kind !== "Short answer";
  if (choice && (!Array.isArray(raw.options) || raw.options.length < 2 || raw.answer === undefined || raw.answer >= raw.options.length)) return { error: `${at}: a ${raw.kind} question has 2 to 4 options and answer, the index of the right one.` };
  if (!choice && (raw.options?.length || raw.answer !== undefined)) return { error: `${at}: a short answer has no options and no answer index; give exact forms or a rubric.` };
  if (!choice && !(raw.exact?.length) && rubric === undefined) return { error: `${at}: a short answer needs exact forms or a rubric.` };
  return {
    question: {
      objectiveId: raw.objectiveId,
      kind: raw.kind,
      prompt: raw.prompt,
      ...(raw.options !== undefined ? { options: raw.options } : {}),
      ...(raw.answer !== undefined ? { answer: raw.answer } : {}),
      ...(raw.exact !== undefined ? { exact: raw.exact } : {}),
      ...(rubric !== undefined ? { rubric } : {}),
      explanation: raw.explanation,
      ...(anchor !== undefined ? { anchor } : {}),
    },
  };
}

/**
 * Answer one JSON-RPC message. `session` names the chat for evidence (`sessionId`): the route passes
 * a stable value per connection where it has one, else the day.
 */
export async function handleRpc(raw: unknown, tools: ConnectorTools, session: string): Promise<RpcReply> {
  if (!isObject(raw) || raw.jsonrpc !== "2.0" || typeof raw.method !== "string") {
    return failure(null, -32600, "Send one JSON-RPC 2.0 request.", 400);
  }
  const req = raw as unknown as RpcRequest;
  const params = isObject(req.params) ? req.params : {};
  const isNotification = !("id" in raw);

  switch (req.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION;
      return result(req.id, {
        protocolVersion: KNOWN_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return { status: 202, body: null };
    case "ping":
      return result(req.id, {});
    case "tools/list":
      return result(req.id, { tools: TOOLS });
    case "tools/call":
      if (isNotification) return { status: 202, body: null };
      return result(req.id, await callTool(params, tools, session));
    default:
      if (isNotification) return { status: 202, body: null };
      return failure(req.id, -32601, `Orca doesn't have "${req.method}".`);
  }
}

async function callTool(params: Record<string, unknown>, tools: ConnectorTools, session: string) {
  const name = params.name;
  const args = isObject(params.arguments) ? params.arguments : {};
  try {
    switch (name) {
      case "course_state": {
        if (args.courseId === undefined) return toolText({ courses: await tools.courses() });
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (args.detail !== undefined && args.detail !== "summary" && args.detail !== "weak" && args.detail !== "full") return toolText({ error: "detail is summary, weak or full." }, true);
        if (args.topicIds !== undefined && (!Array.isArray(args.topicIds) || !args.topicIds.every(isUuid))) return toolText({ error: "topicIds is a list of topic ids from course_state." }, true);
        if (args.asOf !== undefined && (typeof args.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.asOf) || Number.isNaN(Date.parse(args.asOf)) || Math.abs(Date.parse(args.asOf) - Date.now()) > 61 * 86_400_000)) return toolText({ error: "asOf is a day, YYYY-MM-DD, within 60 days of today." }, true);
        const state = await tools.courseState(args.courseId, { detail: (args.detail as "summary" | "weak" | "full" | undefined) ?? "full", ...(args.topicIds !== undefined ? { topicIds: args.topicIds as string[] } : {}), ...(typeof args.asOf === "string" ? { asOf: args.asOf } : {}) });
        return state ? toolText(state) : toolText({ error: "No such course." }, true);
      }
      case "next_questions": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        for (const k of ["objectiveIds", "topicIds"] as const) {
          if (args[k] !== undefined && (!Array.isArray(args[k]) || (args[k] as unknown[]).length > 20 || !(args[k] as unknown[]).every(isUuid))) return toolText({ error: `${k} is a list of up to 20 ids from course_state.` }, true);
        }
        const count = typeof args.count === "number" && Number.isInteger(args.count) ? Math.min(5, Math.max(1, args.count)) : 1;
        const write = args.write === undefined ? true : args.write === true;
        const next = await tools.nextQuestions(args.courseId, { ...(args.objectiveIds !== undefined ? { objectiveIds: [...new Set(args.objectiveIds as string[])] } : {}), ...(args.topicIds !== undefined ? { topicIds: [...new Set(args.topicIds as string[])] } : {}), count, write });
        return next ? toolText(next) : toolText({ error: "No such course." }, true);
      }
      case "set_exam": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (args.remove === true) {
          if (!isUuid(args.examId)) return toolText({ error: "remove needs examId, an exam id from course_state." }, true);
          const gone = await tools.removeExam(args.courseId, args.examId);
          return toolText(gone, "error" in gone);
        }
        if (args.examId !== undefined && !isUuid(args.examId)) return toolText({ error: "examId must be an exam id from course_state." }, true);
        // Changing an exam, title, date and topicIds left out keep what it has (so a budget-only update can't move the date); a new exam needs all three.
        const changing = args.examId !== undefined;
        if ((!changing || args.title !== undefined) && (typeof args.title !== "string" || args.title.trim().length === 0 || args.title.length > 120)) return toolText({ error: "title is 1 to 120 characters." }, true);
        if ((!changing || args.date !== undefined) && (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date)))) return toolText({ error: "date is YYYY-MM-DD." }, true);
        if ((!changing || args.topicIds !== undefined) && (!Array.isArray(args.topicIds) || !args.topicIds.every(isUuid))) return toolText({ error: "topicIds is a list of topic ids from course_state (empty for the whole course)." }, true);
        if (args.cramming !== undefined && typeof args.cramming !== "boolean") return toolText({ error: "cramming is true or false." }, true);
        let scope: ScopeInput | undefined;
        if (args.scope !== undefined) {
          const parsed = await parseScope(tools, args.scope);
          if ("error" in parsed) return toolText(parsed, true);
          scope = parsed.scope;
        }
        const exam = await tools.setExam(args.courseId, {
          ...(args.examId !== undefined ? { id: args.examId } : {}),
          ...(typeof args.title === "string" ? { title: args.title.trim() } : {}),
          ...(typeof args.date === "string" ? { date: args.date } : {}),
          ...(Array.isArray(args.topicIds) ? { topicIds: args.topicIds as string[] } : {}),
          ...(args.cramming !== undefined ? { cramming: args.cramming } : {}),
          ...(scope !== undefined ? { scope } : {}),
        });
        return toolText(exam, "error" in exam);
      }
      case "questions_for": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (args.objectiveIds !== undefined && (!Array.isArray(args.objectiveIds) || !args.objectiveIds.every(isUuid))) return toolText({ error: "objectiveIds is a list of objective ids from course_state." }, true);
        const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(20, Math.max(1, args.limit)) : 5;
        const questions = await tools.questionsFor(args.courseId, (args.objectiveIds as string[] | undefined) ?? null, limit);
        return questions ? toolText(questions) : toolText({ error: "No such course." }, true);
      }
      case "check_answer": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.questionId)) return toolText({ error: "questionId must be a question id from questions_for." }, true);
        if (typeof args.response !== "string" || args.response.trim().length === 0 || args.response.length > 2000) return toolText({ error: "response is the student's answer, 1 to 2000 characters." }, true);
        if (args.confidence !== undefined && !isConfidence(args.confidence)) return toolText({ error: "confidence is 1, 2 or 3." }, true);
        if (args.help !== undefined && !isOneOf(HELPS, args.help)) return toolText({ error: "help is none, hint or shown." }, true);
        const checked = await tools.checkAnswer(args.courseId, args.questionId, args.response.trim(), session, { ...(args.help !== undefined ? { help: args.help } : {}), ...(args.confidence !== undefined ? { confidence: args.confidence } : {}) });
        return toolText(checked, "error" in checked);
      }
      case "record_answer": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.questionId)) return toolText({ error: "questionId must be a question id from questions_for." }, true);
        if (args.outcome !== "correct" && args.outcome !== "partial" && args.outcome !== "incorrect") return toolText({ error: "outcome is correct, partial or incorrect." }, true);
        if (args.help !== undefined && !isOneOf(HELPS, args.help)) return toolText({ error: "help is none, hint or shown." }, true);
        if (args.confidence !== undefined && !isConfidence(args.confidence)) return toolText({ error: "confidence is 1, 2 or 3." }, true);
        if (args.errorType !== undefined && !isOneOf(ERROR_TYPES, args.errorType)) return toolText({ error: `errorType is one of ${ERROR_TYPES.join(", ")}.` }, true);
        let response: string | undefined;
        if (args.response !== undefined) {
          if (typeof args.response !== "string" || args.response.length > 2000) return toolText({ error: "response is the student's answer, at most 2000 characters." }, true);
          // Screened like a reflection note: a strong hit is refused, every hit logged.
          const said = checkNotes(args.response, 2000);
          if (said.hits.length) await tools.screened(said.hits);
          if (!said.ok) return toolText({ error: `Orca can't record that answer ("${said.quote}"); send what the student said, in plain words.` }, true);
          response = said.text ?? undefined;
        }
        const report: AnswerReport = { help: args.help ?? "none", ...(args.confidence !== undefined ? { confidence: args.confidence } : {}), ...(args.errorType !== undefined ? { errorType: args.errorType } : {}) };
        const recorded = await tools.recordAnswer(args.courseId, args.questionId, args.outcome, session, response, report);
        return toolText(recorded, "error" in recorded);
      }
      case "flag_check": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!Array.isArray(args.objectiveIds) || args.objectiveIds.length < 1 || args.objectiveIds.length > 20 || !args.objectiveIds.every(isUuid)) {
          return toolText({ error: "objectiveIds is 1 to 20 objective ids from course_state." }, true);
        }
        if (typeof args.said !== "string" || args.said.length > 200) return toolText({ error: "said is 1 to 200 characters: what the student said." }, true);
        // Screened like a reflection note: a strong hit is refused, every hit logged.
        const said = checkNotes(args.said, 200);
        if (said.hits.length) await tools.screened(said.hits);
        if (!said.ok) return toolText({ error: `Orca can't record that note ("${said.quote}"); say what the student asked in plain words.` }, true);
        if (!said.text) return toolText({ error: "said is 1 to 200 characters: what the student said." }, true);
        if (args.strength !== undefined && args.strength !== "check" && args.strength !== "struggled") return toolText({ error: "strength is check or struggled." }, true);
        const out = await tools.flagCheck(args.courseId, [...new Set(args.objectiveIds as string[])], said.text, args.strength ?? "check");
        return toolText(out, "error" in out);
      }
      case "material_for": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!Array.isArray(args.objectiveIds) || args.objectiveIds.length < 1 || args.objectiveIds.length > 10 || !args.objectiveIds.every(isUuid)) {
          return toolText({ error: "objectiveIds is 1 to 10 objective ids from course_state." }, true);
        }
        const material = await tools.materialFor(args.courseId, [...new Set(args.objectiveIds as string[])]);
        return material ? toolText(material) : toolText({ error: "No such course." }, true);
      }
      case "vault_material": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.materialId)) return toolText({ error: "materialId must be a material id from course_state's vault." }, true);
        if (args.fromPage !== undefined && (typeof args.fromPage !== "number" || !Number.isInteger(args.fromPage) || args.fromPage < 1)) return toolText({ error: "fromPage is a page number from 1." }, true);
        if (args.forMock !== undefined && typeof args.forMock !== "boolean") return toolText({ error: "forMock is true or false." }, true);
        const exam = await tools.vaultMaterial(args.courseId, args.materialId, { ...(typeof args.fromPage === "number" ? { fromPage: args.fromPage } : {}), ...(args.forMock === true ? { forMock: true } : {}) });
        return toolText(exam, "error" in exam);
      }
      case "add_questions": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!Array.isArray(args.questions) || args.questions.length < 1 || args.questions.length > 10) return toolText({ error: "questions is a list of 1 to 10 questions." }, true);
        const questions: AddQuestion[] = [];
        for (const [i, q] of args.questions.entries()) {
          const parsed = parseQuestion(q, i);
          if ("error" in parsed) return toolText(parsed, true);
          questions.push(parsed.question);
        }
        const added = await tools.addQuestions(args.courseId, questions);
        return toolText(added, "error" in added);
      }
      case "add_material": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isOneOf(MATERIAL_TYPES, args.type)) return toolText({ error: `type is one of ${MATERIAL_TYPES.join(", ")}.` }, true);
        if (args.text !== undefined && (typeof args.text !== "string" || args.text.trim().length === 0)) return toolText({ error: "text is the material's text (not empty)." }, true);
        if (args.filename !== undefined && (typeof args.filename !== "string" || args.filename.trim().length === 0 || args.filename.length > 200)) return toolText({ error: "filename is 1 to 200 characters." }, true);
        if (args.holdBack !== undefined && typeof args.holdBack !== "boolean") return toolText({ error: "holdBack is true or false." }, true);
        if (args.file !== undefined && args.file !== true && args.file !== false) return toolText({ error: "file is true or false." }, true);
        if (args.text === undefined && args.file !== true) return toolText({ error: "Pass text (the material's text) or file true (for an upload link)." }, true);
        const holdBack = args.holdBack ?? (args.type === "Past exam" || args.type === "Practice exam");
        const result = await tools.addMaterial(args.courseId, {
          type: args.type,
          ...(args.text !== undefined ? { text: args.text } : { file: true as const }),
          ...(args.filename !== undefined ? { filename: args.filename.trim() } : {}),
          holdBack,
        });
        return toolText(result, "error" in result);
      }
      case "log_problem": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.examId)) return toolText({ error: "examId must be an exam id from course_state." }, true);
        if (typeof args.problemTypeId !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(args.problemTypeId)) return toolText({ error: "problemTypeId is a kind's id from the exam's scope.problemTypes." }, true);
        if (!isOneOf(ATTEMPT_OUTCOMES, args.outcome)) return toolText({ error: `outcome is one of ${ATTEMPT_OUTCOMES.join(", ")}.` }, true);
        if (typeof args.cold !== "boolean") return toolText({ error: "cold is true (no help first) or false." }, true);
        if (args.minutes !== undefined && (typeof args.minutes !== "number" || !Number.isInteger(args.minutes) || args.minutes < 1 || args.minutes > 600)) return toolText({ error: "minutes is a whole number from 1 to 600." }, true);
        if (args.mockMaterialId !== undefined && !isUuid(args.mockMaterialId)) return toolText({ error: "mockMaterialId is the reserved exam's material id." }, true);
        if ((args.points === undefined) !== (args.outOf === undefined)) return toolText({ error: "points and outOf come together." }, true);
        if (args.points !== undefined && (typeof args.points !== "number" || typeof args.outOf !== "number" || !Number.isFinite(args.points) || !Number.isFinite(args.outOf) || args.points < 0 || args.outOf <= 0 || args.points > args.outOf)) return toolText({ error: "points is from 0 to outOf, and outOf is above 0." }, true);
        let errorNote: string | undefined;
        if (args.errorNote !== undefined) {
          if (typeof args.errorNote !== "string" || args.errorNote.length > 200) return toolText({ error: "errorNote is at most 200 characters." }, true);
          const screened = await screenText(tools, args.errorNote, 200, "errorNote");
          if (!screened.ok) return toolText({ error: screened.error }, true);
          errorNote = screened.text ?? undefined;
        }
        const attempted = await tools.logProblem(args.courseId, args.examId, { typeId: args.problemTypeId, outcome: args.outcome, cold: args.cold, ...(typeof args.minutes === "number" ? { minutes: args.minutes } : {}), ...(errorNote ? { errorNote } : {}), ...(args.mockMaterialId !== undefined ? { mockMaterialId: args.mockMaterialId } : {}), ...(typeof args.points === "number" ? { points: args.points, outOf: args.outOf as number } : {}) });
        return toolText(attempted, "error" in attempted);
      }
      case "log_session": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (args.examId !== undefined && !isUuid(args.examId)) return toolText({ error: "examId must be an exam id from course_state." }, true);
        if (typeof args.minutes !== "number" || !Number.isInteger(args.minutes) || args.minutes < 1 || args.minutes > 720) return toolText({ error: "minutes is a whole number from 1 to 720: the time actually spent." }, true);
        if (typeof args.summary !== "string" || args.summary.trim().length === 0 || args.summary.length > 500) return toolText({ error: "summary is 1 to 500 characters." }, true);
        if (!Array.isArray(args.worked) || args.worked.length > 30) return toolText({ error: "worked is a list of up to 30 { what, outcome?, errorNote?, objectiveIds?, problemTypeId? }." }, true);
        if (args.bookmark !== undefined && (typeof args.bookmark !== "string" || args.bookmark.length > 500)) return toolText({ error: "bookmark is at most 500 characters." }, true);
        if (args.next !== undefined && (!Array.isArray(args.next) || args.next.length > 10 || !args.next.every((n) => typeof n === "string" && n.trim().length > 0 && n.length <= 200))) return toolText({ error: "next is a list of up to 10 steps, each 1 to 200 characters." }, true);
        // Every piece of text is screened like a reflection note: a strong hit is refused, every hit logged.
        const clean = async (raw: string, max: number, what: string) => screenText(tools, raw, max, what);
        const summary = await clean(args.summary.trim(), 500, "summary");
        if (!summary.ok) return toolText({ error: summary.error }, true);
        const worked: SessionWork[] = [];
        for (const [i, w] of (args.worked as unknown[]).entries()) {
          if (!isObject(w) || typeof w.what !== "string" || w.what.trim().length === 0 || w.what.length > 200) return toolText({ error: `worked[${i}].what is 1 to 200 characters.` }, true);
          if (w.outcome !== undefined && !isOneOf(SESSION_OUTCOMES, w.outcome)) return toolText({ error: `worked[${i}].outcome is one of ${SESSION_OUTCOMES.join(", ")}.` }, true);
          if (w.errorNote !== undefined && (typeof w.errorNote !== "string" || w.errorNote.length > 200)) return toolText({ error: `worked[${i}].errorNote is at most 200 characters.` }, true);
          if (w.objectiveIds !== undefined && (!Array.isArray(w.objectiveIds) || w.objectiveIds.length > 10 || !w.objectiveIds.every(isUuid))) return toolText({ error: `worked[${i}].objectiveIds is a list of up to 10 objective ids from course_state.` }, true);
          if (w.problemTypeId !== undefined && (typeof w.problemTypeId !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(w.problemTypeId))) return toolText({ error: `worked[${i}].problemTypeId is a problem type's id from the exam map.` }, true);
          const what = await clean(w.what.trim(), 200, "worked");
          if (!what.ok) return toolText({ error: what.error }, true);
          const note = w.errorNote ? await clean(w.errorNote, 200, "errorNote") : null;
          if (note && !note.ok) return toolText({ error: note.error }, true);
          worked.push({ what: what.text ?? w.what.trim(), ...(w.outcome !== undefined ? { outcome: w.outcome } : {}), ...(note?.ok && note.text ? { errorNote: note.text } : {}), ...(w.objectiveIds !== undefined ? { objectiveIds: [...new Set(w.objectiveIds as string[])] } : {}), ...(w.problemTypeId !== undefined ? { problemTypeId: w.problemTypeId } : {}) });
        }
        const bookmark = typeof args.bookmark === "string" && args.bookmark.trim() ? await clean(args.bookmark.trim(), 500, "bookmark") : null;
        if (bookmark && !bookmark.ok) return toolText({ error: bookmark.error }, true);
        const next: string[] = [];
        for (const step of (args.next as string[] | undefined) ?? []) {
          const screened = await clean(step.trim(), 200, "next");
          if (!screened.ok) return toolText({ error: screened.error }, true);
          if (screened.text) next.push(screened.text);
        }
        const logged = await tools.logSession(args.courseId, { minutes: args.minutes, summary: summary.text ?? args.summary.trim(), worked, ...(bookmark?.ok && bookmark.text ? { bookmark: bookmark.text } : {}), ...(next.length ? { next } : {}), ...(args.examId !== undefined ? { examId: args.examId } : {}) });
        return toolText(logged, "error" in logged);
      }
      case "log_evidence": {
        if (!isUuid(args.courseId)) return toolText({ error: "courseId must be a course id from course_state." }, true);
        if (!isUuid(args.objectiveId)) return toolText({ error: "objectiveId must be an objective id from course_state." }, true);
        if (args.kind !== "work" && args.kind !== "signal") return toolText({ error: "kind is work or signal." }, true);
        let entry: EvidenceEntry;
        if (args.kind === "work") {
          if (typeof args.problem !== "string" || args.problem.length > PROBLEM_CHARS) return toolText({ error: `problem is the problem as the student saw it, 1 to ${PROBLEM_CHARS} characters.` }, true);
          if (!isOneOf(BASES, args.basis)) return toolText({ error: `basis is one of ${BASES.join(", ")}.` }, true);
          if (args.outcome !== "correct" && args.outcome !== "partial" && args.outcome !== "incorrect") return toolText({ error: "outcome is correct, partial or incorrect." }, true);
          if (args.help !== undefined && !isOneOf(HELPS, args.help)) return toolText({ error: "help is none, hint or shown." }, true);
          if (args.confidence !== undefined && !isConfidence(args.confidence)) return toolText({ error: "confidence is 1, 2 or 3." }, true);
          if (args.errorType !== undefined && !isOneOf(ERROR_TYPES, args.errorType)) return toolText({ error: `errorType is one of ${ERROR_TYPES.join(", ")}.` }, true);
          if (args.response !== undefined && (typeof args.response !== "string" || args.response.length > 2000)) return toolText({ error: "response is the student's answer, at most 2000 characters." }, true);
          // Screened like a reflection note: a strong hit is refused, every hit logged.
          const problem = await screenText(tools, args.problem, PROBLEM_CHARS, "problem");
          if (!problem.ok) return toolText({ error: problem.error }, true);
          if (!problem.text) return toolText({ error: `problem is the problem as the student saw it, 1 to ${PROBLEM_CHARS} characters.` }, true);
          let response: string | undefined;
          if (args.response !== undefined) {
            const said = await screenText(tools, args.response, 2000, "answer");
            if (!said.ok) return toolText({ error: said.error }, true);
            response = said.text ?? undefined;
          }
          entry = {
            kind: "work",
            problem: problem.text,
            ...(response !== undefined ? { response } : {}),
            basis: args.basis,
            outcome: args.outcome,
            ...(args.help !== undefined ? { help: args.help } : {}),
            ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
            ...(args.errorType !== undefined ? { errorType: args.errorType } : {}),
          };
        } else {
          if (!isOneOf(SIGNALS, args.signal)) return toolText({ error: `signal is one of ${SIGNALS.join(", ")}.` }, true);
          if (args.note !== undefined && (typeof args.note !== "string" || args.note.length > 2000)) return toolText({ error: "note is what the student said, at most 2000 characters." }, true);
          let note: string | undefined;
          if (args.note !== undefined) {
            const said = await screenText(tools, args.note, 2000, "note");
            if (!said.ok) return toolText({ error: said.error }, true);
            note = said.text ?? undefined;
          }
          entry = { kind: "signal", signal: args.signal, ...(note !== undefined ? { note } : {}) };
        }
        const logged = await tools.logEvidence(args.courseId, args.objectiveId, entry, session);
        return toolText(logged, "error" in logged);
      }
      default:
        return toolText({ error: `Orca doesn't have a tool called "${String(name)}".` }, true);
    }
  } catch (e) {
    // A tool that threw is reported to Claude as the tool's failure, not a protocol error.
    return toolText({ error: e instanceof Error ? e.message : "Orca couldn't do that." }, true);
  }
}

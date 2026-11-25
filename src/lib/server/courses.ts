/**
 * Courses on the server. Creating one (the Canvas import, the connector's set_course) picks the same
 * slug, short name, island look and map spot the app's addCourse picks in the browser
 * (src/lib/store.tsx). Deleting one (2026-11-08) is a soft delete. The row and everything under it stay, stamped
 * with `courses.deleted_at`; `my_data`, `course_structure` and every server lookup of a course
 * leave it out from then on, and its slug is free for a new course. Its unfinished jobs stop.
 */
import { VARIANT_CYCLE, placeIslands } from "@/lib/course/islands";
import { COURSE_NAME_MAX, type CourseSchedule, shortName, slugify } from "@/lib/data";
import { CourseScheduleSchema } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
import { sanitize } from "@/lib/untrusted/sanitize";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { stopCourseRuns } from "./jobs/start";

export type DeleteCourse = { status: 200; body: { deleted: true; stoppedRuns: number } } | { status: 404; body: { error: string } };

export async function deleteCourse(db: OrcaSupabase, ownerId: string, courseId: string, now: () => Date = () => new Date()): Promise<DeleteCourse> {
  const { data, error } = await db
    .from("courses")
    .update({ deleted_at: now().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", courseId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(`Couldn't delete the course: ${error.message}`);
  if (!data.length) return { status: 404, body: { error: "No such course." } };
  const stoppedRuns = await stopCourseRuns(db, ownerId, courseId);
  return { status: 200, body: { deleted: true, stoppedRuns } };
}

/** A name cleaned and cut to COURSE_NAME_MAX, or "" when nothing readable is left. */
export function cleanCourseName(raw: string): string {
  return sanitize(raw, COURSE_NAME_MAX).text.trim().slice(0, COURSE_NAME_MAX).trim();
}

/** Create a course for the student; review settings inherit the account's (null). `name` must already be clean. */
export async function createCourse(db: OrcaSupabase, ownerId: string, name: string, extra: { schedule?: CourseSchedule | null; notes?: string | null } = {}): Promise<{ id: string; slug: string; name: string }> {
  // A slug taken between the read and the insert (two creates at once) breaks the unique index: read again and retry.
  for (let attempt = 0; ; attempt++) {
    const { data: mine, error } = await db.from("courses").select("id, slug").eq("owner_id", ownerId).is("deleted_at", null).order("created_at");
    if (error) throw new Error(`Couldn't read the courses: ${error.message}`);
    const taken = mine.map((c) => c.slug);
    const base = slugify(name) || "course";
    let slug = base;
    for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
    const id = crypto.randomUUID();
    const pos = placeIslands([...mine.map((c) => c.id), id])[mine.length];
    const schedule = extra.schedule ? (CourseScheduleSchema.parse(extra.schedule) as unknown as Json) : null;
    const row = { id, owner_id: ownerId, slug, name, short: shortName(name), variant: VARIANT_CYCLE[mine.length % VARIANT_CYCLE.length], pos_x: pos.x, pos_y: pos.y, trail: null, review_config: null, schedule, orca_notes: extra.notes ?? null };
    const inserted = await db.from("courses").insert(row);
    if (!inserted.error) return { id, slug, name };
    if (inserted.error.code !== "23505" || attempt >= 2) throw new Error(`Couldn't create the course: ${inserted.error.message}`);
  }
}

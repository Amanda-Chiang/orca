/**
 * set_course: create a course from the chat, or change its name, schedule (class times and review
 * days) or Notes for Orca. A new course is made exactly as the Canvas import makes one
 * (`createCourse`: review settings inherit the account's). Notes are cleaned and screened as the
 * course's settings page saves them (PUT /api/course-settings), the hits logged as `orca_notes`.
 */
import type { CourseLine, SetCourseInput } from "@/lib/connector/mcp";
import { NO_SCHEDULE, type CourseSchedule } from "@/lib/data";
import { cleanCourseName, createCourse } from "@/lib/server/courses";
import { screenNotes } from "@/lib/server/notes";
import { CourseScheduleSchema } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** The schedule after the change: parts left out keep the stored ones; a refusal when the result isn't a valid schedule. */
function nextSchedule(stored: CourseSchedule | null, change: Partial<CourseSchedule> | null): { schedule: CourseSchedule | null } | { error: string } {
  if (change === null) return { schedule: null };
  const parsed = CourseScheduleSchema.safeParse({ ...(stored ?? NO_SCHEDULE), ...change });
  if (!parsed.success) return { error: "That schedule isn't valid (a weekday listed twice, or a class that ends before it starts)." };
  return { schedule: parsed.data as CourseSchedule };
}

export async function setCourse(db: OrcaSupabase, ownerId: string, input: SetCourseInput): Promise<CourseLine | { error: string }> {
  const name = input.name === undefined ? undefined : cleanCourseName(input.name);
  if (name === "") return { error: "name has nothing readable in it." };
  let notes: Awaited<ReturnType<typeof screenNotes>> | undefined;
  if (input.notes !== undefined) {
    notes = await screenNotes(db, ownerId, input.notes);
    if (!notes.ok) return { error: notes.error };
  }

  if (input.courseId === undefined) {
    if (name === undefined) return { error: "A new course needs a name." };
    // Asking twice (a retried call) mustn't make two islands: a live course with the same name is refused, with its id.
    const { data: same, error } = await db.from("courses").select("id, name").eq("owner_id", ownerId).is("deleted_at", null).ilike("name", name.replace(/[\\%_]/g, (c) => `\\${c}`));
    if (error) throw new Error(`Couldn't read the courses: ${error.message}`);
    if (same.length > 0) return { error: `There's already a course called ${same[0].name} (courseId ${same[0].id}); pass its courseId to change it.` };
    const next = input.schedule === undefined ? { schedule: null } : nextSchedule(null, input.schedule);
    if ("error" in next) return next;
    const created = await createCourse(db, ownerId, name, { schedule: next.schedule, notes: notes?.ok ? notes.text : null });
    return { ...created, created: true, schedule: next.schedule, notes: notes?.ok ? notes.text : null };
  }

  const { data: course, error } = await db.from("courses").select("id, name, slug, schedule, orca_notes").eq("owner_id", ownerId).eq("id", input.courseId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`Couldn't read the course: ${error.message}`);
  if (!course) return { error: "No such course." };
  const stored = course.schedule === null ? null : CourseScheduleSchema.parse(course.schedule) as CourseSchedule;
  const next = input.schedule === undefined ? { schedule: stored } : nextSchedule(stored, input.schedule);
  if ("error" in next) return next;
  const change = {
    ...(name !== undefined ? { name } : {}),
    ...(input.schedule !== undefined ? { schedule: next.schedule as unknown as Json } : {}),
    ...(notes?.ok ? { orca_notes: notes.text } : {}),
  };
  const updated = await db.from("courses").update(change).eq("owner_id", ownerId).eq("id", course.id).is("deleted_at", null).select("id");
  if (updated.error) throw new Error(`Couldn't save the course: ${updated.error.message}`);
  if (updated.data.length === 0) return { error: "No such course." };
  return { id: course.id, name: name ?? course.name, slug: course.slug, created: false, schedule: next.schedule, notes: notes?.ok ? notes.text : course.orca_notes };
}

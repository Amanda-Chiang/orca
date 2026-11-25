/**
 * Each course's colour, by its order on the map (the `study-*` tokens in globals.css). Shared by the
 * calendar and Your progress so a course looks the same on both. Pure; classes are written out whole so
 * Tailwind sees them.
 */
export interface CourseColor {
  /** A dot or a solid fill. */
  bg: string;
  /** An outline. */
  border: string;
}

export const COURSE_COLORS: readonly CourseColor[] = [
  { bg: "bg-study-sky", border: "border-study-sky" },
  { bg: "bg-study-gold", border: "border-study-gold" },
  { bg: "bg-study-rose", border: "border-study-rose" },
  { bg: "bg-study-mint", border: "border-study-mint" },
  { bg: "bg-study-coral", border: "border-study-coral" },
  { bg: "bg-study-violet", border: "border-study-violet" },
];

/** Course id → its colour, in map order (wrapping after six courses). */
export function courseColors(courses: readonly { id: string }[]): Map<string, CourseColor> {
  return new Map(courses.map((c, i) => [c.id, COURSE_COLORS[i % COURSE_COLORS.length]]));
}

import { NextResponse } from "next/server";
import { renamed } from "@/lib/material/rename";
import { removeMaterial } from "@/lib/server/materials";
import { recordSecurityEvents } from "@/lib/server/security";
import { forStudent, reply } from "@/lib/server/student";

/**
 * DELETE → remove the signed-in student's material from its course: file, pages and calendar entry
 * go, the row stays marked `removed`, the objectives only it taught are archived
 * (`removeMaterial`). 200 { removed: true, archivedObjectives }, 404, or 409 while a job is
 * building from it (stop it first).
 */
export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    const out = await removeMaterial(db, student.id, id);
    return NextResponse.json(out.body, { status: out.status });
  });
}

/**
 * PATCH { name } → rename the signed-in student's material (owner, 2026-11-24): `name` replaces the
 * part before the extension, which stays. Cleaned and screened (`renamed`); a name that tries to
 * instruct the AI is a 400 with the span, and anything the screen flags is logged. 200 { filename },
 * 400, or 404 (not theirs, or removed). Uploads are found by id everywhere, so nothing else changes.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    if (typeof body?.name !== "string") return reply(400, { error: "Send the new name." });
    const { data: m, error } = await db.from("materials").select("id, filename, status").eq("owner_id", student.id).eq("id", id).maybeSingle();
    if (error) throw new Error(`Couldn't read the material: ${error.message}`);
    if (!m || m.status === "removed") return reply(404, { error: "No such material." });
    const out = renamed(m.filename, body.name);
    await recordSecurityEvents(db, student.id, "upload", out.hits);
    if (!out.ok) return reply(400, { error: out.error });
    const saved = await db.from("materials").update({ filename: out.filename }).eq("owner_id", student.id).eq("id", id);
    if (saved.error) throw new Error(`Couldn't rename the material: ${saved.error.message}`);
    return reply(200, { filename: out.filename });
  });
}

import Link from "next/link";
import { AdminPage, Section, Table, Tiles } from "@/components/admin/AdminPage";
import { int, when } from "@/components/admin/format";
import { requireAdmin } from "@/lib/server/admin";
import { APP_FEEDBACK_PAGE, activitySummary, appFeedback } from "@/lib/server/admin-queries";

/** /admin/feedback?offset=n: what students said at the feedback prompts, newest first, with who is active, who dropped off and who came back. Admins only. */
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const SPOT_LABEL: Record<string, string> = {
  "session-end": "After a session",
  "upload-done": "After an upload",
  "practice-test": "After a practice test",
  settings: "From Settings",
};

export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const offsetRaw = Number(first((await searchParams).offset) ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const { db } = await requireAdmin(`/admin/feedback${offset ? `?offset=${offset}` : ""}`);
  const [page, a] = await Promise.all([appFeedback(db, offset), activitySummary(db)]);

  return (
    <AdminPage title="Feedback" current="/admin/feedback">
      <Tiles
        tiles={[
          { label: "Active today", value: int(a.activeToday) },
          { label: "Active, 7 days", value: int(a.active7d) },
          { label: "Came back, 7 days", value: int(a.cameBack7d) },
          { label: "Dropped off (7–30 days)", value: int(a.droppedOff) },
          { label: "Gone 30+ days", value: int(a.gone30d) },
          { label: "Feedback, 7 days", value: int(a.feedback7d) },
          { label: "Feedback, all time", value: int(a.feedbackAll) },
        ]}
      />
      <p className="text-[13px] text-wisteria-deep">Active means the app was open that UTC day (the heartbeat). Came back: active this week after a gap of 7 days or more. Each account&apos;s days and gaps are on its page.</p>
      <Section title="What students said" aside={`from ${int(page.offset + 1)}, newest first`}>
        <Table
          part="admin-app-feedback"
          rows={page.rows}
          rowKey={(f) => f.id}
          empty="No feedback yet."
          columns={[
            { key: "when", label: "When", cell: (f) => when(f.at) },
            { key: "who", label: "Who", cell: (f) => <Link href={`/admin/users/${f.ownerId}`} className="font-semibold underline">{f.name ?? f.email ?? f.ownerId}</Link> },
            { key: "spot", label: "Where", cell: (f) => SPOT_LABEL[f.spot] ?? f.spot },
            { key: "rating", label: "Thumb", cell: (f) => (f.rating === "up" ? "👍" : f.rating === "down" ? "👎" : "—") },
            { key: "note", label: "Note", cell: (f) => f.note ?? "—" },
            { key: "page", label: "Page", cell: (f) => f.page ?? "—" },
          ]}
        />
        <nav aria-label="Pages" className="flex gap-[10px] text-[14px] font-semibold">
          {offset > 0 && <Link href={`/admin/feedback${Math.max(0, offset - APP_FEEDBACK_PAGE) ? `?offset=${Math.max(0, offset - APP_FEEDBACK_PAGE)}` : ""}`} className="underline">Newer</Link>}
          {page.more && <Link href={`/admin/feedback?offset=${offset + APP_FEEDBACK_PAGE}`} className="underline">Older</Link>}
        </nav>
      </Section>
    </AdminPage>
  );
}

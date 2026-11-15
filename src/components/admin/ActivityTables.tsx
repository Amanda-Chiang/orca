import { Table } from "@/components/admin/AdminPage";
import { int } from "@/components/admin/format";
import { type ActivityDay, type KindSummary, type Totals, CONNECTOR_DAY_CAP_MINUTES, KIND_LABELS, STUDY_KINDS, isEmpty } from "@/lib/admin/activity";

/**
 * "What students are doing" (owner, 2026-11-15): sessions, minutes and answers per kind of study, and
 * one student's last 30 days. The connector has no session record: its sessions are days with
 * connector activity and its minutes an estimate, marked "est." and explained under the table.
 */

const minutes = (m: number) => (m > 0 && m < 1 ? "<1" : int(Math.round(m)));

export function ConnectorFootnote() {
  return (
    <p className="text-[13px] text-wisteria-deep">
      est. Claude connector: no session record, so a session is a student&apos;s day with connector activity, and its minutes are the span from that day&apos;s first to last connector event (answers, work, signals, check-me and struggled flags), at most {CONNECTOR_DAY_CAP_MINUTES} a day. Days are UTC.
    </p>
  );
}

export function KindTable({ rows, part }: { rows: KindSummary[]; part: string }) {
  const empty = isEmpty(rows);
  const group = (label: string, key: "today" | "week" | "all") => [
    { key: `${key}-s`, label: `${label} sessions`, num: true, cell: (r: KindSummary) => int(r[key].sessions) },
    { key: `${key}-m`, label: `${label} min`, num: true, cell: (r: KindSummary) => <Minutes r={r} t={r[key]} /> },
    { key: `${key}-a`, label: `${label} answers`, num: true, cell: (r: KindSummary) => int(r[key].answers) },
  ];
  return (
    <>
      <Table
        part={part}
        rows={empty ? [] : rows}
        rowKey={(r) => r.kind}
        empty="No sessions yet."
        columns={[{ key: "kind", label: "Kind", cell: (r) => <span data-kind={r.kind}>{r.label}</span> }, ...group("Today", "today"), ...group("7 days", "week"), ...group("All time", "all")]}
      />
      {!empty && <ConnectorFootnote />}
    </>
  );
}

function Minutes({ r, t }: { r: KindSummary; t: Totals }) {
  return r.kind === "connector" ? (
    <>
      {minutes(t.minutes)} <span className="text-[12px] text-wisteria-deep">est.</span>
    </>
  ) : (
    <>{minutes(t.minutes)}</>
  );
}

export function DayTable({ rows, everything }: { rows: ActivityDay[]; everything: KindSummary[] }) {
  const active = rows.some((d) => d.answers > 0 || STUDY_KINDS.some((k) => d.sessions[k] > 0));
  return (
    <Table
      part="admin-user-activity-days"
      rows={active ? rows : []}
      rowKey={(d) => d.day}
      empty={isEmpty(everything) ? "No sessions yet." : "No sessions in the last 30 days."}
      columns={[
        { key: "day", label: "Day (UTC)", cell: (d) => d.day },
        ...STUDY_KINDS.map((k) => ({ key: k, label: KIND_LABELS[k], num: true, cell: (d: ActivityDay) => int(d.sessions[k]) })),
        { key: "min", label: "Minutes (connector est.)", num: true, cell: (d) => minutes(d.minutes) },
        { key: "answers", label: "Answers", num: true, cell: (d) => int(d.answers) },
      ]}
    />
  );
}

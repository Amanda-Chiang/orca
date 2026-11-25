"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { MATERIAL_TYPES, MATERIAL_TYPE_LABELS, type MaterialType } from "@/lib/data";
import { fadeUp, stagger } from "@/lib/motion";
import { useOrca } from "@/lib/store";
import { cn } from "@/lib/cn";

interface PageLine {
  id: string;
  title: string;
  lastEdited: string;
  materialId: string | null;
}

interface Result {
  pageId: string;
  title: string;
  result: "added" | "duplicate" | "already" | "empty" | "failed";
  materialId: string | null;
  error?: string;
}

type Progress = { kind: "idle" } | { kind: "running" } | { kind: "done"; results: Result[] } | { kind: "failed"; message: string };

/** Import pages from Notion (2026-11-25): the pages shared with the integration, ticked, into a course as material of one type. */
export default function ImportNotionPage() {
  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="px-[28px] pt-[28px]">
        <BackButton />
      </header>
      <Suspense>
        <Body />
      </Suspense>
    </Screen>
  );
}

function Body() {
  const { courses, refresh } = useOrca();
  const wanted = useSearchParams().get("course");
  const [pages, setPages] = useState<PageLine[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  // The course from the link, else the first one, until the student picks another.
  const courseId = picked ?? ((wanted && courses.find((c) => c.slug === wanted)?.id) || courses[0]?.id || "");
  const [type, setType] = useState<MaterialType>("Typed notes");
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/notion/pages", { cache: "no-store" });
      if (!live) return;
      const body = (await res.json().catch(() => null)) as { pages?: PageLine[]; error?: string } | null;
      if (res.status === 409) return setNotConnected(true);
      if (!res.ok || !body?.pages) return setProblem(body?.error ?? "Couldn't read your Notion pages.");
      setPages(body.pages);
      setChosen(new Set(body.pages.filter((p) => !p.materialId).map((p) => p.id)));
    })();
    return () => {
      live = false;
    };
  }, []);

  const fresh = pages?.filter((p) => !p.materialId) ?? [];
  const count = fresh.filter((p) => chosen.has(p.id)).length;
  const toggle = (ids: string[], on: boolean) => {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const run = async () => {
    if (!courseId || count === 0) return;
    setProgress({ kind: "running" });
    const res = await fetch("/api/notion/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, pageIds: fresh.filter((p) => chosen.has(p.id)).map((p) => p.id), type }) });
    const body = (await res.json().catch(() => null)) as { results?: Result[]; error?: string } | null;
    if (!res.ok || !body?.results) return setProgress({ kind: "failed", message: body?.error ?? "Orca couldn't import those pages." });
    await refresh();
    const done = new Map(body.results.map((r) => [r.pageId, r]));
    setPages((ps) => ps?.map((p) => (done.get(p.id)?.materialId ? { ...p, materialId: done.get(p.id)!.materialId } : p)) ?? null);
    setProgress({ kind: "done", results: body.results });
  };

  const typeOptions = MATERIAL_TYPES.filter((t) => t !== "AI chat") as MaterialType[];
  const course = courses.find((c) => c.id === courseId);

  return (
    <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex w-[720px] max-w-full flex-col gap-[16px] px-[72px] pb-[80px] pt-[32px] lg:px-[100px]">
      <motion.span variants={fadeUp} className="eyebrow">
        From Notion
      </motion.span>
      <motion.h1 variants={fadeUp} className="text-[46px] font-bold leading-[1.05] text-prussian">
        Pick the pages
      </motion.h1>
      <motion.p variants={fadeUp} className="max-w-[520px] text-[16px] leading-[1.45] text-prussian">
        Every page you share with the integration is listed. Each one you tick becomes material for the course you pick. Import again any time for what you wrote since.
      </motion.p>

      {notConnected && (
        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[10px] px-[24px] py-[20px]" data-part="notion-not-connected">
            <p className="text-[15px] font-semibold text-prussian">Notion isn&apos;t connected yet.</p>
            <Link href="/settings?section=connections" className="text-[15px] font-bold text-wisteria-deep underline underline-offset-2">
              Connect it in Settings
            </Link>
          </Card>
        </motion.div>
      )}
      {problem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</span>}
      {pages && pages.length === 0 && (
        <p className="text-[15px] text-prussian">No pages are shared with the integration yet. In Notion, on a page: ··· → Connections → add it.</p>
      )}

      {pages && pages.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[12px] px-[22px] py-[18px]" data-part="notion-pages">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <h3 className="text-[15px] font-bold text-prussian">Which pages should Orca read?</h3>
              {fresh.length > 0 && (
                <div className="flex gap-[12px] text-[13px] font-bold text-wisteria-deep">
                  <button type="button" className="underline underline-offset-2" onClick={() => toggle(fresh.map((p) => p.id), true)}>All</button>
                  <button type="button" className="underline underline-offset-2" onClick={() => toggle(fresh.map((p) => p.id), false)}>None</button>
                </div>
              )}
            </div>
            <ul className="flex max-h-[360px] flex-col gap-[4px] overflow-auto">
              {pages.map((p) => (
                <li key={p.id}>
                  <label className={cn("flex items-center gap-[8px] text-[14px] font-medium", p.materialId ? "text-wisteria-deep" : "text-prussian")}>
                    <input type="checkbox" checked={Boolean(p.materialId) || chosen.has(p.id)} disabled={Boolean(p.materialId)} onChange={(e) => toggle([p.id], e.target.checked)} className="accent-wisteria" data-part="notion-page" data-id={p.id} />
                    <span className="truncate">{p.title}</span>
                    <span className="ml-auto shrink-0 text-[12px] font-semibold text-wisteria-deep">{p.materialId ? "already in Orca" : new Date(p.lastEdited).toLocaleDateString()}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-[14px] pt-[4px] text-[13px] font-bold text-prussian">
              <label className="flex items-center gap-[8px]">
                Into
                <Select size="sm" label="Course" value={courseId} options={courses.map((c) => c.id)} labels={Object.fromEntries(courses.map((c) => [c.id, c.name]))} onChange={setPicked} data-part="notion-course" />
              </label>
              <label className="flex items-center gap-[8px]">
                As
                <Select size="sm" label="Material type" value={type} options={typeOptions} labels={MATERIAL_TYPE_LABELS} onChange={setType} data-part="notion-type" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-[10px]">
              <Button size="sm" onClick={() => void run()} disabled={!course || count === 0 || progress.kind === "running"} data-part="notion-import">
                {progress.kind === "running" ? "Importing…" : count === 0 ? "Nothing new to import" : `Import ${count} page${count === 1 ? "" : "s"}${course ? ` into ${course.name}` : ""}`}
              </Button>
              {progress.kind === "failed" && <span role="alert" className="text-[13px] font-semibold text-bad-text">{progress.message}</span>}
            </div>
            {progress.kind === "done" && (
              <ul className="flex flex-col gap-[2px] text-[13px] font-medium text-prussian" data-part="notion-results">
                {progress.results.map((r) => (
                  <li key={r.pageId}>
                    {r.title || r.pageId}: {r.result === "added" ? "added" : r.result === "duplicate" ? "already there (same text)" : r.result === "already" ? "already in Orca" : r.result === "empty" ? "no words to read" : `couldn't be read${r.error ? ` (${r.error})` : ""}`}
                  </li>
                ))}
                {course && (
                  <li className="pt-[4px]">
                    <Link href={`/course/${course.slug}/review?tab=uploads`} className="font-bold text-wisteria-deep underline underline-offset-2">
                      See them on the Uploads tab
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { Material } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { removeMaterial, retryUpload } from "@/lib/uploads";
import { DeleteUploadDialog } from "@/components/review/DeleteUploadDialog";

/**
 * A material that was saved and read but has no job at all (the request that saved it died before
 * one was recorded, 2026-11-05): otherwise invisible on the Uploads tab, which lists jobs. Build
 * starts one, the same call Try again makes; Delete removes it, behind the same pop-up as a built
 * upload's (2026-11-24).
 */
export function UnbuiltCard({ material, slug }: { material: Material; slug: string }) {
  const router = useRouter();
  const { refresh } = useOrca();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteFile = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeMaterial(material.id);
      await refresh();
      setConfirming(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete the file.");
    } finally {
      setDeleting(false);
    }
  };
  const build = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const g = await retryUpload(material.id);
      await refresh();
      if ("runId" in g) router.replace(`/course/${slug}/review?run=${g.runId}`);
      else setProblem(g.state === "no-model" ? "No AI is connected, so nothing can be built from it." : "Orca found no text in it, so there's nothing to build from.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't start the build.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-[8px] px-[20px] py-[16px]" radius={20} lip={5} data-part="unbuilt-card" data-material={material.id}>
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="min-w-0">
          <p className="truncate text-[17px] font-bold text-prussian">{material.filename}</p>
          <p className="text-[13px] font-semibold text-wisteria-deep">Saved and read, but no topics or questions were built from it yet.</p>
        </div>
        <span className="flex shrink-0 items-center gap-[8px]">
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="pressable shrink-0 cursor-pointer rounded-pill bg-bad px-[10px] py-[3px] text-[12px] font-bold text-parchment lip-2 lip-bad disabled:opacity-60" data-part="remove-material">
            Delete
          </button>
          <button type="button" onClick={() => void build()} disabled={busy} className="pressable rounded-pill border-2 border-periwinkle-deep bg-parchment px-[14px] py-[6px] text-[13px] font-bold text-prussian lip-3 lip-periwinkle disabled:opacity-60" data-part="build-material">
            {busy ? "Starting…" : "Build"}
          </button>
        </span>
      </div>
      <DeleteUploadDialog open={confirming} filename={material.filename} built={false} deleting={deleting} error={deleteError} onConfirm={() => void deleteFile()} onClose={() => !deleting && (setConfirming(false), setDeleteError(null))} />
      {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
    </Card>
  );
}

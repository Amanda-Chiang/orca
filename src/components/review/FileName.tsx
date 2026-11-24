"use client";

import { useState } from "react";
import type { Material } from "@/lib/data";
import { NAME_CHARS, splitName } from "@/lib/material/rename";
import { renameMaterial } from "@/lib/uploads";
import { useOrca } from "@/lib/store";

/**
 * An upload's name on its card, with Rename (owner, 2026-11-24): the part before ".pdf", ".pptx" or ".docx" is
 * editable, the extension is shown and kept. Saved through PATCH /api/materials/:id, which screens it.
 */
export function FileName({ material, fallback }: { material: Material | undefined; fallback: string }) {
  const { refresh } = useOrca();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!material) return <span className="text-[17px] font-bold text-prussian">{fallback}</span>;
  const { stem, ext } = splitName(material.filename);

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-[8px]">
        <span className="text-[17px] font-bold text-prussian" data-part="upload-name">{material.filename}</span>
        <button type="button" className="shrink-0 text-[12px] font-bold text-wisteria-deep hover:underline" onClick={() => (setDraft(stem), setProblem(null), setEditing(true))} data-part="rename-upload">
          Rename
        </button>
      </span>
    );
  }

  const save = async () => {
    if (draft.trim() === stem) return setEditing(false);
    setSaving(true);
    setProblem(null);
    try {
      await renameMaterial(material.id, draft);
      await refresh();
      setEditing(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't rename the file.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="flex min-w-0 flex-col gap-[4px]">
      <form
        className="flex min-w-0 items-center gap-[8px]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <span className="flex min-w-0 items-center rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[3px] focus-within:border-wisteria">
          <input
            autoFocus
            aria-label={`New name for ${material.filename}`}
            value={draft}
            maxLength={NAME_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            className="w-[260px] min-w-0 bg-transparent text-[16px] font-bold text-prussian outline-none"
            data-part="rename-input"
          />
          {ext && <span className="shrink-0 text-[16px] font-bold text-prussian/50">{ext}</span>}
        </span>
        <button type="submit" disabled={saving || !draft.trim()} className="text-[13px] font-bold text-wisteria-deep hover:underline disabled:opacity-50" data-part="rename-save">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={saving} className="text-[13px] font-bold text-prussian/60 hover:underline" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
      {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
    </span>
  );
}

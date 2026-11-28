/**
 * Google's Drive picker in the browser (Add material, 2026-11-27). Loads Google's script once, then
 * opens the picker with a short-lived `drive.file` token from `/api/google/picker-token`. Picking a
 * file is what grants Orca access to it (drive.file reaches nothing else).
 */
export interface PickedFile {
  id: string;
  name: string;
}

interface PickerDoc {
  id: string;
  name: string;
}

interface PickerData {
  action: string;
  docs?: PickerDoc[];
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Google's picker has no types in this project. */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

const MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
].join(",");

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => window.gapi.load("picker", { callback: () => resolve(), onerror: () => reject(new Error("Google's file picker didn't load.")) });
    script.onerror = () => reject(new Error("Google's file picker didn't load."));
    document.head.appendChild(script);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The files the student picked; empty when they closed the picker. */
export async function pickDriveFiles(opts: { token: string; apiKey: string; appId: string }): Promise<PickedFile[]> {
  await loadPicker();
  const g = window.google.picker;
  return new Promise((resolve) => {
    // Opens on My Drive's folders, in a list, so a folder of notes is open it, select all (owner,
    // 2026-11-28). drive.file can't read a picked folder's contents, so files are what's picked.
    const folders = new g.DocsView(g.ViewId.DOCS).setParent("root").setIncludeFolders(true).setSelectFolderEnabled(false).setMimeTypes(MIMES).setMode(g.DocsViewMode.LIST).setLabel("My Drive");
    const all = new g.DocsView(g.ViewId.DOCS).setMimeTypes(MIMES).setIncludeFolders(true).setSelectFolderEnabled(false).setLabel("All files");
    const picker = new g.PickerBuilder()
      .addView(folders)
      .addView(all)
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(opts.token)
      .setDeveloperKey(opts.apiKey)
      .setAppId(opts.appId)
      .setTitle("Add from Google Drive")
      .setCallback((data: PickerData) => {
        if (data.action === g.Action.PICKED) resolve((data.docs ?? []).map((d) => ({ id: d.id, name: d.name })));
        else if (data.action === g.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

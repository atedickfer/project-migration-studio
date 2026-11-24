// Browser-side vault access. Row-level rules keep every query scoped to the signed-in user.
import { Zip, ZipPassThrough } from "fflate";
import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { fmtSize, normalizeRoot, sanitize } from "./core";

export type VaultFile = {
  id: string;
  name: string;
  folder: string;
  size: number;
  storage_path: string;
  sizeFmt: string;
};
export type VaultFolder = { name: string; files: number; size: number; sizeFmt: string };
export type VaultTree = { root: string; folders: VaultFolder[]; files: VaultFile[] };

async function fetchVault(rootRaw: string): Promise<VaultTree> {
  const root = normalizeRoot(rootRaw);
  const files: VaultFile[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("vault_files")
      .select("id, name, folder, size, storage_path")
      .eq("root", root)
      .order("folder")
      .order("name")
      .range(from, from + page - 1);
    if (error) throw error;
    for (const r of data ?? []) files.push({ ...r, size: Number(r.size), sizeFmt: fmtSize(Number(r.size)) });
    if (!data || data.length < page) break;
  }
  const byFolder = new Map<string, VaultFolder>();
  for (const f of files) {
    const cur = byFolder.get(f.folder) ?? { name: f.folder, files: 0, size: 0, sizeFmt: "" };
    cur.files++;
    cur.size += f.size;
    byFolder.set(f.folder, cur);
  }
  const folders = [...byFolder.values()].map((f) => ({ ...f, sizeFmt: fmtSize(f.size) }));
  return { root, folders, files };
}

export const vaultQuery = (root: string) =>
  queryOptions({ queryKey: ["vault", normalizeRoot(root)], queryFn: () => fetchVault(root) });

function triggerDownload(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadVaultFile(file: VaultFile): Promise<void> {
  const { data, error } = await supabase.storage
    .from("vault")
    .createSignedUrl(file.storage_path, 600, { download: file.name });
  if (error || !data) throw error ?? new Error("Could not create link");
  triggerDownload(data.signedUrl, file.name);
}

/** Builds a ZIP of one folder in the browser (stored, not recompressed — media is already compressed). */
export async function downloadFolderZip(
  files: VaultFile[],
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!files.length) throw new Error("Folder has no completed files");
  const { data: signed, error } = await supabase.storage.from("vault").createSignedUrls(
    files.map((f) => f.storage_path),
    600,
  );
  if (error || !signed) throw error ?? new Error("Could not create links");

  const parts: Uint8Array[] = [];
  let zipErr: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipErr = err;
    else parts.push(chunk);
  });
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const url = signed[i]?.signedUrl;
    if (!url) continue;
    const entry = new ZipPassThrough(f.name);
    zip.add(entry);
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      entry.push(new Uint8Array(0), true);
      continue;
    }
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      entry.push(value);
    }
    entry.push(new Uint8Array(0), true);
    onProgress?.(i + 1, files.length);
  }
  zip.end();
  if (zipErr) throw zipErr;
  const blob = new Blob(parts as BlobPart[], { type: "application/zip" });
  const href = URL.createObjectURL(blob);
  triggerDownload(href, `${sanitize(folder, "archive")}.zip`);
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

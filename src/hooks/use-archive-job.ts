import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  LIMITS,
  clampInt,
  fmtEta,
  mergeEntries,
  normalizeRoot,
  type MediaFilter,
  type PageEntry,
} from "@/lib/threadarch/core";
import { runPool } from "@/lib/threadarch/pool";
import {
  downloadLink,
  loadLinksFile,
  resolveLink,
  saveLinksFile,
  scrapeThreadPage,
  scrapeThreadStart,
} from "@/lib/threadarch.functions";

export type JobPayload = {
  url: string;
  cookie: string;
  workers: number;
  resolveWorkers: number;
  dlWorkers: number;
  media: MediaFilter;
  outDir: string;
  resume: boolean;
  linksOnly: boolean;
  singlePage: boolean;
  includeQuotes: boolean;
  userAgent: string;
};

export type LogRow = { time: string; tag: string; msg: string };

export type JobState = {
  status: "idle" | "running" | "completed" | "failed";
  stage: string;
  threadTitle: string;
  outDir: string;
  candidatesTotal: number;
  candidatesDone: number;
  resolvedTotal: number;
  dlTotal: number;
  dlDone: number;
  downloaded: number;
  skipped: number;
  errors: number;
  elapsed: string;
  logs: LogRow[];
};

const INITIAL: JobState = {
  status: "idle",
  stage: "QUEUED",
  threadTitle: "",
  outDir: "",
  candidatesTotal: 0,
  candidatesDone: 0,
  resolvedTotal: 0,
  dlTotal: 0,
  dlDone: 0,
  downloaded: 0,
  skipped: 0,
  errors: 0,
  elapsed: "00:00",
  logs: [],
};

const stamp = () => new Date().toTimeString().slice(0, 8);

/** Progress ratio, same formula as the original deck. */
export function jobProgress(j: JobState): number {
  let ratio = 0;
  if (j.stage === "DOWNLOAD" && j.dlTotal > 0) ratio = j.dlDone / j.dlTotal;
  else if (j.candidatesTotal > 0) ratio = (j.candidatesDone / j.candidatesTotal) * (j.dlTotal > 0 ? 0.5 : 1);
  if (j.status === "completed") ratio = 1;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export function useArchiveJob(onFinished?: () => void) {
  const [job, setJob] = useState<JobState>(INITIAL);
  const startedAt = useRef<number>(0);
  const running = job.status === "running";

  const scrapeStart = useServerFn(scrapeThreadStart);
  const scrapePage = useServerFn(scrapeThreadPage);
  const resolve = useServerFn(resolveLink);
  const download = useServerFn(downloadLink);
  const loadLinks = useServerFn(loadLinksFile);
  const saveLinks = useServerFn(saveLinksFile);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setJob((j) => ({ ...j, elapsed: fmtEta((Date.now() - startedAt.current) / 1000) }));
    }, 500);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, [running]);

  const patch = useCallback((p: Partial<JobState> | ((j: JobState) => Partial<JobState>)) => {
    setJob((j) => ({ ...j, ...(typeof p === "function" ? p(j) : p) }));
  }, []);

  const log = useCallback((tag: string, msg: string) => {
    setJob((j) => {
      const logs = [...j.logs, { time: stamp(), tag, msg }];
      return { ...j, logs: logs.length > 250 ? logs.slice(-250) : logs };
    });
  }, []);

  const start = useCallback(
    async (p: JobPayload) => {
      startedAt.current = Date.now();
      setJob({ ...INITIAL, status: "running", stage: "SCRAPE" });
      const workers = clampInt(p.workers, LIMITS.workers.min, LIMITS.workers.max, LIMITS.workers.def);
      const resolveWorkers = clampInt(
        p.resolveWorkers,
        LIMITS.resolveWorkers.min,
        LIMITS.resolveWorkers.max,
        LIMITS.resolveWorkers.def,
      );
      const dlWorkers = clampInt(p.dlWorkers, LIMITS.dlWorkers.min, LIMITS.dlWorkers.max, LIMITS.dlWorkers.def);
      const root = normalizeRoot(p.outDir);
      const net = { cookie: p.cookie, userAgent: p.userAgent };

      try {
        log("SCRAPE", `Hitting thread: ${p.url}`);
        const first = await scrapeStart({
          data: { ...net, url: p.url, singlePage: p.singlePage, includeQuotes: p.includeQuotes },
        });
        if (!first.ok) {
          patch({ status: "failed", stage: "AUTH / LOAD ERR" });
          log("ERR", `Thread load failed (${first.error}) — check pasted cookie / session`);
          return;
        }
        const { title, startPage, lastPage, forumHost, cleanBase } = first;
        log("SCRAPE", `Thread: ${title} | Pages: ${startPage}..${lastPage} (w=${workers})`);
        const pages = new Map<number, PageEntry[]>([[startPage, first.entries]]);
        log("SCRAPE", `Page ${startPage}/${lastPage} -> +${first.entries.length} candidate links`);

        const remaining: number[] = [];
        for (let pg = startPage + 1; pg <= lastPage; pg++) remaining.push(pg);
        await runPool(remaining, workers, async (pg) => {
          try {
            const r = await scrapePage({
              data: { ...net, cleanBase, page: pg, includeQuotes: p.includeQuotes, pageDelay: 0.15 },
            });
            if (!r.ok) throw new Error(r.error);
            pages.set(pg, r.entries);
            log("SCRAPE", `Page ${pg}/${lastPage} -> +${r.entries.length} candidate links`);
          } catch (e) {
            log("WARN", `Page ${pg}/${lastPage} skipped (${(e as Error).message})`);
          }
        });

        const entries = mergeEntries(pages);
        patch({
          threadTitle: title,
          outDir: `${root}/${title}`,
          candidatesTotal: entries.length,
          stage: "RESOLVE",
        });
        log("SCRAPE", `Locked '${title}' — ${entries.length} candidate links`);

        const resolved: { url: string; name?: string }[] = [];
        const seen = new Set<string>();
        if (p.resume) {
          const existing = await loadLinks({ data: { root, folder: title } });
          for (const u of existing.links) {
            if (!seen.has(u)) {
              seen.add(u);
              resolved.push({ url: u });
            }
          }
          if (existing.links.length) log("SCRAPE", `Loaded ${existing.links.length} existing links from links.txt`);
          patch({ resolvedTotal: resolved.length });
        }

        let resolveErrors = 0;
        let done = 0;
        await runPool(entries, resolveWorkers, async (entry, i) => {
          const idx = i + 1;
          let added = 0;
          try {
            const r = await resolve({
              data: { ...net, url: entry.url, passwords: entry.passwords, media: p.media, forumHost },
            });
            if (r.error) throw new Error(r.error);
            for (const f of r.found) {
              if (!seen.has(f.url)) {
                seen.add(f.url);
                resolved.push(f);
                added++;
              }
            }
            if (r.elapsed > 3) log("SLOW", `[${idx}] ${r.elapsed.toFixed(1)}s <- ${entry.url.slice(0, 48)}`);
            else if (added > 0) log("OK", `[${idx}] +${added} <- ${entry.url.slice(0, 48)}`);
          } catch (e) {
            resolveErrors++;
            log("ERR", `[${idx}] ${(e as Error).message.slice(0, 60)}: ${entry.url.slice(0, 50)}`);
          }
          done++;
          patch({ candidatesDone: done, resolvedTotal: resolved.length, errors: resolveErrors });
        });

        if (p.linksOnly) {
          const saved = await saveLinks({ data: { root, folder: title, links: resolved.map((r) => r.url) } });
          patch({ status: "completed", stage: "LINKS READY" });
          log("DONE", `Exported ${saved.count} links to ${saved.root}/${saved.folder}/links.txt`);
          onFinished?.();
          return;
        }

        patch({ stage: "DOWNLOAD", dlTotal: resolved.length, dlDone: 0 });
        log("DL", `Dropping ${resolved.length} files with ${dlWorkers} workers`);

        let dlDone = 0;
        let ok = 0;
        let skip = 0;
        let err = 0;
        await runPool(resolved, dlWorkers, async (item) => {
          try {
            const data: {
              cookie: string;
              userAgent: string;
              url: string;
              root: string;
              folder: string;
              forumHost: string;
              nameHint?: string;
            } = { ...net, url: item.url, root, folder: title, forumHost };
            if (item.name) data.nameHint = item.name;
            const r = await download({ data });
            if (r.status === "downloaded") {
              ok++;
              log("SAVE", `${r.name} (${(r.size / (1024 * 1024)).toFixed(1)} MB)`);
            } else if (r.status === "skipped") {
              skip++;
            } else {
              err++;
              log("ERR", r.message);
            }
          } catch (e) {
            err++;
            log("ERR", `${(e as Error).name}: ${(e as Error).message}`);
          }
          dlDone++;
          patch({ dlDone, downloaded: ok, skipped: skip, errors: resolveErrors + err });
        });

        patch({ status: "completed", stage: "COMPLETED", errors: resolveErrors + err });
        log("DONE", `Finished — ${ok} downloaded, ${skip} skipped, ${resolveErrors + err} errors`);
        onFinished?.();
      } catch (e) {
        patch({ status: "failed", stage: "CRASHED" });
        log("ERR", `${(e as Error).name}: ${(e as Error).message}`);
        onFinished?.();
      } finally {
        setJob((j) => ({ ...j, elapsed: fmtEta((Date.now() - startedAt.current) / 1000) }));
      }
    },
    [scrapeStart, scrapePage, resolve, download, loadLinks, saveLinks, patch, log, onFinished],
  );

  return { job, start };
}

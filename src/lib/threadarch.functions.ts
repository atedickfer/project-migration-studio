import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const netInput = {
  cookie: z.string().max(20000).default(""),
  userAgent: z.string().max(500).default(""),
};

const mediaSchema = z.enum(["all", "image", "video"]).default("all");

/** Loads the first thread page: title, page range and its media links. */
export const scrapeThreadStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      ...netInput,
      url: z.string().url().max(2000),
      singlePage: z.boolean().default(false),
      includeQuotes: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { makeCtx, getWithRetry, finalUrl } = await import("./threadarch/net.server");
    const { parseHtml, parsePageEntries, detectLastPage, extractThreadTitle, extractBlockMessage } =
      await import("./threadarch/parse");
    const { threadBase, pageUrlFor, LIMITS } = await import("./threadarch/core");

    const forumHost = new URL(data.url).hostname.toLowerCase();
    const ctx = makeCtx({ cookie: data.cookie, userAgent: data.userAgent, forumHost });
    const cleanBase = threadBase(data.url);
    const startMatch = /\/page-(\d+)/.exec(data.url);
    const startPage = data.singlePage && startMatch ? parseInt(startMatch[1]!, 10) : 1;
    const initialUrl = data.singlePage ? data.url : pageUrlFor(cleanBase, startPage);

    const r = await getWithRetry(ctx, initialUrl, {
      retries: 2,
      backoff: 0.8,
      retry403: true,
      headers: { Referer: `${cleanBase}/` },
      timeoutMs: 12000,
    });
    const html = await r.text();
    const $ = parseHtml(html);
    if (r.status !== 200) {
      const notice = extractBlockMessage($);
      return { ok: false as const, error: `HTTP ${r.status}${notice ? ` — ${notice}` : ""}` };
    }
    const effective = finalUrl(r, initialUrl);
    const title = extractThreadTitle($);
    const lastPage = data.singlePage ? startPage : detectLastPage($, cleanBase, startPage, LIMITS.maxPages);
    const entries = parsePageEntries($, effective, data.includeQuotes);
    return { ok: true as const, title, startPage, lastPage, entries, forumHost, cleanBase };
  });

/** Loads one more thread page and returns its media links. */
export const scrapeThreadPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      ...netInput,
      cleanBase: z.string().url().max(2000),
      page: z.number().int().min(1).max(500),
      includeQuotes: z.boolean().default(false),
      pageDelay: z.number().min(0).max(10).default(0.15),
    }),
  )
  .handler(async ({ data }) => {
    const { makeCtx, getWithRetry, finalUrl } = await import("./threadarch/net.server");
    const { parseHtml, parsePageEntries } = await import("./threadarch/parse");
    const { pageUrlFor } = await import("./threadarch/core");
    const forumHost = new URL(data.cleanBase).hostname.toLowerCase();
    const ctx = makeCtx({ cookie: data.cookie, userAgent: data.userAgent, forumHost });
    if (data.pageDelay > 0) {
      await new Promise((r) => setTimeout(r, (data.pageDelay + 0.02 + Math.random() * 0.1) * 1000));
    }
    const pageUrl = pageUrlFor(data.cleanBase, data.page);
    const r = await getWithRetry(ctx, pageUrl, {
      retries: 2,
      backoff: 0.8,
      retry403: true,
      headers: { Referer: `${data.cleanBase}/` },
      timeoutMs: 12000,
    });
    if (r.status !== 200) {
      await r.body?.cancel();
      return { ok: false as const, error: `HTTP ${r.status}` };
    }
    const $ = parseHtml(await r.text());
    return { ok: true as const, entries: parsePageEntries($, finalUrl(r, pageUrl), data.includeQuotes) };
  });

/** Expands one candidate link (Gofile, Redgifs, Pixeldrain, image hosts, direct media). */
export const resolveLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      ...netInput,
      url: z.string().max(4000),
      passwords: z.array(z.string().max(500)).max(100).default([]),
      media: mediaSchema,
      forumHost: z.string().max(255).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const { makeCtx, resolveCandidate } = await import("./threadarch/net.server");
    const ctx = makeCtx(data);
    const t0 = Date.now();
    try {
      const found = await resolveCandidate(ctx, data.url, data.passwords, data.media);
      return { found, elapsed: (Date.now() - t0) / 1000, error: null as string | null };
    } catch (e) {
      const err = e as Error;
      return { found: [], elapsed: (Date.now() - t0) / 1000, error: `${err.name}: ${err.message}` };
    }
  });

/** Downloads one resolved link into the signed-in user's private vault. */
export const downloadLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      ...netInput,
      url: z.string().url().max(4000),
      root: z.string().max(200),
      folder: z.string().max(200),
      nameHint: z.string().max(300).optional(),
      forumHost: z.string().max(255).default(""),
    }),
  )
  .handler(async ({ data, context }) => {
    const { makeCtx, downloadToVault } = await import("./threadarch/net.server");
    const { normalizeRoot, sanitize } = await import("./threadarch/core");
    const ctx = makeCtx(data);
    const opts: { url: string; root: string; folder: string; nameHint?: string } = {
      url: data.url,
      root: normalizeRoot(data.root),
      folder: sanitize(data.folder, "Performer"),
    };
    if (data.nameHint) opts.nameHint = data.nameHint;
    return downloadToVault(ctx, context.supabase, context.userId, opts);
  });

const folderInput = z.object({ root: z.string().max(200), folder: z.string().max(200) });

/** Reads links.txt for a thread folder (used by Resume). */
export const loadLinksFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(folderInput)
  .handler(async ({ data, context }) => {
    const { normalizeRoot, sanitize } = await import("./threadarch/core");
    const { data: rows } = await context.supabase
      .from("vault_files")
      .select("storage_path")
      .eq("root", normalizeRoot(data.root))
      .eq("folder", sanitize(data.folder, "Performer"))
      .eq("name", "links.txt")
      .limit(1);
    const row = rows?.[0];
    if (!row) return { links: [] as string[] };
    const { data: blob } = await context.supabase.storage.from("vault").download(row.storage_path);
    if (!blob) return { links: [] as string[] };
    const text = await blob.text();
    const links = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l)))];
    return { links };
  });

/** Writes links.txt into a thread folder (Links Only mode). */
export const saveLinksFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(folderInput.extend({ links: z.array(z.string().max(4000)).max(50000) }))
  .handler(async ({ data, context }) => {
    const { normalizeRoot, sanitize } = await import("./threadarch/core");
    const root = normalizeRoot(data.root);
    const folder = sanitize(data.folder, "Performer");
    const body = data.links.length ? `${data.links.join("\n")}\n` : "";
    const bytes = new TextEncoder().encode(body);
    const { data: rows } = await context.supabase
      .from("vault_files")
      .select("id, storage_path")
      .eq("root", root)
      .eq("folder", folder)
      .eq("name", "links.txt")
      .limit(1);
    const existing = rows?.[0];
    const storagePath = existing?.storage_path ?? `${context.userId}/${crypto.randomUUID()}.txt`;
    const { error } = await context.supabase.storage
      .from("vault")
      .upload(storagePath, bytes, { contentType: "text/plain; charset=utf-8", upsert: true });
    if (error) throw new Error(error.message);
    if (existing) {
      await context.supabase.from("vault_files").update({ size: bytes.byteLength }).eq("id", existing.id);
    } else {
      const { error: insErr } = await context.supabase.from("vault_files").insert({
        user_id: context.userId,
        root,
        folder,
        name: "links.txt",
        storage_path: storagePath,
        size: bytes.byteLength,
        content_type: "text/plain",
      });
      if (insErr) throw new Error(insErr.message);
    }
    return { count: data.links.length, root, folder };
  });

// Server-only network code: forum fetches, host resolvers, and vault downloads.
// Ported from xfdl.py's Downloader class.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import {
  DEFAULT_UA,
  DIRECT_HOST_MARKERS,
  canonicalizeUrl,
  matchesMediaFilter,
  mediaKind,
  parseCookieInput,
  rewriteKnownHost,
  sanitize,
  type MediaFilter,
} from "./core";
import { parseHtml } from "./parse";

export type FetchCtx = {
  cookie: string; // cleaned Cookie header, sent only to the forum host
  forumHost: string;
  userAgent: string;
};

export function makeCtx(input: { cookie?: string; userAgent?: string; forumHost?: string }): FetchCtx {
  return {
    cookie: parseCookieInput(input.cookie ?? ""),
    forumHost: (input.forumHost ?? "").toLowerCase(),
    userAgent: (input.userAgent ?? "").replace(/[\r\n]+/g, "").trim() || DEFAULT_UA,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRIVATE_HOST_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?|\[?fe80:[0-9a-f:]*\]?|metadata\.google\.internal)$/i;

/** Only public http(s) targets may be fetched. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) links are allowed");
  if (PRIVATE_HOST_RE.test(u.hostname)) throw new Error("Private network addresses are not allowed");
  return u;
}

function hostMatches(host: string, forumHost: string): boolean {
  if (!forumHost) return false;
  const h = host.toLowerCase();
  return h === forumHost || h.endsWith(`.${forumHost}`);
}

type SafeFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | undefined;
  timeoutMs?: number;
};

/** fetch() that validates every redirect hop and only sends the forum cookie to the forum. */
export async function safeFetch(ctx: FetchCtx, url: string, init: SafeFetchInit = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = assertPublicUrl(current);
    const headers = new Headers({
      "User-Agent": ctx.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...init.headers,
    });
    if (ctx.cookie && hostMatches(u.hostname, ctx.forumHost)) headers.set("Cookie", ctx.cookie);
    // Timeout covers connecting + response headers only, so long downloads can keep streaming.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Timed out")), init.timeoutMs ?? 15000);
    let res: Response;
    try {
      const reqInit: RequestInit = {
        method: init.method ?? "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      };
      if (init.body !== undefined) reqInit.body = init.body;
      res = await fetch(u.href, reqInit);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, u.href).href;
      await res.body?.cancel();
      if (res.status === 303) init = { ...init, method: "GET", body: undefined };
      continue;
    }
    Object.defineProperty(res, "finalUrl", { value: u.href });
    return res;
  }
  throw new Error("Too many redirects");
}

export function finalUrl(res: Response, fallback: string): string {
  return (res as Response & { finalUrl?: string }).finalUrl ?? fallback;
}

export async function getWithRetry(
  ctx: FetchCtx,
  url: string,
  opts: { retries?: number; backoff?: number; retry403?: boolean } & SafeFetchInit = {},
): Promise<Response> {
  const { retries = 2, backoff = 0.5, retry403 = false, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await safeFetch(ctx, url, init);
      const shouldRetry = res.status === 429 || res.status >= 500 || (retry403 && res.status === 403);
      if (shouldRetry && attempt < retries - 1) {
        await res.body?.cancel();
        await sleep((backoff * 2 ** attempt + 0.05 + Math.random() * 0.15) * 1000);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) {
        await sleep((backoff * 2 ** attempt + 0.05 + Math.random() * 0.15) * 1000);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Gofile ----------
// Best-effort per-instance cache; a fresh guest token is created when it is missing.
let gofileGuestToken: string | null = null;
let redgifsToken: { token: string; at: number } | null = null;

async function gofileToken(ctx: FetchCtx): Promise<string | null> {
  const fromEnv = (process.env["GOFILE_TOKEN"] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (gofileGuestToken) return gofileGuestToken;
  try {
    const r = await safeFetch(ctx, "https://api.gofile.io/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 8000,
    });
    if (!r.ok) return null;
    const payload = (await r.json()) as { data?: { token?: string } };
    gofileGuestToken = payload.data?.token ?? null;
    return gofileGuestToken;
  } catch {
    return null;
  }
}

async function gofileWt(ua: string, token: string, offset = 0): Promise<string> {
  const window = Math.floor(Date.now() / 1000 / 14400) + offset;
  const salt = (process.env["GOFILE_WT_SALT"] ?? "").trim();
  return sha256Hex(salt ? `${ua}::${token}::${window}::${salt}` : `${ua}::${token}::${window}`);
}

type Found = { url: string; name?: string };
type GofileNode = {
  status?: string;
  _http_status?: number;
  data?: { children?: Record<string, { type?: string; id?: string; name?: string; link?: string; directLink?: string; downloadLink?: string }> };
};

async function resolveGofile(ctx: FetchCtx, url: string, passwords: string[]): Promise<Found[]> {
  const m = /gofile\.io\/d\/([^/?#]+)/.exec(url);
  if (!m) return [];
  const token = await gofileToken(ctx);
  if (!token) return [];

  const fetchContent = async (contentId: string, pwHash?: string): Promise<GofileNode> => {
    let offset = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const params = new URLSearchParams({
        contentFilter: "",
        page: "1",
        pageSize: "1000",
        sortField: "createTime",
        sortDirection: "-1",
      });
      if (pwHash) params.set("password", pwHash);
      const r = await getWithRetry(ctx, `https://api.gofile.io/contents/${contentId}?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Website-Token": await gofileWt(ctx.userAgent, token, offset),
          Referer: "https://gofile.io/",
          Origin: "https://gofile.io",
          Cookie: `accountToken=${token}`,
        },
        timeoutMs: 8000,
      });
      if (r.status === 429) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as GofileNode;
      if (data.status === "error-rateLimit") {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (data.status === "error-notPremium" && offset === 0) {
        offset = -1;
        continue;
      }
      return data;
    }
    return {};
  };

  let data: GofileNode;
  try {
    data = await fetchContent(m[1]!);
  } catch {
    return [];
  }
  let activePw: string | undefined;
  if (data.status === "error-passwordRequired") {
    for (const pw of passwords) {
      const h = await sha256Hex(String(pw));
      try {
        const attempt = await fetchContent(m[1]!, h);
        if (attempt.status === "ok") {
          data = attempt;
          activePw = h;
          break;
        }
      } catch {
        /* next password */
      }
    }
  }

  const results: Found[] = [];
  const visited = new Set<string>();
  const walk = async (node: GofileNode): Promise<void> => {
    if (node.status !== "ok") return;
    const children = node.data?.children;
    if (!children || typeof children !== "object") return;
    for (const child of Object.values(children)) {
      if (child.type === "file") {
        const link = child.directLink || child.link || child.downloadLink;
        if (link) results.push(child.name ? { url: link, name: child.name } : { url: link });
      } else if (child.type === "folder" && child.id && !visited.has(child.id) && visited.size < 25) {
        visited.add(child.id);
        await sleep(100);
        try {
          await walk(await fetchContent(child.id, activePw));
        } catch {
          /* skip folder */
        }
      }
    }
  };
  await walk(data);
  return results;
}

// ---------- Redgifs (the source referenced resolve_redgifs but never defined it) ----------
async function resolveRedgifs(ctx: FetchCtx, url: string): Promise<Found[]> {
  const m = /redgifs\.com\/(?:watch|ifr|i)\/([a-z0-9]+)/i.exec(url);
  if (!m) return mediaKind(url) ? [{ url }] : [];
  const id = m[1]!.toLowerCase();
  if (!redgifsToken || Date.now() - redgifsToken.at > 20 * 60 * 1000) {
    const r = await safeFetch(ctx, "https://api.redgifs.com/v2/auth/temporary", { timeoutMs: 8000 });
    if (!r.ok) return [];
    const t = (await r.json()) as { token?: string };
    if (!t.token) return [];
    redgifsToken = { token: t.token, at: Date.now() };
  }
  const r = await safeFetch(ctx, `https://api.redgifs.com/v2/gifs/${id}`, {
    headers: { Authorization: `Bearer ${redgifsToken.token}`, Accept: "application/json" },
    timeoutMs: 8000,
  });
  if (r.status === 401) redgifsToken = null;
  if (!r.ok) return [];
  const j = (await r.json()) as { gif?: { urls?: { hd?: string; sd?: string } } };
  const link = j.gif?.urls?.hd || j.gif?.urls?.sd;
  return link ? [{ url: link, name: `${id}.mp4` }] : [];
}

async function scrapeAnchor(ctx: FetchCtx, url: string, selector: string): Promise<Found[]> {
  try {
    const r = await getWithRetry(ctx, url, { retries: 1, timeoutMs: 6000 });
    const $ = parseHtml(await r.text());
    const href = $(selector).first().attr("href");
    return href ? [{ url: href }] : [];
  } catch {
    return [];
  }
}

/** Resolve a candidate link to one or more direct downloadable links. */
export async function resolveUrl(ctx: FetchCtx, url: string, passwords: string[]): Promise<Found[]> {
  const low = url.toLowerCase();
  if (low.includes("gofile.io/d/")) return resolveGofile(ctx, url, passwords);
  if (low.includes("redgifs.com/")) return resolveRedgifs(ctx, url);
  const rewritten = rewriteKnownHost(url);
  if (rewritten) return rewritten.map((u) => ({ url: u }));
  if (low.includes("ibb.co/") && !low.includes("/album/") && !low.startsWith("https://i.ibb.co")) {
    return scrapeAnchor(ctx, url, ".header-content-right > a");
  }
  if (low.includes("postimg.cc/") || low.includes("pixxxels.cc/")) {
    const u = url.replace(/https?:\/\/(www\.)?i\.?(postimg|pixxxels)\.cc\/(.{8}).*/, "https://postimg.cc/$3");
    return scrapeAnchor(ctx, u, ".controls > nobr > a");
  }
  if (DIRECT_HOST_MARKERS.some((d) => low.includes(d))) return [{ url }];
  if (mediaKind(url)) return [{ url }];
  return [];
}

export async function resolveCandidate(
  ctx: FetchCtx,
  url: string,
  passwords: string[],
  media: MediaFilter,
): Promise<Found[]> {
  const found = await resolveUrl(ctx, url, passwords);
  const out: Found[] = [];
  for (const f of found) {
    const canon = canonicalizeUrl(f.url, url) || f.url;
    if (canon && matchesMediaFilter(canon, media)) out.push(f.name ? { url: canon, name: f.name } : { url: canon });
  }
  return out;
}

// ---------- Download into the vault ----------

export type DownloadResult =
  | { status: "downloaded"; name: string; size: number }
  | { status: "skipped"; name: string; reason: string }
  | { status: "error"; message: string };

function nameFromHeaders(res: Response): string | null {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;\r\n]+)/i.exec(cd) ?? /filename="?([^";\r\n]+)"?/i.exec(cd);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

function basenameOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return decodeURIComponent(p.slice(p.lastIndexOf("/") + 1));
  } catch {
    return "";
  }
}

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

const BUFFER_CAP = 100 * 1024 * 1024;

type FixedLengthStreamCtor = new (len: number) => TransformStream<Uint8Array, Uint8Array>;

async function bodyForUpload(res: Response, total: number): Promise<{ body: ReadableStream<Uint8Array> | ArrayBuffer; size: number }> {
  const FLS = (globalThis as unknown as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  if (total > 0 && FLS && res.body) {
    const { readable, writable } = new FLS(total);
    void res.body.pipeTo(writable).catch(() => {});
    return { body: readable, size: total };
  }
  // Unknown length (or no streaming helper): buffer with a cap.
  const reader = res.body?.getReader();
  if (!reader) return { body: new ArrayBuffer(0), size: 0 };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BUFFER_CAP) {
      await reader.cancel();
      throw new Error("File too large without a known size (over 100 MB)");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { body: out.buffer, size };
}

export async function downloadToVault(
  ctx: FetchCtx,
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { url: string; root: string; folder: string; nameHint?: string },
): Promise<DownloadResult> {
  const { url, root, folder } = opts;
  const low = url.toLowerCase();

  // Resume: same link already saved in this folder.
  const { data: existing } = await supabase
    .from("vault_files")
    .select("name")
    .eq("root", root)
    .eq("folder", folder)
    .eq("source_url", url)
    .limit(1);
  if (existing && existing.length) return { status: "skipped", name: existing[0]!.name, reason: "Already exists" };

  const headers: Record<string, string> = { Referer: url };
  if (low.includes("pomf2")) headers["Referer"] = "https://pomf2.lain.la/";
  else if (low.includes("redgifs.com")) {
    headers["Referer"] = "https://www.redgifs.com/";
    headers["Origin"] = "https://www.redgifs.com";
  }

  let res: Response;
  try {
    res = await safeFetch(ctx, url, { headers: { ...headers, Accept: "*/*" }, timeoutMs: 30000 });
  } catch (e) {
    return { status: "error", message: `${(e as Error).name}: ${(e as Error).message}` };
  }
  if (res.status >= 400) {
    await res.body?.cancel();
    return { status: "error", message: `HTTP ${res.status} - ${url.slice(0, 75)}` };
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("text/html")) {
    await res.body?.cancel();
    return { status: "error", message: `HTML gate skipped - ${url.slice(0, 75)}` };
  }
  const resolved = finalUrl(res, url);
  let fname = sanitize(opts.nameHint || nameFromHeaders(res) || basenameOf(resolved) || "file");

  const nameTaken = async (n: string) => {
    const { data } = await supabase
      .from("vault_files")
      .select("id")
      .eq("root", root)
      .eq("folder", folder)
      .eq("name", n)
      .limit(1);
    return !!(data && data.length);
  };
  if (await nameTaken(fname)) {
    const [stem, ext] = splitExt(fname);
    const tagged = `${stem || "file"}_${(await sha1Hex(resolved)).slice(0, 8)}${ext}`;
    if (await nameTaken(tagged)) {
      await res.body?.cancel();
      return { status: "skipped", name: tagged, reason: "Already exists" };
    }
    fname = tagged;
  }

  const total = parseInt(res.headers.get("content-length") ?? "0", 10) || 0;
  const [, ext] = splitExt(fname);
  const storagePath = `${userId}/${crypto.randomUUID()}${ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12)}`;
  const contentType = ct.split(";")[0]!.trim() || "application/octet-stream";

  let size = 0;
  try {
    const prepared = await bodyForUpload(res, total);
    size = prepared.size;
    const { error } = await supabase.storage.from("vault").upload(storagePath, prepared.body, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    return { status: "error", message: `${(e as Error).name}: ${(e as Error).message}` };
  }

  const { error: insErr } = await supabase.from("vault_files").insert({
    user_id: userId,
    root,
    folder,
    name: fname,
    storage_path: storagePath,
    source_url: url,
    size,
    content_type: contentType,
  });
  if (insErr) {
    await supabase.storage.from("vault").remove([storagePath]);
    if (insErr.code === "23505") return { status: "skipped", name: fname, reason: "Already exists" };
    return { status: "error", message: insErr.message };
  }
  return { status: "downloaded", name: fname, size };
}

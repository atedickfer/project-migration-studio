// Pure helpers ported from xfdl.py. Shared by the browser and server code; no I/O here.

export const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".jpe", ".svg", ".tif", ".tiff", ".jif",
]);
export const VIDEO_EXTS = new Set([
  ".mpeg", ".avchd", ".webm", ".mpv", ".swf", ".avi", ".m4p", ".wmv",
  ".mp2", ".m4v", ".qt", ".mpe", ".mp4", ".flv", ".mov", ".mpg", ".ogg", ".mkv",
]);
export const ARCHIVE_EXTS = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"]);

export const NOISE_IMG_RE =
  /(?:\/smilies\/|\/emojis\/|\/avatars\/|\/data\/avatars\/|\/styles\/.*\/xenforo\/|reaction|badge|icon|sprite|spacer|pixel|loading|spinner)/i;

export const LAZY_ATTRS = [
  "data-url",
  "data-src",
  "data-lazy-src",
  "data-zoom-src",
  "data-full-url",
  "data-original",
  "data-lb-sidebar-href",
  "data-lb-caption-href",
  "href",
  "src",
] as const;

export const RAW_URL_RE = /(?:https?|hxxps?|h\*\*ps?):(?:\/\/|\[\/\/\])[^\s<>"']+/gi;
const DEFANG_DOT_RE = /(?:\[\.\]|\(\.\)|\{\.\})/g;
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "referrer", "fbclid", "gclid",
]);

/** Job option limits, same as the original deck. */
export const LIMITS = {
  workers: { min: 1, max: 8, def: 4 },
  resolveWorkers: { min: 1, max: 12, def: 6 },
  dlWorkers: { min: 1, max: 12, def: 6 },
  maxPages: 500,
} as const;

export function clampInt(value: unknown, min: number, max: number, def: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n === 0) return def;
  return Math.max(min, Math.min(max, n));
}

export type MediaFilter = "all" | "image" | "video";

export function stripChars(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s.charAt(start))) start++;
  while (end > start && chars.includes(s.charAt(end - 1))) end--;
  return s.slice(start, end);
}

export function fmtSize(numBytes: number): string {
  if (numBytes >= 1024 * 1024) return `${(numBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.floor(numBytes / 1024))} KB`;
}

export function fmtEta(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) return "--:--";
  const secs = Math.floor(seconds);
  if (secs < 60) return `00:${String(secs).padStart(2, "0")}`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h${String(mins % 60).padStart(2, "0")}m`;
}

export function sanitize(name: unknown, fallback = "file"): string {
  // eslint-disable-next-line no-control-regex
  let s = String(name ?? "").trim().replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "-");
  s = stripChars(s.replace(/\s+/g, " "), ". ");
  return (s || fallback).slice(0, 180);
}

/** Output folder ("./downloads") → a safe vault root name. */
export function normalizeRoot(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => sanitize(p, ""))
    .filter(Boolean)
    .join("/");
  return (cleaned || "downloads").slice(0, 120);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function urlExt(url: string): string {
  const clean = safeDecode(String(url ?? "")).toLowerCase().split("?")[0]!.split("#")[0]!;
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export function mediaKind(url: string): "image" | "video" | null {
  const ext = urlExt(url);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

export function matchesMediaFilter(url: string, filter: MediaFilter): boolean {
  if (filter === "all") return true;
  const kind = mediaKind(url);
  if (kind) return kind === filter;
  if (ARCHIVE_EXTS.has(urlExt(url))) return false;
  return true;
}

/** Accepts a Cookie header string or a Netscape cookies.txt export. */
export function parseCookieInput(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (!text.includes("# Netscape HTTP Cookie File") && !text.includes("\t")) {
    return text.replace(/[\r\n]+/g, "").trim();
  }
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith("# comment")) continue;
    if (s.startsWith("#HttpOnly_")) s = s.slice("#HttpOnly_".length);
    if (s.startsWith("#")) continue;
    const parts = s.split(/\s+/);
    if (parts.length >= 7) {
      const name = parts[5]!;
      const value = parts[6]!;
      if (name && !seen.has(name)) {
        seen.add(name);
        pairs.push(`${name}=${value}`);
      }
    }
  }
  return pairs.join("; ");
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
};
function htmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1]?.toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return HTML_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

export function normalizeDefangedUrl(raw: unknown): string {
  let s = htmlUnescape(String(raw ?? "")).trim();
  if (!s) return "";
  s = s.replace(/^hxxps?:\/\//i, (m) => (m.toLowerCase().startsWith("hxxps") ? "https://" : "http://"));
  s = s.replace(/^h\*\*ps?:\/\//i, (m) => (m.toLowerCase().startsWith("h**ps") ? "https://" : "http://"));
  s = s.split("[//]").join("//");
  s = s.replace(DEFANG_DOT_RE, ".");
  s = s.replace(/[).,;!?\]}>"']+$/, "");
  return s.trim();
}

function tryUrl(u: string, base?: string): URL | null {
  try {
    return base ? new URL(u, base) : new URL(u);
  } catch {
    return null;
  }
}

export function canonicalizeUrl(url: unknown, baseUrl = ""): string {
  let cleaned = normalizeDefangedUrl(url);
  if (!cleaned) return "";
  if (cleaned.startsWith("//")) {
    const scheme = (tryUrl(baseUrl)?.protocol ?? "https:").replace(":", "") || "https";
    cleaned = `${scheme}:${cleaned}`;
  } else if (baseUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned)) {
    const joined = tryUrl(cleaned, baseUrl);
    if (joined) cleaned = joined.href;
  }
  cleaned = cleaned.split("#")[0]!.trim();

  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/.exec(cleaned);
  if (!m) return cleaned;
  const scheme = m[1]!.toLowerCase();
  const netloc = m[2]!.toLowerCase();
  if ((scheme !== "http" && scheme !== "https") || !netloc) return cleaned;
  const path = m[3]!.replace(/\/{2,}/g, "/") || "/";
  const query = m[4] ?? "";
  const kept = query
    .split("&")
    .filter((pair) => pair && !TRACKING_PARAMS.has(pair.split("=", 1)[0]!.toLowerCase()));
  return `${scheme}://${netloc}${path}${kept.length ? `?${kept.join("&")}` : ""}`;
}

export function pickBestSrcset(srcset: string | undefined | null, baseUrl = ""): string {
  if (!srcset) return "";
  let bestUrl = "";
  let bestScore = -1;
  for (const item of String(srcset).split(",")) {
    const parts = item.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const candidate = canonicalizeUrl(parts[0], baseUrl);
    if (!candidate) continue;
    let score = 1;
    if (parts.length > 1) {
      const desc = parts[1]!.toLowerCase();
      const mw = /^(\d+(?:\.\d+)?)w$/.exec(desc);
      const mx = /^(\d+(?:\.\d+)?)x$/.exec(desc);
      if (mw) score = parseFloat(mw[1]!);
      else if (mx) score = parseFloat(mx[1]!) * 1000;
    }
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = candidate;
    }
  }
  return bestUrl;
}

function b64decode(s: string): string | null {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Unwraps forum /redirect?to=... and link-proxy wrappers (plain or base64). */
export function decodeRedirect(href: string, baseUrl: string): string {
  const u = tryUrl(href, baseUrl);
  if (!u) return href;
  const p = u.pathname.toLowerCase();
  if (!(p.startsWith("/redirect") || p.includes("link-proxy"))) return href;
  const qs = u.searchParams;
  const key = ["to", "url", "u", "link", "target"].find((k) => qs.get(k));
  const to = key ? qs.get(key)! : null;
  if (!to) return href;
  const mode = (qs.get("m") ?? "").toLowerCase();
  let decoded: string | null = null;
  if (mode === "b64" || mode === "base64" || (/^[A-Za-z0-9+/_-]+={0,2}$/.test(to) && to.length >= 16)) {
    let pad = to.replace(/-/g, "+").replace(/_/g, "/");
    pad += "=".repeat((4 - (pad.length % 4)) % 4);
    decoded = b64decode(pad);
  }
  if (!decoded) decoded = to;
  if (decoded.toLowerCase().includes("%3a%2f%2f")) decoded = safeDecode(decoded);
  return /^https?:\/\//.test(decoded) ? decoded : href;
}

/** Strips a pasted markdown link or surrounding quotes from the thread URL input. */
export function cleanThreadInput(raw: string): string {
  const s = raw.trim();
  const md = /^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/.exec(s);
  return md ? md[1]! : stripChars(s, "<>\"'");
}

export function threadBase(threadUrl: string): string {
  return threadUrl.split("#")[0]!.split("?")[0]!.replace(/\/page-\d+\/?$/, "").replace(/\/+$/, "");
}

export function pageUrlFor(cleanBase: string, page: number): string {
  return page === 1 ? `${cleanBase}/` : `${cleanBase}/page-${page}`;
}

/** Fast rewrites for hosts that need no network call (pixeldrain, pixhost, imgbox, direct media). */
export function rewriteKnownHost(url: string): string[] | null {
  const low = url.toLowerCase();
  if (/(pixeldrain\.com|pixeldrain\.net|pixeldra\.in)\/[lu]\//.test(low)) {
    const u = url.replace("/u/", "/api/file/").replace("/l/", "/api/list/");
    return [u.includes("/api/list") ? `${u}/zip` : `${u}?download`];
  }
  if (low.includes("pixhost.to/") && !low.includes("/gallery/")) {
    return [url.replace(/\/t(\d+)\./i, "/img$1.").replace("thumbs/", "images/")];
  }
  if (low.includes("imgbox.com/") && !low.includes("/g/")) {
    return [url.replace(/_t\./i, "_o.").replace("thumbs", "images")];
  }
  return null;
}

export const DIRECT_HOST_MARKERS = [
  "i.ibb.co/",
  "twimg.com/",
  "redd.it/",
  "pomf2.lain.la/",
  "/attachments/",
  "/data/video/",
];

export type PageEntry = { url: string; passwords: string[] };

/** Merge per-page entries in page order, deduping URLs and merging their passwords. */
export function mergeEntries(pages: Map<number, PageEntry[]>): PageEntry[] {
  const out: PageEntry[] = [];
  const idx = new Map<string, number>();
  for (const p of [...pages.keys()].sort((a, b) => a - b)) {
    for (const e of pages.get(p) ?? []) {
      const at = idx.get(e.url);
      if (at === undefined) {
        idx.set(e.url, out.length);
        out.push({ url: e.url, passwords: [...e.passwords] });
      } else {
        const existing = out[at]!;
        existing.passwords = [...new Set([...existing.passwords, ...e.passwords])];
      }
    }
  }
  return out;
}

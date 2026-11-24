// XenForo thread page parsing, ported from xfdl.py (BeautifulSoup → cheerio).
import { load, type CheerioAPI } from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";

import {
  LAZY_ATTRS,
  NOISE_IMG_RE,
  RAW_URL_RE,
  canonicalizeUrl,
  decodeRedirect,
  pickBestSrcset,
  sanitize,
  stripChars,
  type PageEntry,
} from "./core";

export type { PageEntry };


const SKIP_TEXT_PARENTS = new Set(["script", "style", "template"]);

/** BeautifulSoup get_text(separator): every text node joined by `sep`. */
function textNodes(node: AnyNode, out: string[]): void {
  if (node.type === "text") {
    out.push((node as unknown as { data: string }).data);
    return;
  }
  if (node.type === "tag" || node.type === "root" || node.type === "script" || node.type === "style") {
    const el = node as Element;
    if (SKIP_TEXT_PARENTS.has(el.name)) return;
    for (const child of el.children ?? []) textNodes(child, out);
  }
}

export function getText(node: AnyNode, sep: string, strip = false): string {
  const parts: string[] = [];
  textNodes(node, parts);
  const list = strip ? parts.map((p) => p.trim()).filter(Boolean) : parts;
  return list.join(sep);
}

const PW_INLINE_RE = /(?:pw|pass|passwd|password|key|code)\s*[:=-]?\s*([^\s\r\n]+)/gi;
const PW_LINE_RE = /^(?:pw|pass|passwd|password|key|code)\s*[:=-]?$/i;

export function extractPostPasswords($: CheerioAPI, body: Element, text: string): string[] {
  const found: string[] = [];
  $(body)
    .find(
      ".bbCodeBlock--spoiler .bbCodeBlock-content, .bbCodeSpoiler-content, .bbCodeInlineSpoiler, details > *:not(summary)",
    )
    .each((_, el) => {
      found.push(getText(el, " ", true));
    });
  for (const m of text.matchAll(PW_INLINE_RE)) found.push(m[1]!);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length - 1; i++) {
    if (PW_LINE_RE.test(lines[i]!)) found.push(lines[i + 1]!.split(/\s+/)[0]!);
  }
  const cleaned = found.map((s) => stripChars(s ?? "", "`'\".,;")).filter(Boolean);
  return [...new Set(cleaned)];
}

export function extractPostUrls($: CheerioAPI, body: Element, pageUrl: string, postText: string): string[] {
  const candidates: string[] = [];

  $(body)
    .find("a[href]")
    .each((_, a) => {
      const decoded = decodeRedirect($(a).attr("href") ?? "", pageUrl);
      const c = canonicalizeUrl(decoded, pageUrl);
      if (c) candidates.push(c);
    });

  $(body)
    .find("img, video, source, iframe, embed")
    .each((_, el) => {
      const tag = $(el);
      const name = (el as Element).name;
      if (name === "img" && tag.closest('a[href*="/attachments/"]').length) return;
      const srcset = tag.attr("srcset");
      if (srcset) {
        const best = pickBestSrcset(srcset, pageUrl);
        if (best && !(name === "img" && NOISE_IMG_RE.test(best))) candidates.push(best);
      }
      for (const attr of LAZY_ATTRS) {
        const val = tag.attr(attr);
        if (!val) continue;
        const c = canonicalizeUrl(val, pageUrl);
        if (!c) continue;
        if (name === "img" && NOISE_IMG_RE.test(c)) continue;
        candidates.push(c);
      }
    });

  for (const raw of postText.match(RAW_URL_RE) ?? []) {
    const c = canonicalizeUrl(raw, pageUrl);
    if (c) candidates.push(c);
  }
  return candidates;
}

export function parsePageEntries($: CheerioAPI, pageUrl: string, includeQuotes = false): PageEntry[] {
  const entries: PageEntry[] = [];
  $("article.message").each((_, article) => {
    const body = $(article).find(".message-userContent").first();
    if (!body.length) return;
    if (!includeQuotes) {
      body.find("blockquote").each((__, q) => {
        const $q = $(q);
        if ($q.find(".bbCodeBlock-title").length || $q.hasClass("bbCodeBlock--quote")) $q.remove();
      });
    }
    const bodyEl = body.get(0) as Element;
    const postText = getText(bodyEl, "\n");
    const passwords = extractPostPasswords($, bodyEl, postText);
    for (const u of extractPostUrls($, bodyEl, pageUrl, postText)) entries.push({ url: u, passwords });
  });
  return entries;
}

export function detectLastPage($: CheerioAPI, baseUrl: string, startPage: number, maxPages: number): number {
  let last = startPage;
  $(
    ".pageNav a[href], a.pageNav-jump[href], .pageNav-page a[href], link[rel='next'][href], a[rel='next'][href]",
  ).each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = /\/page-(\d+)/.exec(href);
    if (m) {
      last = Math.max(last, parseInt(m[1]!, 10));
    } else {
      try {
        const p = new URL(href, `${baseUrl}/`).searchParams.get("page");
        if (p && /^\d+$/.test(p)) last = Math.max(last, parseInt(p, 10));
      } catch {
        /* ignore */
      }
    }
  });
  return Math.min(Math.max(startPage, last), maxPages);
}

export function extractThreadTitle($: CheerioAPI): string {
  const title = $(".p-title-value").first();
  if (!title.length) return "Performer";
  title.find(".label, .labelLink, .prefix").remove();
  return sanitize(getText(title.get(0) as Element, " ", true), "Performer");
}

export function extractBlockMessage($: CheerioAPI): string {
  const el = $(".blockMessage").first();
  return el.length ? getText(el.get(0) as Element, " ", true).slice(0, 120) : "";
}

export function parseHtml(html: string): CheerioAPI {
  return load(html);
}


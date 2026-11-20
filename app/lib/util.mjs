import { randomUUID } from "node:crypto";

export function uid(prefix = "n") {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

export function normalizeText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[“”"'‘’]/g, "")
    .replace(/[，。；：、]/g, "")
    .trim()
    .toLowerCase();
}

export function stripHtml(s) {
  return String(s ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function sourceKey(source) {
  if (source.doi) return "doi:" + String(source.doi).toLowerCase().replace(/^https?:\/\/doi.org\//, "");
  if (source.arxivId) return "arxiv:" + String(source.arxivId).toLowerCase();
  if (source.pmid) return "pmid:" + String(source.pmid);
  return "title:" + normalizeText(source.title).slice(0, 90) + ":" + (source.year || "");
}

export function tierRank(tier) {
  return { A1: 4, A2: 3, B: 2, C: 1, D: 0 }[tier] ?? 0;
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function withTimeout(promise, ms, label = "request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function safeJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function formatError(err) {
  if (!err) return "未知错误";
  if (err.name === "AbortError") return "请求超时或被取消";
  return String(err.message || err);
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

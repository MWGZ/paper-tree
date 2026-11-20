import { normalizeText, sourceKey, stripHtml, tierRank, truncate, uniqueBy } from "./util.mjs";

const MAILTO = process.env.OPENALEX_MAILTO || "paper-tree@example.com";
const UA = `PaperTree/0.1 (mailto:${MAILTO})`;

async function fetchJson(url, { timeout = 12000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/atom+xml,text/xml,*/*" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function normDoi(doi) {
  return String(doi || "")
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function reconstructAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions || []) words[pos] = word;
  }
  return words.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function tierFromType(type, { peerReviewed = false, retracted = false } = {}) {
  if (retracted) return "X";
  if (!peerReviewed) return type === "preprint" || type === "posted-content" ? "B" : "C";
  return "A1";
}

function makeSource(partial) {
  const doi = normDoi(partial.doi);
  return {
    id: "",
    title: partial.title || "Untitled",
    authors: partial.authors || [],
    year: partial.year || null,
    venue: partial.venue || "",
    doi,
    arxivId: partial.arxivId || "",
    pmid: partial.pmid || "",
    url: partial.url || (doi ? `https://doi.org/${doi}` : ""),
    oaUrl: partial.oaUrl || "",
    type: partial.type || "other",
    tier: partial.tier || "C",
    peerReviewed: Boolean(partial.peerReviewed),
    retracted: Boolean(partial.retracted),
    citationCount: partial.citationCount || 0,
    abstract: truncate(partial.abstract || "", 2600),
    content: truncate(partial.content || partial.abstract || "", 5000),
    source: partial.source || "academic",
    authority: null,
    fetchedAt: new Date().toISOString(),
    snapshotHash: "",
  };
}

export async function searchOpenAlex(query, limit = 6) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("mailto", MAILTO);
  const data = await fetchJson(url.toString());
  return (data.results || []).map((w) => {
    const source = w.primary_location?.source || {};
    const type = w.type || "other";
    const peerReviewed =
      source.type === "journal" ||
      source.type === "conference" ||
      type === "proceedings-article" ||
      type === "review";
    const oa = w.best_oa_location || w.primary_location || {};
    const abstract = reconstructAbstract(w.abstract_inverted_index);
    return makeSource({
      title: w.display_name || w.title || "Untitled",
      authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
      year: w.publication_year,
      venue: source.display_name || "",
      doi: w.doi,
      arxivId: w.ids?.arxiv ? String(w.ids.arxiv).replace(/^https?:\/\/arxiv\.org\/abs\//, "") : "",
      url: w.doi ? `https://doi.org/${normDoi(w.doi)}` : source.landing_page_url || w.id,
      oaUrl: oa.pdf_url || oa.landing_page_url || "",
      type: type === "preprint" ? "preprint" : type === "proceedings-article" ? "conference" : "journal",
      tier: tierFromType(type, { peerReviewed, retracted: w.is_retracted }),
      peerReviewed,
      retracted: Boolean(w.is_retracted),
      citationCount: w.cited_by_count || 0,
      abstract,
      content: abstract,
      source: "openalex",
    });
  });
}

export async function searchCrossref(query, limit = 6) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("mailto", MAILTO);
  const data = await fetchJson(url.toString());
  const items = data?.message?.items || [];
  return items.map((w) => {
    const type = w.type || "other";
    const peerReviewed = type === "journal-article" || type === "proceedings-article";
    const year = w.issued?.["date-parts"]?.[0]?.[0] || null;
    const authors = (w.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean);
    const links = Array.isArray(w.link) ? w.link : [];
    const pdf = links.find((l) => String(l["content-type"] || "").includes("pdf"));
    const doi = normDoi(w.DOI);
    return makeSource({
      title: Array.isArray(w.title) ? w.title[0] : w.title || "Untitled",
      authors,
      year,
      venue: Array.isArray(w["container-title"]) ? w["container-title"][0] : w["container-title"] || "",
      doi,
      url: w.URL || (doi ? `https://doi.org/${doi}` : ""),
      oaUrl: pdf?.URL || "",
      type: type === "posted-content" ? "preprint" : peerReviewed ? "journal" : "other",
      tier: tierFromType(type, { peerReviewed }),
      peerReviewed,
      citationCount: w["is-referenced-by-count"] || 0,
      abstract: stripHtml(w.abstract || ""),
      content: stripHtml(w.abstract || ""),
      source: "crossref",
    });
  });
}

function parseArxivEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const pick = (tag) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return mm ? stripHtml(mm[1]).trim() : "";
    };
    const idUrl = pick("id");
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map((x) => stripHtml(x[1]).trim())
      .filter(Boolean);
    const journalRef = pick("arxiv:journal_ref");
    const doi = pick("arxiv:doi");
    entries.push({
      arxivId,
      title: pick("title") || "Untitled",
      abstract: pick("summary"),
      published: pick("published"),
      authors,
      journalRef,
      doi,
      url: idUrl || (arxivId ? `https://arxiv.org/abs/${arxivId}` : ""),
    });
  }
  return entries;
}

export async function searchArxiv(query, limit = 5) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const xml = await fetchText(url.toString());
  return parseArxivEntries(xml).map((e) => {
    const published = Boolean(e.journalRef || e.doi);
    return makeSource({
      title: e.title,
      authors: e.authors,
      year: e.published ? Number(String(e.published).slice(0, 4)) : null,
      venue: e.journalRef || "arXiv preprint",
      doi: e.doi,
      arxivId: e.arxivId,
      url: e.url,
      oaUrl: e.arxivId ? `https://arxiv.org/pdf/${e.arxivId}` : "",
      type: published ? "journal" : "preprint",
      tier: published ? "A2" : "B",
      peerReviewed: published,
      abstract: e.abstract,
      content: e.abstract,
      source: "arxiv",
    });
  });
}

export async function searchSemanticScholar(query, limit = 5) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set(
    "fields",
    "title,authors,year,venue,externalIds,abstract,citationCount,influentialCitationCount,openAccessPdf,isOpenAccess,publicationTypes,url"
  );
  const headers = {};
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const data = await fetchJson(url.toString(), { timeout: 15000, headers });
  return (data.data || []).map((p) => {
    const types = Array.isArray(p.publicationTypes) ? p.publicationTypes : [];
    const peerReviewed = types.includes("JournalArticle") || types.includes("Conference");
    return makeSource({
      title: p.title || "Untitled",
      authors: (p.authors || []).map((a) => a.name).filter(Boolean),
      year: p.year || null,
      venue: p.venue || "",
      doi: p.externalIds?.DOI,
      arxivId: p.externalIds?.ArXiv,
      pmid: p.externalIds?.PubMed,
      url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ""),
      oaUrl: p.openAccessPdf?.url || "",
      type: peerReviewed ? "journal" : "preprint",
      tier: peerReviewed ? "A1" : "B",
      peerReviewed,
      citationCount: p.citationCount || 0,
      abstract: p.abstract || "",
      content: p.abstract || "",
      source: "semantic_scholar",
    });
  });
}

function dedupe(sources) {
  const sorted = [...sources].sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
  const out = [];
  for (const s of sorted) {
    const key = s.doi ? `doi:${s.doi.toLowerCase()}` : s.arxivId ? `arxiv:${s.arxivId.toLowerCase()}` : sourceKey(s);
    const existing = out.find((x) => {
      const xk = x.doi ? `doi:${x.doi.toLowerCase()}` : x.arxivId ? `arxiv:${x.arxivId.toLowerCase()}` : sourceKey(x);
      return xk === key;
    });
    if (!existing) {
      out.push(s);
      continue;
    }
    // 合并：保留更高层级，补全 OA / 摘要 / 引用数
    if (!existing.oaUrl && s.oaUrl) existing.oaUrl = s.oaUrl;
    if (!existing.abstract && s.abstract) existing.abstract = s.abstract;
    if (!existing.content && s.content) existing.content = s.content;
    if ((s.citationCount || 0) > (existing.citationCount || 0)) existing.citationCount = s.citationCount;
    if (!existing.doi && s.doi) existing.doi = s.doi;
    if (!existing.arxivId && s.arxivId) existing.arxivId = s.arxivId;
  }
  return out;
}

function rank(sources, query, limit) {
  const terms = normalizeText(query)
    .split(" ")
    .filter((t) => t.length > 2)
    .slice(0, 12);
  return sources
    .map((s) => {
      const text = normalizeText(`${s.title} ${s.abstract}`);
      const overlap = terms.length ? terms.filter((t) => text.includes(t)).length / terms.length : 0;
      const age = s.year ? Math.max(0, new Date().getFullYear() - s.year) : 10;
      const score =
        tierRank(s.tier) * 100 +
        overlap * 25 +
        Math.log10(1 + (s.citationCount || 0)) * 3 +
        Math.max(0, 8 - age) * 0.8;
      return { ...s, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...s }) => s);
}

export async function searchAcademic(query, { limit = 8 } = {}) {
  const tasks = [
    ["openalex", searchOpenAlex(query, 6)],
    ["crossref", searchCrossref(query, 5)],
    ["arxiv", searchArxiv(query, 4)],
    ["semantic_scholar", searchSemanticScholar(query, 5)],
  ];
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  const sources = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") sources.push(...r.value);
    else errors.push({ source: tasks[i][0], error: String(r.reason?.message || r.reason) });
  });

  const deduped = dedupe(sources);
  const ranked = rank(deduped, query, limit);
  return { sources: ranked, errors, totalFound: sources.length };
}

export function sourceSummary(s) {
  return `${s.title} (${s.year || "n.d."}, ${s.venue || "unknown"}); tier=${s.tier}; doi=${s.doi || "-"}; citations=${s.citationCount || 0}`;
}

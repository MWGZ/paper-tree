import { searchAcademic } from "./academic.mjs";
import {
  normalizeText,
  safeJson,
  sourceKey,
  tierRank,
  truncate,
  uniqueBy,
} from "./util.mjs";

const MAX_WEB_QUERIES = 2;
const MAX_ACADEMIC_QUERIES = 2;
const MAX_SOURCES = 6;
const MAX_SOURCE_CHARS = 2200;
const MAX_PAPER_CHARS = 14000;
const MAX_PATH_CHARS = 1000;

function emitSafe(emit, event, data) {
  try {
    emit?.(event, data);
  } catch {
    // 客户端断开时忽略
  }
}

function fallbackQueries(question) {
  const q = question.replace(/\s+/g, " ").trim();
  const cleaned = q.replace(/[？?！!。；;：:]/g, " ").trim();
  return [
    { tool: "academic", q: cleaned.slice(0, 120), why: "fallback" },
    { tool: "web", q: cleaned.slice(0, 120), why: "fallback" },
  ];
}

async function planQueries({ client, question, session, anchor, mode }) {
  if (!client?.configured) return { queries: fallbackQueries(question), planner: "fallback" };

  const prompt = `你是论文精读助手的研究规划器。当前时间：${new Date().toISOString()}。

用户问题：
${question}

论文：${session.paperTitle || "未命名"}
${anchor?.quote ? `用户选中的句子：「${anchor.quote}」` : ""}
检索模式：${mode === "web" ? "网页优先" : "学术优先"}

请生成 2–4 个检索 query，返回 JSON：
{
  "queries": [
    {"tool": "academic" | "web", "q": "查询词", "why": "为什么查这个"}
  ],
  "claims_to_check": ["需要验证的关键断言"]
}

要求：
- academic query 用英文，包含准确术语/方法名；不要加 site: 操作符。
- web query 可以是中文或英文，适合找官方文档、最新进展、背景。
- 每个 query 不超过 120 字。
- 学术优先模式至少 1 个 academic query；网页优先模式至少 1 个 web query。
- 只返回 JSON，不要解释。`;

  try {
    const { data } = await client.chatJson(
      [
        { role: "system", content: "你是严谨的学术检索规划器。只输出 JSON。" },
        { role: "user", content: prompt },
      ],
      { model: client.model, maxTokens: 700, temperature: 0.2 }
    );
    const raw = Array.isArray(data?.queries) ? data.queries : [];
    const queries = raw
      .filter((x) => x && typeof x.q === "string" && x.q.trim())
      .map((x) => ({
        tool: x.tool === "web" ? "web" : "academic",
        q: x.q.trim().slice(0, 120),
        why: typeof x.why === "string" ? x.why.slice(0, 120) : "",
      }))
      .slice(0, 4);
    if (!queries.length) return { queries: fallbackQueries(question), planner: "fallback" };
    return {
      queries,
      claims: Array.isArray(data?.claims_to_check) ? data.claims_to_check.slice(0, 6) : [],
      planner: "model",
    };
  } catch {
    return { queries: fallbackQueries(question), planner: "fallback" };
  }
}

function officialDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      /\.gov$/.test(host) ||
      /\.gov\./.test(host) ||
      /\.int$/.test(host) ||
      /\.edu$/.test(host) ||
      /(^|\.)iso\.org$/.test(host) ||
      /(^|\.)w3\.org$/.test(host) ||
      /(^|\.)ietf\.org$/.test(host) ||
      /(^|\.)nist\.gov$/.test(host) ||
      /(^|\.)who\.int$/.test(host) ||
      /(^|\.)europa\.eu$/.test(host)
    );
  } catch {
    return false;
  }
}

function webSource(result, query) {
  const authority = Number.isFinite(result.authority) ? result.authority : -1;
  const url = result.url || "";
  const isArxiv = /arxiv\.org\/(abs|pdf)\//.test(url);
  const tier = isArxiv ? "B" : officialDomain(url) ? "A2" : "C";
  return {
    id: "",
    title: result.title || "Untitled",
    authors: [],
    year: result.date ? Number(String(result.date).slice(0, 4)) : null,
    venue: result.site_name || "",
    doi: "",
    arxivId: isArxiv ? (url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/)?.[1] || "").replace(/v\d+$/, "") : "",
    pmid: "",
    url,
    oaUrl: isArxiv ? url.replace("/abs/", "/pdf/") : "",
    type: "web",
    tier,
    peerReviewed: false,
    retracted: false,
    citationCount: 0,
    abstract: result.summary || result.snippet || "",
    content: result.content || result.summary || result.snippet || "",
    source: "deepseek_search",
    authority,
    rerankScore: result.rerank_score ?? null,
    fetchedAt: new Date().toISOString(),
    snapshotHash: "",
    query,
  };
}

function rankSources(sources, question) {
  const terms = normalizeText(question)
    .split(" ")
    .filter((t) => t.length > 2)
    .slice(0, 12);
  return sources
    .map((s) => {
      const text = normalizeText(`${s.title} ${s.abstract || ""}`);
      const overlap = terms.length ? terms.filter((t) => text.includes(t)).length / terms.length : 0;
      const auth = Number.isFinite(s.authority) ? Math.max(0, s.authority) : 0;
      const age = s.year ? Math.max(0, new Date().getFullYear() - s.year) : 12;
      const score =
        tierRank(s.tier) * 100 +
        auth * 12 +
        overlap * 25 +
        Math.log10(1 + (s.citationCount || 0)) * 3 +
        Math.max(0, 8 - age) * 0.8;
      return { ...s, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...s }) => s);
}

function buildSourceContext(sources) {
  return sources
    .map((s) => {
      const meta = [
        `[${s.id}] ${s.title}`,
        s.authors?.length ? `Authors: ${s.authors.slice(0, 4).join(", ")}` : "",
        s.year ? `Year: ${s.year}` : "",
        s.venue ? `Venue: ${s.venue}` : "",
        `Type: ${s.type}; Tier: ${s.tier}${s.peerReviewed ? "; peer-reviewed" : ""}${s.retracted ? "; RETRACTED" : ""}`,
        s.doi ? `DOI: ${s.doi}` : "",
        s.arxivId ? `arXiv: ${s.arxivId}` : "",
        s.url ? `URL: ${s.url}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      const body = truncate(s.content || s.abstract || "", MAX_SOURCE_CHARS);
      return `<source id="${s.id}" tier="${s.tier}">\n${meta}\n${body || "(no abstract/content available)"}\n</source>`;
    })
    .join("\n\n---\n\n");
}

function buildPathContext(parent, nodes) {
  if (!parent) return "（这是新树根，没有祖先路径）";
  const path = [];
  let cur = parent;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? nodes.find((n) => n.id === cur.parentId) : null;
  }
  const recent = path.slice(-6);
  return recent
    .map((n) => {
      const t = new Date(n.createdAt).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 16);
      return `用户（${t}）：${truncate(n.question, 500)}\n助手（${t}）：${truncate(n.answer || "(无回答)", MAX_PATH_CHARS)}`;
    })
    .join("\n\n");
}

function validateAnswer(data, sources) {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  let answer = String(data?.answer_md || data?.answer || "").trim();
  if (!answer) {
    answer = "模型没有返回可用的回答。可以重试，或换一个更具体的问题。";
  }

  // 只允许引用真实存在的 S#
  answer = answer.replace(/\[S(\d+)\]/g, (m, n) => (sourceMap.has(`S${n}`) ? m : "[?]"));

  const claims = [];
  for (const raw of Array.isArray(data?.claims) ? data.claims : []) {
    if (!raw || typeof raw !== "object") continue;
    const text = String(raw.text || "").trim();
    if (!text) continue;
    const ids = (Array.isArray(raw.source_ids) ? raw.source_ids : [])
      .map((x) => String(x).replace(/[[\]\s]/g, "").trim())
      .filter((id) => sourceMap.has(id));
    const quote = String(raw.quote || "").trim();
    const stance = ["support", "contradict", "mixed"].includes(raw.stance) ? raw.stance : "support";
    const cited = ids.map((id) => sourceMap.get(id));
    const independent = uniqueBy(cited, (s) => sourceKey(s));
    const aCount = independent.filter((s) => s.tier === "A1" || s.tier === "A2").length;
    const bCount = independent.filter((s) => s.tier === "B").length;
    const retracted = independent.some((s) => s.retracted);
    const quoteVerified = quote
      ? cited.some((s) => normalizeText(s.content || s.abstract || "").includes(normalizeText(quote)))
      : false;

    let verdict = "insufficient";
    if (retracted) verdict = "retracted";
    else if (stance === "contradict") verdict = "contested";
    else if (independent.length >= 2 && aCount >= 1) verdict = "strong";
    else if (independent.length >= 2 && (aCount + bCount) >= 2) verdict = "moderate";
    else if (independent.length === 1 && (aCount === 1 || bCount === 1)) verdict = "single-source";
    else if (independent.length === 1) verdict = "single-source";

    claims.push({
      text,
      sourceIds: ids,
      quote,
      quoteVerified,
      stance,
      verdict,
      independenceGroups: independent.length,
      note: raw.note ? String(raw.note).slice(0, 300) : "",
    });
  }

  let grade = "none";
  if (claims.some((c) => c.verdict === "retracted")) grade = "retracted";
  else if (claims.some((c) => c.verdict === "contested")) grade = "contested";
  else if (claims.length && claims.every((c) => c.verdict === "strong")) grade = "strong";
  else if (claims.some((c) => c.verdict === "strong" || c.verdict === "moderate")) grade = "moderate";
  else if (claims.length) grade = "single-source";

  return { answer, claims, grade };
}

async function synthesize({ client, question, session, parent, nodes, anchor, sources, mode }) {
  const paper = truncate(session.paperText || "", MAX_PAPER_CHARS);
  const path = buildPathContext(parent, nodes);
  const anchorText = anchor?.quote ? `用户选中了上一轮回答中的：「${anchor.quote}」` : "（无句子锚点）";
  const sourceText = buildSourceContext(sources);

  const system = `你是严谨的论文精读研究助手。当前时间：${new Date().toISOString()}（Asia/Shanghai）。

规则：
1. 只能使用下面 <sources> 里的资料来支撑事实性陈述；不足就明说“资料不足”，不要编造。
2. 每个事实句后面必须带 [S1] 这样的引用；没有引用的句子只能是你基于资料的推断，并明确写“推断”。
3. 区分：论文原文 / 外部来源 / 你的推断。
4. 只有一条独立来源时，写“单一来源”；多个来源冲突时，写“存在争议”并列出双方。
5. 不要编造 DOI、页码、URL、引文；不要引用不存在的 [S#]。
6. 回答用用户提问的语言，先给结论，再给证据和限定条件。
7. 只返回 JSON，不要代码块：
{
  "answer_md": "markdown 回答，含 [S1] 引用",
  "claims": [
    {"text": "原子断言", "source_ids": ["S1", "S2"], "quote": "来源中的精确原文", "stance": "support|contradict|mixed", "note": "可选说明"}
  ],
  "caveats": ["证据不足/争议/时间限制"]
}`;

  const user = `论文标题：${session.paperTitle || "未提供"}
论文原文/摘要（可能为空）：
<paper>
${paper || "(未提供论文原文；不要假装读过全文)"}
</paper>

对话路径：
<path>
${path}
</path>

当前锚点：
${anchorText}

当前提问时间：${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).slice(0, 16)}（Asia/Shanghai）

当前问题：
${question}

<sources>
${sourceText || "(没有检索到来源)"}
</sources>

请基于以上资料回答。若来源不足，明确说“没有找到足够的权威来源”，并给出下一步建议。`;

  const { message, usage, data } = await client.chatJson(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { model: client.model, maxTokens: 3200, temperature: 0.2 }
  );

  let parsed = data;
  if (!parsed) parsed = safeJson(message.content || "");
  if (!parsed) {
    return {
      answer: message.content || "模型没有返回结构化结果。",
      claims: [],
      grade: "none",
      usage,
    };
  }
  const validated = validateAnswer(parsed, sources);
  return { ...validated, usage, caveats: Array.isArray(parsed.caveats) ? parsed.caveats.slice(0, 8) : [] };
}

export async function runResearch({ client, question, parent, session, nodes, anchor, mode, emit }) {
  const trace = [];
  const addTrace = (type, message, meta = {}) => {
    const entry = { at: new Date().toISOString(), type, message, ...meta };
    trace.push(entry);
    emitSafe(emit, "trace", entry);
  };

  addTrace("plan", mode === "web" ? "网页优先：生成检索计划" : "学术优先：生成检索计划");
  const plan = await planQueries({ client, question, session, anchor, mode });
  addTrace("plan", `计划完成：${plan.queries.length} 个查询（${plan.planner}）`, { queries: plan.queries });

  const webQueries = plan.queries.filter((q) => q.tool === "web").slice(0, MAX_WEB_QUERIES);
  const academicQueries = plan.queries.filter((q) => q.tool === "academic").slice(0, MAX_ACADEMIC_QUERIES);

  const webPromise = Promise.allSettled(
    webQueries.map(async (q) => {
      const results = await client.search(q.q, { count: 6, needContent: false, oriQuestion: question });
      addTrace("search", `DeepSeek Search · ${results.length} 条`, { query: q.q, resultCount: results.length });
      return results.map((r) => webSource(r, q.q));
    })
  );

  const academicPromise =
    mode === "web"
      ? Promise.resolve([])
      : Promise.allSettled(
          academicQueries.map(async (q) => {
            const res = await searchAcademic(q.q, { limit: 7 });
            addTrace("search", `学术检索 · ${res.totalFound} 条 → 去重 ${res.sources.length} 篇`, {
              query: q.q,
              resultCount: res.sources.length,
              errors: res.errors,
            });
            return res.sources;
          })
        );

  const [webSettled, academicSettled] = await Promise.all([webPromise, academicPromise]);

  const webSources = webSettled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const academicSources = academicSettled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  for (const r of [...webSettled, ...academicSettled]) {
    if (r.status === "rejected") addTrace("error", `检索失败：${truncate(String(r.reason?.message || r.reason), 200)}`);
  }

  let sources = [...academicSources, ...webSources];
  sources = uniqueBy(sources, (s) => (s.doi ? `doi:${s.doi.toLowerCase()}` : s.arxivId ? `arxiv:${s.arxivId.toLowerCase()}` : sourceKey(s)));
  sources = rankSources(sources, question).slice(0, MAX_SOURCES);

  if (!sources.length) {
    addTrace("verify", "没有检索到可引用的来源");
    return {
      answer:
        "没有检索到可引用的来源。可以试试：换一个更具体的问法、关闭“仅学术”模式、或在设置里粘贴论文原文后再问。",
      sources: [],
      claims: [],
      grade: "none",
      trace,
      usage: null,
    };
  }

  // 对网页来源补正文；学术来源用摘要/全文
  const fetchTargets = sources.filter((s) => s.source === "deepseek_search" && s.url).slice(0, 3);
  await Promise.allSettled(
    fetchTargets.map(async (s) => {
      try {
        const page = await client.fetchUrl(s.url);
        if (page.content) {
          s.title = s.title || page.title;
          s.content = truncate(page.content, 8000);
          s.snapshotHash = `len:${page.content.length}`;
        }
      } catch {
        // 抓不到就保留 summary
      }
    })
  );
  addTrace("fetch", `精读 ${sources.length} 个来源（网页 ${fetchTargets.length} 个 + 学术摘要）`);

  sources = sources.map((s, i) => ({ ...s, id: `S${i + 1}` }));
  emitSafe(emit, "sources", sources);
  addTrace("sources", `已选定 ${sources.length} 个来源`, { sourceIds: sources.map((s) => s.id) });

  const result = await synthesize({ client, question, session, parent, nodes, anchor, sources, mode });
  addTrace("verify", `验证完成：${result.claims.length} 条 claim · 综合等级 ${result.grade}`);
  return { ...result, sources, trace };
}

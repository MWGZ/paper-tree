/* PaperTree 0.1 — 前端应用 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const COLORS = ["#4f63e8", "#c47a1a", "#0f8a6a", "#b83f72", "#6b5bd2"];
const NODE_W = 206;
const NODE_H = 76;
const GAP_X = 92;
const GAP_Y = 30;
const TREE_GAP = 90;
const LEFT = 56;
const TOP = 64;
const TZ = "Asia/Shanghai";

const state = {
  session: null,
  nodes: [],
  config: null,
  currentId: null,
  roots: [],
  focusMode: false,
  collapsedOthers: false,
  pendingQuote: null,
  view: { x: 0, y: 0, k: 1 },
  nodeEls: new Map(),
  activeAsk: null,
  scrollTimer: null,
  desktop: null,
  desktopInfo: null,
};

const els = {
  viewport: $("#viewport"),
  canvas: $("#canvas"),
  edges: $("#edges"),
  nodes: $("#nodes"),
  rootLabels: $("#rootLabels"),
  emptyMap: $("#emptyMap"),
  mapHint: $("#mapHint"),
  readerPane: $("#readerPane"),
  readerScroll: $("#readerScroll"),
  readerContent: $("#readerContent"),
  breadcrumb: $("#breadcrumb"),
  depthPill: $("#depthPill"),
  input: $("#input"),
  sendBtn: $("#sendBtn"),
  quoteChip: $("#quoteChip"),
  quoteText: $("#quoteText"),
  toast: $("#toast"),
  modeBadge: $("#modeBadge"),
  sessionTitle: $("#sessionTitle"),
  paperChip: $("#paperChip"),
  nodeCount: $("#nodeCount"),
  askMode: $("#askMode"),
  understoodBtn: $("#understoodBtn"),
  settingsModal: $("#settingsModal"),
  sourceDrawer: $("#sourceDrawer"),
  drawerBackdrop: $("#drawerBackdrop"),
  newRootModal: $("#newRootModal"),
};

/* ------------------------------------------------------------------ */
/* API / SSE                                                          */
/* ------------------------------------------------------------------ */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function streamSse(res, handlers) {
  if (!res.body) throw new Error("浏览器不支持流式响应");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      handlers[event]?.(payload);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function byId(id) {
  return state.nodes.find((n) => n.id === id) || null;
}

function rootOf(node) {
  let cur = node;
  while (cur && cur.parentId) cur = byId(cur.parentId);
  return cur || node;
}

function rootColor(rootId) {
  const i = state.roots.findIndex((r) => r.id === rootId);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
}

function pathOf(node) {
  const arr = [];
  let cur = node;
  while (cur) {
    arr.unshift(cur);
    cur = cur.parentId ? byId(cur.parentId) : null;
  }
  return arr;
}

function childrenOf(id) {
  return state.nodes.filter((n) => n.parentId === id);
}

function countDesc(node) {
  return childrenOf(node.id).reduce((s, c) => s + 1 + countDesc(c), 0);
}

function isVisible(node) {
  let p = node.parentId ? byId(node.parentId) : null;
  while (p) {
    if (p.collapsed) return false;
    p = p.parentId ? byId(p.parentId) : null;
  }
  return true;
}

function fmtTime(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

function fmtFull(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).slice(0, 16);
}

function relTime(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.max(0, (Date.now() - date.getTime()) / 60000);
  if (diff < 1) return "刚刚";
  if (diff < 60) return `${Math.floor(diff)} 分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)} 小时前`;
  return `${Math.floor(diff / 1440)} 天前`;
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function gradeFor(node) {
  if (node.grade && node.grade !== "none") return node.grade;
  const claims = node.claims || [];
  if (!claims.length) return "none";
  if (claims.some((c) => c.verdict === "retracted")) return "retracted";
  if (claims.some((c) => c.verdict === "contested")) return "contested";
  if (claims.every((c) => c.verdict === "strong")) return "strong";
  if (claims.some((c) => c.verdict === "strong" || c.verdict === "moderate")) return "moderate";
  return "single-source";
}

const GRADE_LABEL = {
  strong: "强证据",
  moderate: "中等证据",
  "single-source": "单一来源",
  contested: "存在争议",
  retracted: "已撤稿",
  none: "未验证",
};

const VERDICT_LABEL = {
  strong: "强",
  moderate: "中",
  "single-source": "单一",
  contested: "争议",
  retracted: "撤稿",
  insufficient: "不足",
  outdated: "过时",
};

function tierLabel(tier) {
  return tier === "X" ? "撤稿" : tier;
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safeUrl(url) {
  const s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return "";
  return escapeHtml(s);
}

/* ------------------------------------------------------------------ */
/* Load / hydrate                                                     */
/* ------------------------------------------------------------------ */
async function loadState() {
  const data = await api("/api/state");
  state.session = data.session;
  state.nodes = (data.nodes || []).map((n) => ({
    ...n,
    sources: n.sources || [],
    claims: n.claims || [],
    trace: n.trace || [],
    collapsed: Boolean(n.collapsed),
    understood: Boolean(n.understood),
    scrollOffset: Number(n.scrollOffset) || 0,
  }));
  state.config = data.config || { mode: "demo", demo: true };
  state.roots = state.nodes.filter((n) => !n.parentId);
  for (const n of state.nodes) n.grade = gradeFor(n);

  renderShell();
  renderMap();

  if (state.nodes.length) {
    const latest = [...state.nodes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    const saved = localStorage.getItem("pt_current");
    const target =
      state.currentId && byId(state.currentId)
        ? state.currentId
        : saved && byId(saved)
          ? saved
          : state.roots[0]?.id || latest.id;
    selectNode(target, { center: false });
    requestAnimationFrame(() => fitView());
  } else {
    state.currentId = null;
    renderEmptyReader();
    updateComposer();
  }
}

function renderShell() {
  const s = state.session || {};
  const c = state.config || {};
  els.sessionTitle.textContent = s.title || "未命名会话";
  els.paperChip.textContent = s.paperTitle || "未设置论文";
  els.paperChip.title = s.paperTitle || "";
  els.modeBadge.textContent = c.mode === "live" ? "LIVE" : "DEMO";
  els.modeBadge.className = "mode-badge " + (c.mode === "live" ? "live" : "demo");
  els.askMode.value = s.mode === "web" ? "web" : "academic";
  els.mapHint.textContent =
    c.mode === "live"
      ? "拖拽平移 · 滚轮缩放 · 点击节点阅读"
      : "演示模式 · 配置 DEEPSEEK_API_KEY 后使用真实检索";
  document.title = `${s.title || "PaperTree"} · PaperTree`;
}

/* ------------------------------------------------------------------ */
/* Map layout                                                         */
/* ------------------------------------------------------------------ */
function subtreeHeight(node) {
  const kids = childrenOf(node.id);
  if (node.collapsed || !kids.length) return NODE_H;
  const total = kids.reduce((s, c) => s + subtreeHeight(c), 0) + GAP_Y * (kids.length - 1);
  return Math.max(NODE_H, total);
}

function placeNode(node, depth, top, height, out) {
  const x = LEFT + depth * (NODE_W + GAP_X);
  const y = top + (height - NODE_H) / 2;
  out.set(node.id, { x, y });
  if (node.collapsed) return;
  const kids = childrenOf(node.id);
  if (!kids.length) return;
  const hs = kids.map(subtreeHeight);
  const total = hs.reduce((a, b) => a + b, 0) + GAP_Y * (kids.length - 1);
  let cy = top + (height - total) / 2;
  kids.forEach((c, i) => {
    placeNode(c, depth + 1, cy, hs[i], out);
    cy += hs[i] + GAP_Y;
  });
}

function computeLayout() {
  const pos = new Map();
  let y = TOP;
  for (const root of state.roots) {
    const h = subtreeHeight(root);
    placeNode(root, 0, y, h, pos);
    y += h + TREE_GAP;
  }
  let maxX = 880;
  let maxY = 600;
  for (const [id, p] of pos) {
    const n = byId(id);
    n.x = p.x;
    n.y = p.y;
    maxX = Math.max(maxX, p.x + NODE_W + 48);
    maxY = Math.max(maxY, p.y + NODE_H + 64);
  }
  els.canvas.style.width = `${maxX}px`;
  els.canvas.style.height = `${maxY}px`;
  els.edges.setAttribute("width", maxX);
  els.edges.setAttribute("height", maxY);
}

function renderMap() {
  state.roots = state.nodes.filter((n) => !n.parentId);
  computeLayout();
  state.nodeEls.clear();
  els.nodes.innerHTML = "";
  els.rootLabels.innerHTML = "";

  for (const node of state.nodes) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.id = node.id;
    el.style.left = `${node.x || 0}px`;
    el.style.top = `${node.y || 0}px`;
    el.style.setProperty("--c", rootColor(rootOf(node).id));
    el.innerHTML = `
      <div class="node-strip"></div>
      <div class="node-main">
        <div class="node-title"></div>
        <div class="node-meta"></div>
      </div>
      <button class="node-toggle" title="收起">−</button>`;
    el.querySelector(".node-title").textContent = node.question;
    el.addEventListener("click", (e) => {
      if (e.target.closest(".node-toggle")) return;
      selectNode(node.id);
    });
    el.querySelector(".node-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCollapse(node.id);
    });
    els.nodes.appendChild(el);
    state.nodeEls.set(node.id, el);
    syncNodeEl(node);
  }

  drawRootLabels();
  drawEdges();
  updateSelection();
  els.emptyMap.hidden = state.nodes.length > 0;
  const rootCount = state.roots.length;
  els.nodeCount.textContent = `${state.nodes.length} 个节点 · ${rootCount} 棵树`;
}

function syncNodeEl(node) {
  const el = state.nodeEls.get(node.id);
  if (!el) return;
  const grade = node.grade || gradeFor(node);
  const kids = childrenOf(node.id);
  const sourceCount = (node.sources || []).length;
  const isResearching = node.status === "researching";
  const isError = node.status === "error";
  el.className =
    "node" +
    (!node.parentId ? " root" : "") +
    (node.understood ? " understood" : "") +
    (node.collapsed && kids.length ? " is-collapsed" : "") +
    (isResearching ? " researching" : "") +
    (isError ? " error" : "");
  el.style.display = isVisible(node) ? "" : "none";
  el.style.setProperty("--c", rootColor(rootOf(node).id));

  const meta = el.querySelector(".node-meta");
  const bits = [`<span>${fmtTime(node.createdAt)}</span>`];
  if (isResearching) bits.push('<span class="node-chip grade-none">检索中…</span>');
  else if (isError) bits.push('<span class="node-chip grade-contested">失败</span>');
  else {
    if (sourceCount) bits.push(`<span class="node-chip grade-${grade}">${GRADE_LABEL[grade] || "证据"}</span>`);
    if (sourceCount) bits.push(`<span>${sourceCount} 源</span>`);
  }
  if (node.isDemo && state.config?.mode === "live") bits.push('<span class="node-chip grade-none">示例</span>');
  if (node.understood) bits.push('<span class="node-ico ok" title="已理解">✓</span>');
  meta.innerHTML = bits.join('<span class="sep">·</span>');

  const tog = el.querySelector(".node-toggle");
  if (kids.length) {
    tog.style.display = "flex";
    tog.textContent = node.collapsed ? "+" : "−";
    tog.title = node.collapsed ? "展开" : "收起";
  } else {
    tog.style.display = "none";
  }
  el.querySelectorAll(".node-count").forEach((x) => x.remove());
  if (node.collapsed && kids.length) {
    const c = document.createElement("span");
    c.className = "node-count";
    c.textContent = `+${countDesc(node)}`;
    el.appendChild(c);
  }
}

function drawRootLabels() {
  state.roots.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = "root-label";
    d.style.left = `${r.x}px`;
    d.style.top = `${(r.y || 0) - 27}px`;
    d.style.color = rootColor(r.id);
    d.innerHTML = `<span class="root-dot"></span>树 ${i + 1} · ${escapeHtml(i === 0 ? "主线" : rootShortLabel(r))}`;
    els.rootLabels.appendChild(d);
  });
}

function rootShortLabel(root) {
  const q = root.question || "";
  if (/复杂度|O\(n/.test(q)) return "复杂度";
  if (/位置编码/.test(q)) return "位置编码";
  if (/局限|不足|缺点/.test(q)) return "局限";
  if (/贡献|解决/.test(q)) return "贡献";
  return truncate(q, 10);
}

function drawEdges() {
  els.edges.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";
  for (const n of state.nodes) {
    if (!n.parentId || !isVisible(n)) continue;
    const p = byId(n.parentId);
    if (!p) continue;
    const x1 = (p.x || 0) + NODE_W;
    const y1 = (p.y || 0) + NODE_H / 2;
    const x2 = n.x || 0;
    const y2 = (n.y || 0) + NODE_H / 2;
    const dx = Math.max(44, (x2 - x1) * 0.52);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", "edge" + (n.anchor?.quote ? " dashed" : ""));
    path.dataset.parent = p.id;
    path.dataset.child = n.id;
    path.style.setProperty("--c", rootColor(rootOf(n).id));
    els.edges.appendChild(path);
  }
}

function updateSelection() {
  const current = state.currentId ? byId(state.currentId) : null;
  const pathSet = new Set(current ? pathOf(current).map((n) => n.id) : []);
  for (const n of state.nodes) {
    const el = state.nodeEls.get(n.id);
    if (!el) continue;
    el.classList.toggle("selected", n.id === state.currentId);
    el.classList.toggle("on-path", pathSet.has(n.id));
    el.classList.toggle("dim", state.focusMode && !pathSet.has(n.id));
  }
  $$(".edge", els.edges).forEach((e) => {
    const on = pathSet.has(e.dataset.parent) && pathSet.has(e.dataset.child);
    e.classList.toggle("on-path", on);
    e.classList.toggle("dim", state.focusMode && !on);
  });
}

/* ------------------------------------------------------------------ */
/* View transform                                                     */
/* ------------------------------------------------------------------ */
function applyView() {
  els.canvas.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.k})`;
}

function animateView(next) {
  state.view = next;
  els.canvas.classList.add("anim");
  applyView();
  clearTimeout(animateView._timer);
  animateView._timer = setTimeout(() => els.canvas.classList.remove("anim"), 320);
}

function fitView() {
  const vp = els.viewport.getBoundingClientRect();
  if (!state.nodes.length) {
    applyView();
    return;
  }
  const w = parseFloat(els.canvas.style.width) || 880;
  const h = parseFloat(els.canvas.style.height) || 600;
  const k = Math.min((vp.width - 60) / w, (vp.height - 50) / h, 1.08);
  animateView({
    x: (vp.width - w * k) / 2,
    y: (vp.height - h * k) / 2,
    k: Math.max(0.35, k),
  });
}

function centerOnNode(id) {
  const n = byId(id);
  if (!n) return;
  const vp = els.viewport.getBoundingClientRect();
  const k = Math.max(state.view.k, 0.8);
  animateView({
    x: vp.width / 2 - ((n.x || 0) + NODE_W / 2) * k,
    y: vp.height / 2 - ((n.y || 0) + NODE_H / 2) * k,
    k,
  });
}

/* ------------------------------------------------------------------ */
/* Selection / reader                                                 */
/* ------------------------------------------------------------------ */
function selectNode(id, opts = {}) {
  const node = byId(id);
  if (!node) return;
  const prev = state.currentId ? byId(state.currentId) : null;
  if (prev && prev.id !== id) saveScroll(prev.id);
  state.currentId = id;
  if (!node.temp) localStorage.setItem("pt_current", id);

  let p = node.parentId ? byId(node.parentId) : null;
  let changed = false;
  while (p) {
    if (p.collapsed) {
      p.collapsed = false;
      changed = true;
    }
    p = p.parentId ? byId(p.parentId) : null;
  }
  if (changed) renderMap();

  if (!opts.keepQuote) clearQuote();
  renderReader();
  updateSelection();
  updateComposer();
  if (opts.center) centerOnNode(id);
  requestAnimationFrame(() => {
    els.readerScroll.scrollTop = node.scrollOffset || 0;
  });
}

function renderReader() {
  closeAnchorMenu();
  const node = state.currentId ? byId(state.currentId) : null;
  if (!node) {
    renderEmptyReader();
    return;
  }
  const path = pathOf(node);
  const color = rootColor(rootOf(node).id);
  els.readerPane.style.setProperty("--c", color);
  els.readerContent.style.setProperty("--c", color);
  renderBreadcrumb(path, node);
  els.depthPill.textContent = `第 ${path.length} 层`;

  const anchorHtml = node.anchor?.quote
    ? `<blockquote class="anchor-quote"><span class="aq-mark">“</span>${escapeHtml(node.anchor.quote)}<span class="aq-src">来自上一轮回答${node.anchor.page ? ` · p.${node.anchor.page}` : ""}</span></blockquote>`
    : "";

  const questionHtml = `
    <div class="role-row">
      <span class="role-avatar user">你</span>
      <span class="role-name">你问</span>
      <span class="role-time">${fmtFull(node.createdAt)}</span>
      <span class="role-rel">${relTime(node.createdAt)}</span>
    </div>
    <h1 class="question">${escapeHtml(node.question)}</h1>
    ${anchorHtml}`;

  let bodyHtml = "";
  if (node.status === "researching") {
    bodyHtml = renderResearchStatus(node);
  } else if (node.status === "error") {
    bodyHtml = `<div class="a-block"><div class="error-box">${escapeHtml(node.answer || "检索失败")}</div>${renderTrace(node)}</div>`;
  } else {
    const grade = node.grade || gradeFor(node);
    bodyHtml = `
      <div class="a-block">
        <div class="role-row">
          <span class="role-avatar ai">AI</span>
          <span class="role-name">研究回答</span>
          <span class="role-time">${node.completedAt ? fmtFull(node.completedAt) : fmtFull(node.createdAt)}</span>
          <span class="role-meta">${node.usage?.total_tokens ? `${node.usage.total_tokens.toLocaleString()} tokens` : ""}</span>
        </div>
        <div class="research-strip">
          <span class="grade-badge ${grade}">${GRADE_LABEL[grade] || "未验证"}</span>
          <span class="count">${(node.sources || []).length} 个来源</span>
          <span class="count">${(node.claims || []).length} 条 claim</span>
          ${node.isDemo ? '<span class="source-tag">示例数据</span>' : ""}
          <span class="spacer"></span>
          <span class="count">点击正文中的 [S#] 查看来源</span>
        </div>
        <div class="answer" id="answerBody"></div>
        ${renderSources(node)}
        ${renderClaims(node)}
        ${renderTrace(node)}
      </div>`;
  }

  els.readerContent.innerHTML = questionHtml + bodyHtml;
  if (node.status === "done" || node.status === "error") {
    const answerEl = $("#answerBody", els.readerContent);
    if (answerEl) {
      answerEl.innerHTML = renderAnswerHtml(node);
      highlightAnchors(answerEl, node);
    }
  }
}

function renderBreadcrumb(path, node) {
  els.breadcrumb.innerHTML = path
    .map((n, i) => {
      const current = n.id === node.id ? " current" : "";
      return `<button class="crumb${current}" data-id="${n.id}" title="${escapeHtml(n.question)}">${
        i === 0 ? `<span class="crumb-dot" style="background:${rootColor(rootOf(n).id)}"></span>` : ""
      }${escapeHtml(truncate(n.question, 18))}</button>`;
    })
    .join('<span class="crumb-sep">›</span>');
}

function renderResearchStatus(node) {
  const trace = node.trace || [];
  return `
    <div class="a-block">
      <div class="status-box">
        <div class="spinner"></div>
        <div style="flex:1;min-width:0">
          <div class="status-title">正在检索与验证…</div>
          <div class="status-sub">DeepSeek Search + OpenAlex / Crossref / arXiv / Semantic Scholar。完成后会显示来源与证据表。</div>
          <div class="status-lines" id="statusLines">
            ${trace.slice(-5).map((t) => `<div class="status-line"><span class="dotmark"></span><span>${escapeHtml(t.message)}</span></div>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

function renderSources(node) {
  const sources = node.sources || [];
  if (!sources.length) return "";
  return `
    <section class="section">
      <div class="section-head">
        <span class="section-title">来源</span>
        <span class="section-count">${sources.length}</span>
        <span class="section-note">点击查看摘要与证据</span>
      </div>
      <div class="source-list">
        ${sources.map((s) => `
          <div class="source-card" data-source="${s.id}">
            <div class="source-head">
              <span class="tier-badge tier-${s.tier}">${tierLabel(s.tier)}</span>
              <div style="flex:1;min-width:0">
                <div class="source-title">${escapeHtml(s.title || "Untitled")}</div>
                <div class="source-meta">${escapeHtml([s.authors?.slice(0, 3).join(", "), s.year, s.venue].filter(Boolean).join(" · "))}</div>
              </div>
            </div>
            <div class="source-foot">
              ${s.peerReviewed ? '<span class="source-tag peer">同行评审</span>' : s.type === "preprint" ? '<span class="source-tag">预印本</span>' : ""}
              ${s.retracted ? '<span class="source-tag warn">已撤稿</span>' : ""}
              ${s.doi ? '<span class="source-tag">DOI</span>' : ""}
              ${s.arxivId ? '<span class="source-tag">arXiv</span>' : ""}
              ${s.oaUrl ? `<a class="source-link" href="${safeUrl(s.oaUrl)}" target="_blank" rel="noreferrer">原文 ↗</a>` : s.url ? `<a class="source-link" href="${safeUrl(s.url)}" target="_blank" rel="noreferrer">链接 ↗</a>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </section>`;
}

function renderClaims(node) {
  const claims = node.claims || [];
  if (!claims.length) return "";
  return `
    <section class="section">
      <div class="section-head">
        <span class="section-title">证据表</span>
        <span class="section-count">${claims.length}</span>
        <span class="section-note">claim 级验证</span>
      </div>
      <div class="claims">
        ${claims.map((c) => `
          <div class="claim">
            <div class="claim-text">${escapeHtml(c.text)}</div>
            <div class="claim-meta">
              <span class="grade-badge ${c.verdict}">${VERDICT_LABEL[c.verdict] || c.verdict}</span>
              ${(c.sourceIds || []).map((id) => `<button class="cite" data-source="${id}">${id}</button>`).join("")}
              ${c.quoteVerified ? '<span class="verify-ok">✓ 引文已核对</span>' : c.quote ? '<span class="verify-warn">⚠ 引文未能在来源中精确匹配</span>' : '<span class="verify-warn">未提供原文 quote</span>'}
            </div>
            ${c.quote ? `<div class="claim-quote">“${escapeHtml(c.quote)}”</div>` : ""}
            ${c.note ? `<div class="claim-note">${escapeHtml(c.note)}</div>` : ""}
          </div>`).join("")}
      </div>
    </section>`;
}

function renderTrace(node) {
  const trace = node.trace || [];
  if (!trace.length) return "";
  return `
    <details class="trace" ${node.status === "researching" ? "open" : ""}>
      <summary><span class="trace-icon">◷</span> 研究轨迹 <span class="trace-count">${trace.length} 步</span></summary>
      <div class="trace-body">
        ${trace.map((t) => `
          <div class="trace-item">
            <span class="trace-at">${fmtTime(t.at)}</span>
            <span class="trace-type ${t.type}">${escapeHtml(t.type)}</span>
            <span class="trace-msg">${escapeHtml(t.message)}</span>
          </div>`).join("")}
      </div>
    </details>`;
}

function renderAnswerHtml(node) {
  let md = node.answer || "";
  // 把 [S1, S2] 规范成 [S1][S2]，方便逐个渲染
  md = md.replace(/\[(S\d+(?:\s*[,，]\s*S\d+)+)\]/g, (_, inner) =>
    inner.split(/[,，]/).map((x) => `[${x.trim()}]`).join("")
  );
  const html = markdownToHtml(md);
  const valid = new Set((node.sources || []).map((s) => s.id));
  return html.replace(/\[S(\d+)\]/g, (m, n) =>
    valid.has(`S${n}`)
      ? `<button class="cite" data-source="S${n}">S${n}</button>`
      : '<span class="cite unknown" title="来源不存在">?</span>'
  );
}

/* ------------------------------------------------------------------ */
/* Markdown (small, safe)                                             */
/* ------------------------------------------------------------------ */
function inlineMd(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

function markdownToHtml(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(4, h[1].length + 1);
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((x) => `<li>${inlineMd(x)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((x) => `<li>${inlineMd(x)}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inlineMd(quote.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|>\s|\s*[-*]\s|\s*\d+\.\s|\s*---+\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inlineMd(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

function highlightAnchors(answerEl, node) {
  const children = childrenOf(node.id).filter((c) => c.anchor?.quote);
  if (!children.length) return;
  const grouped = new Map();
  for (const child of children) {
    const q = child.anchor.quote.trim();
    if (!q) continue;
    if (!grouped.has(q)) grouped.set(q, []);
    grouped.get(q).push(child);
  }
  for (const [quote, kids] of grouped) {
    const walker = document.createTreeWalker(answerEl, NodeFilter.SHOW_TEXT, {
      acceptNode(t) {
        if (!t.nodeValue || !t.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (t.parentElement?.closest("code,pre,a,button,.cite,.anchor")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let target = null;
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.includes(quote)) {
        target = walker.currentNode;
        break;
      }
    }
    if (!target) continue;
    const idx = target.nodeValue.indexOf(quote);
    const range = document.createRange();
    range.setStart(target, idx);
    range.setEnd(target, idx + quote.length);
    const span = document.createElement("span");
    span.className = "anchor";
    span.dataset.child = kids[0].id;
    span.dataset.children = kids.map((k) => k.id).join(",");
    span.dataset.quote = quote;
    span.title = "查看 / 追加对这句话的追问";
    span.appendChild(range.extractContents());
    const badge = document.createElement("sup");
    badge.className = "anchor-badge";
    badge.textContent = String(kids.length);
    span.appendChild(badge);
    range.insertNode(span);
  }
}

/* ------------------------------------------------------------------ */
/* Composer / ask                                                     */
/* ------------------------------------------------------------------ */
function autoResize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(130, els.input.scrollHeight)}px`;
}

function updateSendState() {
  if (state.activeAsk) {
    els.sendBtn.disabled = false;
    els.sendBtn.classList.add("stop");
    els.sendBtn.textContent = "■";
    els.sendBtn.title = "停止";
    return;
  }
  els.sendBtn.classList.remove("stop");
  els.sendBtn.textContent = "↑";
  els.sendBtn.title = "发送";
  els.sendBtn.disabled = !els.input.value.trim();
}

function updateComposer() {
  updateSendState();
  const node = state.currentId ? byId(state.currentId) : null;
  els.understoodBtn.disabled = !node || node.status === "researching";
  els.input.disabled = false;
}

function setQuote(text) {
  state.pendingQuote = text;
  els.quoteText.textContent = truncate(text, 110);
  els.quoteChip.hidden = false;
  els.input.placeholder = "就这句话追问…";
  els.input.focus();
}

function clearQuote() {
  state.pendingQuote = null;
  els.quoteChip.hidden = true;
  els.quoteText.textContent = "";
  els.input.placeholder = "继续追问…（Enter 发送，Shift+Enter 换行）";
}

async function sendQuestion() {
  if (state.activeAsk) {
    state.activeAsk.controller.abort();
    return;
  }
  const question = els.input.value.trim();
  if (!question) return;
  const anchor = state.pendingQuote;
  els.input.value = "";
  autoResize();
  clearQuote();
  await ask({ parentId: state.currentId || null, question, anchor });
}

async function ask({ parentId, question, anchor }) {
  if (state.activeAsk) {
    toast("已有检索任务在运行");
    return;
  }
  const tempId = `tmp_${crypto.randomUUID()}`;
  const temp = {
    id: tempId,
    parentId,
    question,
    answer: "",
    status: "researching",
    createdAt: new Date().toISOString(),
    completedAt: null,
    anchor: anchor ? { quote: anchor, page: null } : null,
    mode: els.askMode.value,
    sources: [],
    claims: [],
    trace: [],
    usage: null,
    collapsed: false,
    understood: false,
    scrollOffset: 0,
    isDemo: state.config?.demo,
    temp: true,
  };
  state.nodes.push(temp);
  state.currentId = tempId;
  renderMap();
  renderReader();
  updateComposer();
  els.readerScroll.scrollTop = 0;

  const controller = new AbortController();
  state.activeAsk = { controller, tempId, nodeId: tempId };
  updateSendState();

  let activeId = tempId;
  const patchNode = (patch) => {
    const n = byId(activeId);
    if (n) Object.assign(n, patch);
  };

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId,
        question,
        anchor: anchor ? { quote: anchor } : null,
        mode: els.askMode.value,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt;
      try {
        msg = JSON.parse(txt).error || txt;
      } catch {
        // ignore
      }
      throw new Error(msg || `HTTP ${res.status}`);
    }

    await streamSse(res, {
      node: ({ node: real }) => {
        const old = byId(tempId);
        const idx = state.nodes.findIndex((n) => n.id === tempId);
        if (idx >= 0) {
          state.nodes.splice(idx, 1, { ...real, trace: old?.trace || [], sources: old?.sources || [], claims: old?.claims || [] });
        } else {
          state.nodes.push(real);
        }
        if (state.currentId === tempId) state.currentId = real.id;
        localStorage.setItem("pt_current", real.id);
        activeId = real.id;
        state.activeAsk.nodeId = real.id;
        renderMap();
        renderReader();
        updateComposer();
      },
      trace: (t) => {
        const n = byId(activeId);
        if (!n) return;
        n.trace.push(t);
        if (state.currentId === activeId) {
          const box = $("#statusLines", els.readerContent);
          if (box) {
            const div = document.createElement("div");
            div.className = "status-line";
            div.innerHTML = `<span class="dotmark"></span><span>${escapeHtml(t.message)}</span>`;
            box.appendChild(div);
            while (box.children.length > 6) box.firstElementChild.remove();
          }
        }
      },
      sources: (sources) => {
        const n = byId(activeId);
        if (!n) return;
        n.sources = sources;
        n.trace.push({ at: new Date().toISOString(), type: "sources", message: `已选定 ${sources.length} 个来源` });
        if (state.currentId === activeId) {
          renderReader();
          renderMap();
        }
      },
      answer: ({ answer, claims, grade }) => {
        const n = byId(activeId);
        if (!n) return;
        n.answer = answer;
        n.claims = claims || [];
        n.grade = grade || gradeFor(n);
        n.status = "done";
        n.completedAt = new Date().toISOString();
        if (state.currentId === activeId) {
          renderReader();
          renderMap();
        }
      },
      error: ({ message }) => {
        const n = byId(activeId);
        if (!n) return;
        n.status = "error";
        n.answer = message || "检索失败";
        if (state.currentId === activeId) {
          renderReader();
          renderMap();
        }
      },
      done: ({ node }) => {
        const n = byId(activeId);
        if (n && node) {
          Object.assign(n, {
            status: node.status,
            answer: node.answer || n.answer,
            claims: node.claims || n.claims,
            sources: node.sources || n.sources,
            trace: node.trace || n.trace,
            grade: node.grade || n.grade,
            usage: node.usage || n.usage,
            completedAt: node.completedAt || n.completedAt,
          });
        }
        if (state.currentId === activeId) {
          renderReader();
          renderMap();
        }
      },
    });
  } catch (err) {
    const n = byId(activeId);
    if (n) {
      if (err.name === "AbortError") {
        n.status = "error";
        n.answer = "已停止本次检索。";
      } else {
        n.status = "error";
        n.answer = `检索/回答失败：${err.message || err}`;
      }
      if (state.currentId === activeId) {
        renderReader();
        renderMap();
      }
    }
  } finally {
    state.activeAsk = null;
    updateComposer();
    updateSendState();
  }
}

/* ------------------------------------------------------------------ */
/* Collapse / understood                                              */
/* ------------------------------------------------------------------ */
async function toggleCollapse(id) {
  const node = byId(id);
  if (!node) return;
  node.collapsed = !node.collapsed;
  renderMap();
  try {
    await api(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ collapsed: node.collapsed }) });
  } catch {
    // ignore
  }
}

async function understoodAndBack() {
  const node = state.currentId ? byId(state.currentId) : null;
  if (!node) return;
  node.understood = true;
  if (childrenOf(node.id).length) node.collapsed = true;
  const parent = node.parentId ? byId(node.parentId) : null;
  renderMap();
  try {
    await api(`/api/nodes/${node.id}`, {
      method: "PATCH",
      body: JSON.stringify({ understood: true, collapsed: node.collapsed }),
    });
  } catch {
    // ignore
  }
  if (parent) {
    selectNode(parent.id, { center: true });
    toast("已收起当前分支，回到上一级");
  } else {
    renderReader();
    toast("已标记为理解");
  }
}

function saveScroll(id) {
  const node = byId(id);
  if (!node) return;
  node.scrollOffset = els.readerScroll.scrollTop;
  clearTimeout(state.scrollTimer);
  state.scrollTimer = setTimeout(() => {
    api(`/api/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ scrollOffset: node.scrollOffset }),
    }).catch(() => {});
  }, 500);
}

/* ------------------------------------------------------------------ */
/* Anchor menu                                                        */
/* ------------------------------------------------------------------ */
let anchorMenu = null;

function closeAnchorMenu() {
  if (anchorMenu) {
    anchorMenu.remove();
    anchorMenu = null;
  }
}

function openAnchorMenu(span) {
  const ids = (span.dataset.children || span.dataset.child || "").split(",").filter(Boolean);
  if (ids.length <= 1) {
    if (ids[0]) selectNode(ids[0], { center: true });
    return;
  }
  closeAnchorMenu();
  const pop = document.createElement("div");
  pop.className = "anchor-pop";
  pop.innerHTML = `
    <div class="pop-title">这句话的追问</div>
    <div class="pop-list">
      ${ids.map((id) => {
        const n = byId(id);
        return n ? `<button data-id="${id}"><span>${escapeHtml(n.question)}</span><em>${fmtTime(n.createdAt)}</em></button>` : "";
      }).join("")}
    </div>
    <div class="pop-foot"><button data-ask="1">＋ 就这句继续追问</button></div>`;
  document.body.appendChild(pop);
  const rect = span.getBoundingClientRect();
  const w = 280;
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - w - 12));
  let top = rect.bottom + 8;
  if (top + pop.offsetHeight > window.innerHeight - 12) top = Math.max(12, rect.top - pop.offsetHeight - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.querySelectorAll("[data-id]").forEach((b) => {
    b.addEventListener("click", () => {
      closeAnchorMenu();
      selectNode(b.dataset.id, { center: true });
    });
  });
  pop.querySelector("[data-ask]").addEventListener("click", () => {
    setQuote(span.dataset.quote || "");
    closeAnchorMenu();
  });
  anchorMenu = pop;
}

/* ------------------------------------------------------------------ */
/* Source drawer                                                      */
/* ------------------------------------------------------------------ */
function openSource(sourceId) {
  const node = state.currentId ? byId(state.currentId) : null;
  if (!node) return;
  const s = (node.sources || []).find((x) => x.id === sourceId);
  if (!s) return toast("找不到这个来源");
  const claims = (node.claims || []).filter((c) => (c.sourceIds || []).includes(sourceId));
  $("#drawerTitle").textContent = s.title || "Untitled";
  $("#drawerBody").innerHTML = `
    <div class="drawer-section">
      <div class="claim-meta" style="margin-top:0">
        <span class="tier-badge tier-${s.tier}">${tierLabel(s.tier)}</span>
        ${s.peerReviewed ? '<span class="source-tag peer">同行评审</span>' : ""}
        ${s.type === "preprint" ? '<span class="source-tag">预印本</span>' : ""}
        ${s.retracted ? '<span class="source-tag warn">已撤稿</span>' : ""}
        ${s.authority >= 0 && s.authority != null ? `<span class="source-tag">网页权威度 ${s.authority}/4</span>` : ""}
      </div>
    </div>
    <div class="drawer-section">
      <h4>作者 / 出处</h4>
      <p>${escapeHtml((s.authors || []).join(", ") || "未知作者")}</p>
      <p>${escapeHtml([s.year, s.venue].filter(Boolean).join(" · ") || "未知出处")}</p>
    </div>
    <div class="drawer-section">
      <h4>摘要 / 正文片段</h4>
      <div class="drawer-quote">${escapeHtml(s.abstract || s.content || "无摘要")}</div>
    </div>
    <div class="drawer-section">
      <h4>标识</h4>
      <p class="mono">${escapeHtml([s.doi ? `DOI: ${s.doi}` : "", s.arxivId ? `arXiv: ${s.arxivId}` : "", s.pmid ? `PMID: ${s.pmid}` : "", s.url ? `URL: ${s.url}` : ""].filter(Boolean).join("\n") || "无")}</p>
    </div>
    ${claims.length ? `
      <div class="drawer-section">
        <h4>用它支撑的 claim</h4>
        ${claims.map((c) => `<div class="claim" style="margin-bottom:7px"><div class="claim-text">${escapeHtml(c.text)}</div>${c.quote ? `<div class="claim-quote">“${escapeHtml(c.quote)}”</div>` : ""}</div>`).join("")}
      </div>` : ""}
    <div class="drawer-actions">
      ${s.oaUrl ? `<a href="${safeUrl(s.oaUrl)}" target="_blank" rel="noreferrer">打开 OA 原文 ↗</a>` : ""}
      ${s.url ? `<a href="${safeUrl(s.url)}" target="_blank" rel="noreferrer">打开链接 ↗</a>` : ""}
      ${s.doi ? `<a href="https://doi.org/${escapeHtml(s.doi)}" target="_blank" rel="noreferrer">DOI ↗</a>` : ""}
      <button id="copySource">复制引用信息</button>
    </div>`;
  els.drawerBackdrop.hidden = false;
  els.sourceDrawer.classList.add("open");
  els.sourceDrawer.setAttribute("aria-hidden", "false");
  $("#copySource")?.addEventListener("click", async () => {
    const text = `${s.authors?.join(", ") || ""} (${s.year || "n.d."}). ${s.title}. ${s.venue || ""}. ${s.doi ? `https://doi.org/${s.doi}` : s.url || ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("引用信息已复制");
    } catch {
      toast("复制失败");
    }
  });
}

function closeDrawer() {
  els.sourceDrawer.classList.remove("open");
  els.sourceDrawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
}

/* ------------------------------------------------------------------ */
/* Settings / new root                                                */
/* ------------------------------------------------------------------ */
function renderApiStatus() {
  const c = state.config || {};
  const box = $("#apiStatus");
  if (!box) return;
  if (state.desktop) {
    const has = Boolean(state.desktopInfo?.hasKey || c.mode === "live");
    box.className = has ? "api-status ok" : "api-status demo";
    box.innerHTML = has
      ? `DESKTOP · DeepSeek Key 已配置（本机加密保存）。检索会走 DeepSeek Search + 学术 API。`
      : `DESKTOP · 还没有配置 DeepSeek Key。填入下方 Key 并保存，应用会自动重启本地检索服务。`;
    return;
  }
  if (c.mode === "live") {
    box.className = "api-status ok";
    box.innerHTML = `LIVE · DeepSeek 已配置（${escapeHtml(c.model || "deepseek-flash")}）。检索会走 DeepSeek Search + 学术 API。`;
  } else {
    box.className = "api-status demo";
    box.innerHTML = `DEMO · 未配置 <code>DEEPSEEK_API_KEY</code>。当前使用内置示例树；配置后重启即可真实检索。`;
  }
}

function openSettings() {
  const s = state.session || {};
  $("#sessionTitleInput").value = s.title || "";
  $("#paperTitleInput").value = s.paperTitle || "";
  $("#paperTextInput").value = s.paperText || "";
  $("#modeInput").value = s.mode === "web" ? "web" : "academic";
  renderApiStatus();
  const desktopField = $("#desktopKeyField");
  if (desktopField) desktopField.hidden = !state.desktop;
  const keyHelp = $("#keyHelp");
  keyHelp.hidden = Boolean(state.desktop);
  if (!state.desktop) {
    keyHelp.innerHTML =
      state.config?.mode === "live"
        ? "API Key 只在服务端读取，不会发送到浏览器。要换 key，修改 <code>app/.env</code> 后重启服务。"
        : "配置方式：复制 <code>app/.env.example</code> 为 <code>app/.env</code>，填入 <code>DEEPSEEK_API_KEY</code>，重启 <code>node app/server.mjs</code>。";
  }
  if (state.desktop) {
    const keyInput = $("#desktopKeyInput");
    if (keyInput) keyInput.value = "";
  }
  els.settingsModal.hidden = false;
}

function closeSettings() {
  els.settingsModal.hidden = true;
}

async function saveSettings() {
  try {
    const body = {
      title: $("#sessionTitleInput").value.trim(),
      paperTitle: $("#paperTitleInput").value.trim(),
      paperText: $("#paperTextInput").value,
      mode: $("#modeInput").value,
    };
    const data = await api("/api/settings", { method: "POST", body: JSON.stringify(body) });
    state.session = data.session;
    renderShell();
    closeSettings();
    toast("设置已保存");
  } catch (err) {
    toast(`保存失败：${err.message}`);
  }
}

async function saveDesktopKey(clear = false) {
  if (!state.desktop) return;
  if (clear && !confirm("清除已保存的 API Key？应用会回到演示模式。")) return;
  const input = $("#desktopKeyInput");
  const key = clear ? "" : input.value.trim();
  if (!clear && !key) {
    toast("请先输入 DeepSeek API Key");
    input?.focus();
    return;
  }
  const btn = clear ? $("#clearDesktopKey") : $("#saveDesktopKey");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    await state.desktop.setApiKey(key);
    toast(clear ? "已清除 Key，正在切换演示模式…" : "Key 已保存，正在重启检索服务…");
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(`保存失败：${err.message || err}`);
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function resetAll() {
  if (!confirm("确定清空所有节点？论文设置会保留。")) return;
  const data = await api("/api/reset", { method: "POST" });
  state.nodes = data.nodes || [];
  state.currentId = null;
  state.roots = [];
  localStorage.removeItem("pt_current");
  closeSettings();
  renderShell();
  renderMap();
  renderEmptyReader();
  updateComposer();
  toast("已清空");
}

async function loadDemo() {
  const data = await api("/api/demo", { method: "POST" });
  state.nodes = data.nodes || [];
  state.currentId = null;
  state.roots = state.nodes.filter((n) => !n.parentId);
  closeSettings();
  renderShell();
  renderMap();
  if (state.nodes.length) {
    selectNode(state.nodes[0].id, { center: true });
  } else {
    renderEmptyReader();
  }
  toast("已载入示例树");
}

function openNewRoot() {
  $("#newRootInput").value = "";
  els.newRootModal.hidden = false;
  setTimeout(() => $("#newRootInput").focus(), 30);
}

function closeNewRoot() {
  els.newRootModal.hidden = true;
}

async function submitNewRoot() {
  const q = $("#newRootInput").value.trim();
  if (!q) return;
  closeNewRoot();
  state.currentId = null;
  renderEmptyReader();
  await ask({ parentId: null, question: q, anchor: null });
}

/* ------------------------------------------------------------------ */
/* Empty state                                                        */
/* ------------------------------------------------------------------ */
function renderEmptyReader() {
  const suggestions = [
    "FlashAttention 真的把 attention 复杂度降到 O(n) 了吗？",
    "这篇论文的核心贡献是什么？",
    "位置编码为什么用正弦函数，而不是可学习参数？",
  ];
  els.breadcrumb.innerHTML = "";
  els.depthPill.textContent = "—";
  els.readerContent.innerHTML = `
    <div class="reader-empty">
      <div class="empty-map-icon">🌱</div>
      <h2>开始你的第一棵树</h2>
      <p>先在设置里粘贴论文摘要或关键章节，然后问一个具体的问题。回答里的任意句子都可以继续追问，长成树；也可以随时开一个新的树根。</p>
      <button class="btn primary" id="emptySettingsBtn2">设置论文</button>
      <div class="suggestions">
        ${suggestions.map((s) => `<button class="suggestion" data-suggest="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}
      </div>
    </div>`;
  $("#emptySettingsBtn2")?.addEventListener("click", openSettings);
  $$("[data-suggest]", els.readerContent).forEach((b) => {
    b.addEventListener("click", () => ask({ parentId: null, question: b.dataset.suggest, anchor: null }));
  });
  els.readerPane.style.setProperty("--c", COLORS[0]);
}

/* ------------------------------------------------------------------ */
/* Map events                                                         */
/* ------------------------------------------------------------------ */
function bindMapEvents() {
  let drag = null;
  els.viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".node") || e.target.closest("button")) return;
    els.canvas.classList.remove("anim");
    drag = { sx: e.clientX, sy: e.clientY, ox: state.view.x, oy: state.view.y };
    els.viewport.classList.add("dragging");
    els.viewport.setPointerCapture(e.pointerId);
  });
  els.viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    state.view.x = drag.ox + (e.clientX - drag.sx);
    state.view.y = drag.oy + (e.clientY - drag.sy);
    applyView();
  });
  const end = () => {
    drag = null;
    els.viewport.classList.remove("dragging");
  };
  els.viewport.addEventListener("pointerup", end);
  els.viewport.addEventListener("pointercancel", end);
  els.viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = els.viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.min(1.7, Math.max(0.32, state.view.k * Math.exp(-e.deltaY * 0.0012)));
    state.view.x = mx - (mx - state.view.x) * (next / state.view.k);
    state.view.y = my - (my - state.view.y) * (next / state.view.k);
    state.view.k = next;
    applyView();
  }, { passive: false });
}

/* ------------------------------------------------------------------ */
/* Selection toolbar                                                  */
/* ------------------------------------------------------------------ */
let selToolbar = null;
function hideSelToolbar() {
  if (selToolbar) {
    selToolbar.remove();
    selToolbar = null;
  }
}

function showSelToolbar(rect, text) {
  hideSelToolbar();
  const bar = document.createElement("div");
  bar.className = "sel-toolbar";
  bar.innerHTML = `<button data-a="ask">就这句追问</button><span class="st-sep"></span><button data-a="explain">解释一下</button>`;
  document.body.appendChild(bar);
  const w = bar.offsetWidth;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 12);
  let top = rect.top - 42;
  if (top < 64) top = rect.bottom + 8;
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
  bar.querySelector('[data-a="ask"]').addEventListener("click", () => {
    setQuote(text);
    hideSelToolbar();
  });
  bar.querySelector('[data-a="explain"]').addEventListener("click", () => {
    setQuote(text);
    els.input.value = "解释一下这句话：";
    autoResize();
    updateSendState();
    hideSelToolbar();
    els.input.focus();
  });
  selToolbar = bar;
}

/* ------------------------------------------------------------------ */
/* Global bindings                                                    */
/* ------------------------------------------------------------------ */
function bindUI() {
  $("#fitBtn").addEventListener("click", fitView);
  $("#focusBtn").addEventListener("click", () => {
    state.focusMode = !state.focusMode;
    $("#focusBtn").classList.toggle("active", state.focusMode);
    updateSelection();
  });
  $("#collapseBtn").addEventListener("click", () => {
    state.collapsedOthers = !state.collapsedOthers;
    const path = state.currentId ? new Set(pathOf(byId(state.currentId)).map((n) => n.id)) : new Set();
    for (const n of state.nodes) {
      if (childrenOf(n.id).length) n.collapsed = state.collapsedOthers && !path.has(n.id);
    }
    renderMap();
    $("#collapseBtn").classList.toggle("active", state.collapsedOthers);
    $("#collapseBtn").textContent = state.collapsedOthers ? "展开分支" : "折叠分支";
  });
  $("#searchBtn").addEventListener("click", () => {
    const q = prompt("搜索节点（问题 / 回答）");
    if (!q) return;
    const needle = q.toLowerCase();
    const hit = state.nodes.find(
      (n) => n.question.toLowerCase().includes(needle) || (n.answer || "").toLowerCase().includes(needle)
    );
    if (hit) selectNode(hit.id, { center: true });
    else toast("没有找到匹配节点");
  });

  $("#settingsBtn").addEventListener("click", openSettings);
  $("#emptySettingsBtn").addEventListener("click", openSettings);
  if (state.desktop) {
    $("#saveDesktopKey")?.addEventListener("click", () => saveDesktopKey(false));
    $("#clearDesktopKey")?.addEventListener("click", () => saveDesktopKey(true));
    $("#openDataDir")?.addEventListener("click", () => state.desktop.openDataDir().catch(() => {}));
  }
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#cancelSettings").addEventListener("click", closeSettings);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#resetBtn").addEventListener("click", resetAll);
  $("#demoBtn").addEventListener("click", loadDemo);
  $("#settingsModal").addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  $("#newRootBtn").addEventListener("click", openNewRoot);
  $("#closeNewRoot").addEventListener("click", closeNewRoot);
  $("#cancelNewRoot").addEventListener("click", closeNewRoot);
  $("#submitNewRoot").addEventListener("click", submitNewRoot);
  $("#newRootModal").addEventListener("click", (e) => {
    if (e.target === els.newRootModal) closeNewRoot();
  });
  $("#newRootInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitNewRoot();
    }
  });

  $("#closeDrawer").addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);

  $("#clearQuote").addEventListener("click", () => {
    clearQuote();
    els.input.focus();
  });
  els.input.addEventListener("input", () => {
    autoResize();
    updateSendState();
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendQuestion();
    }
  });
  els.sendBtn.addEventListener("click", sendQuestion);
  els.understoodBtn.addEventListener("click", understoodAndBack);
  els.askMode.addEventListener("change", () => {
    api("/api/settings", { method: "POST", body: JSON.stringify({ mode: els.askMode.value }) }).catch(() => {});
  });

  els.breadcrumb.addEventListener("click", (e) => {
    const b = e.target.closest(".crumb");
    if (b) selectNode(b.dataset.id, { center: true });
  });

  els.readerContent.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const cite = e.target.closest(".cite");
    if (cite) {
      if (cite.dataset.source) openSource(cite.dataset.source);
      return;
    }
    const source = e.target.closest(".source-card");
    if (source) {
      openSource(source.dataset.source);
      return;
    }
    const anchor = e.target.closest(".anchor");
    if (anchor) {
      openAnchorMenu(anchor);
    }
  });

  document.addEventListener("mousedown", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (!t.closest(".sel-toolbar")) hideSelToolbar();
    if (!t.closest(".anchor-pop") && !t.closest(".anchor")) closeAnchorMenu();
  });

  document.addEventListener("mouseup", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest(".sel-toolbar") || t.closest(".modal-backdrop") || t.closest(".drawer")) return;
    const answer = t.closest(".answer");
    if (!answer) {
      hideSelToolbar();
      return;
    }
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        hideSelToolbar();
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 2) {
        hideSelToolbar();
        return;
      }
      const range = sel.getRangeAt(0);
      if (!answer.contains(range.commonAncestorContainer)) {
        hideSelToolbar();
        return;
      }
      showSelToolbar(range.getBoundingClientRect(), text);
    }, 10);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.settingsModal.hidden) {
        closeSettings();
        return;
      }
      if (!els.newRootModal.hidden) {
        closeNewRoot();
        return;
      }
      if (els.sourceDrawer.classList.contains("open")) {
        closeDrawer();
        return;
      }
      if (anchorMenu) {
        closeAnchorMenu();
        return;
      }
      if (selToolbar) {
        hideSelToolbar();
        return;
      }
      if (document.activeElement === els.input) {
        els.input.blur();
        return;
      }
      const node = state.currentId ? byId(state.currentId) : null;
      if (node?.parentId) selectNode(node.parentId, { center: true });
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#searchBtn").click();
    }
  });

  els.readerScroll.addEventListener("scroll", () => {
    if (selToolbar) hideSelToolbar();
    const node = state.currentId ? byId(state.currentId) : null;
    if (node) node.scrollOffset = els.readerScroll.scrollTop;
  }, { passive: true });

  window.addEventListener("resize", () => updateSelection());
  bindMapEvents();
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */
async function init() {
  if (window.desktop?.isDesktop) {
    state.desktop = window.desktop;
    try {
      state.desktopInfo = await window.desktop.getInfo();
    } catch {
      state.desktopInfo = null;
    }
  }
  bindUI();
  try {
    await loadState();
  } catch (err) {
    els.readerContent.innerHTML = `<div class="reader-empty"><h2>加载失败</h2><p>${escapeHtml(err.message || String(err))}</p><p>请确认服务已启动：<code>node app/server.mjs</code></p></div>`;
  }
}

init();

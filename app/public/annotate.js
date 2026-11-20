/* PaperTree annotation UI */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const COLORS = ["#4f63e8", "#c47a1a", "#0f8a6a", "#b83f72", "#6b5bd2"];
const TZ = "Asia/Shanghai";
const NOTE_W = 340;
const NOTE_H = 280;

const state = {
  session: null,
  config: null,
  nodes: [],
  roots: [],
  currentId: null,
  focusedNote: null,
  maximizedNote: null,
  sidebarCollapsed: false,
  minimizedNotes: new Set(),
  openedNotes: new Set(),
  activeAsk: null,
  drafts: new Map(),
  noteNumbers: new Map(),
  nodeEls: new Map(),
  graphView: { x: 0, y: 0, k: 1 },
  desktop: null,
  desktopInfo: null,
  scrollTimer: null,
  noteSaveTimer: null,
};

const els = {
  sessionTitle: $("#sessionTitle"),
  paperChip: $("#paperChip"),
  modeBadge: $("#modeBadge"),
  tree: $("#tree"),
  treeCount: $("#treeCount"),
  thread: $("#thread"),
  threadScroll: $("#threadScroll"),
  chatMain: $("#chatMain"),
  composer: $("#composer"),
  input: $("#input"),
  sendBtn: $("#sendBtn"),
  quoteChip: $("#quoteChip"),
  quoteText: $("#quoteText"),
  askMode: $("#askMode"),
  threadHint: $("#threadHint"),
  notes: $("#notes"),
  connectors: $("#connectors"),
  connectorsTop: $("#connectorsTop"),
  annotationLayer: $("#annotationLayer"),
  noteBackdrop: $("#noteBackdrop"),
  sidebar: $("#sidebar"),
  toggleNotes: $("#toggleNotes"),
  sourceDrawer: $("#sourceDrawer"),
  drawerBackdrop: $("#drawerBackdrop"),
  settingsModal: $("#settingsModal"),
  graphModal: $("#graphModal"),
  graphViewport: $("#graphViewport"),
  graphCanvas: $("#graphCanvas"),
  graphEdges: $("#graphEdges"),
  graphNodes: $("#graphNodes"),
  toast: $("#toast"),
};

/* ------------------------------------------------------------------ */
/* utils                                                              */
/* ------------------------------------------------------------------ */
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
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

function childrenOf(id) {
  return state.nodes.filter((n) => n.parentId === id);
}

function pathOf(node) {
  const out = [];
  let cur = node;
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? byId(cur.parentId) : null;
  }
  return out;
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

function isVisibleInTree(node) {
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

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2300);
}

function safeUrl(url) {
  const s = String(url || "").trim();
  return /^https?:\/\//i.test(s) ? escapeHtml(s) : "";
}

const GRADE_LABEL = {
  strong: "强证据",
  moderate: "中等",
  "single-source": "单一来源",
  contested: "争议",
  retracted: "撤稿",
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

function buildNoteNumbers() {
  const notes = state.nodes
    .filter((n) => n.parentId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  state.noteNumbers = new Map(notes.map((n, i) => [n.id, i + 1]));
}

function noteNumber(id) {
  return state.noteNumbers.get(id) || "•";
}

/* ------------------------------------------------------------------ */
/* markdown / citations                                               */
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

function renderAnswerHtml(node) {
  let md = node.answer || "";
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
/* load / shell                                                       */
/* ------------------------------------------------------------------ */
async function loadState() {
  const data = await api("/api/state");
  state.session = data.session;
  state.config = data.config || { mode: "demo", demo: true };
  state.nodes = (data.nodes || []).map((n) => ({
    ...n,
    sources: n.sources || [],
    claims: n.claims || [],
    trace: n.trace || [],
    collapsed: Boolean(n.collapsed),
    understood: Boolean(n.understood),
  }));
  state.roots = state.nodes.filter((n) => !n.parentId);
  buildNoteNumbers();

  const saved = localStorage.getItem("pt_current");
  let target =
    state.currentId && byId(state.currentId)
      ? state.currentId
      : saved && byId(saved)
        ? saved
        : state.roots[0]?.id || null;
  if (target && byId(target)?.parentId) target = rootOf(byId(target)).id;
  state.currentId = target;
  state.focusedNote = null;
  restoreNoteViewState();
  renderAll();
  if (target) requestAnimationFrame(() => scrollToNode(target, true));
}

function renderAll() {
  renderShell();
  renderSidebar();
  renderThread();
  renderNotes();
  updateComposer();
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
  document.title = `${s.title || "PaperTree"} · PaperTree`;
  applySidebar();
}

function applySidebar() {
  document.querySelector(".app-body")?.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const fold = $("#sidebarFold");
  const unfold = $("#sidebarUnfold");
  if (fold) fold.hidden = state.sidebarCollapsed;
  if (unfold) unfold.hidden = !state.sidebarCollapsed;
}

/* ------------------------------------------------------------------ */
/* sidebar tree                                                       */
/* ------------------------------------------------------------------ */
function renderSidebar() {
  state.roots = state.nodes.filter((n) => !n.parentId);
  const path = state.currentId ? pathOf(byId(state.currentId)) : [];
  const pathSet = new Set(path.map((n) => n.id));
  els.tree.innerHTML = "";

  if (!state.roots.length) {
    els.tree.innerHTML = '<div class="tree-empty">还没有提问。<br>在右侧问第一个问题，或点右上角「＋」新开树根。</div>';
    els.treeCount.textContent = "0";
    return;
  }

  state.roots.forEach((root, index) => {
    const label = document.createElement("div");
    label.className = "tree-root-label";
    label.innerHTML = `<span class="tree-root-dot" style="--c:${rootColor(root.id)}"></span>树 ${index + 1} · ${index === 0 ? "主线" : escapeHtml(truncate(root.question, 16))}`;
    els.tree.appendChild(label);

    const renderNode = (node, depth) => {
      const kids = childrenOf(node.id);
      const hasKids = kids.length > 0;
      const row = document.createElement("div");
      row.className =
        "tree-row" +
        (pathSet.has(node.id) ? " active" : "") +
        (node.id === state.currentId ? " current" : "") +
        (node.understood ? " understood" : "");
      row.style.paddingLeft = `${depth * 13 + 2}px`;
      const grade = node.grade || gradeFor(node);
      const sourceCount = (node.sources || []).length;
      const researching = node.status === "researching";
      row.innerHTML = `
        <button class="tree-toggle ${hasKids ? "" : "empty"}" data-toggle="${node.id}">${node.collapsed ? "+" : "−"}</button>
        <span class="tree-title" title="${escapeHtml(node.question)}">${escapeHtml(node.question)}</span>
        <span class="tree-meta">
          ${researching ? '<span class="tree-badge warn">检索中</span>' : hasKids ? `<span class="tree-badge" title="子问题数量">${kids.length} 批</span>` : ""}
          ${sourceCount ? `<span class="tree-badge src" title="来源数量">${sourceCount} 源</span>` : ""}
          <span class="tree-badge" title="创建时间">${fmtTime(node.createdAt)}</span>
        </span>`;
      row.addEventListener("click", (e) => {
        if (e.target.closest("[data-toggle]")) return;
        selectNode(node.id);
      });
      row.querySelector("[data-toggle]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTree(node.id);
      });
      const item = document.createElement("div");
      item.className = "tree-item";
      item.appendChild(row);
      if (hasKids && !node.collapsed) {
        const wrap = document.createElement("div");
        wrap.className = "tree-children";
        kids.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        kids.forEach((child) => {
          if (isVisibleInTree(child)) renderNodeTo(child, depth + 1, wrap);
        });
        item.appendChild(wrap);
      }
      return item;
    };

    const renderNodeTo = (node, depth, parent) => {
      const el = renderNode(node, depth);
      parent.appendChild(el);
    };

    els.tree.appendChild(renderNode(root, 0));
  });

  els.treeCount.textContent = `${state.nodes.length}`;
}

async function toggleTree(id) {
  const node = byId(id);
  if (!node) return;
  node.collapsed = !node.collapsed;
  renderSidebar();
  try {
    await api(`/api/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ collapsed: node.collapsed }) });
  } catch {
    // ignore
  }
}

function expandAncestors(node) {
  const path = pathOf(node);
  let changed = false;
  for (const n of path.slice(0, -1)) {
    if (n.collapsed) {
      n.collapsed = false;
      changed = true;
    }
  }
  return changed;
}

function selectNode(id, opts = {}) {
  const node = byId(id);
  if (!node) return;
  expandAncestors(node);
  const root = rootOf(node);
  const isRoot = !node.parentId;
  if (!isRoot) {
    unminimizePath(node.id);
    revealNoteChain(node.id);
  }
  state.currentId = root.id;
  state.focusedNote = isRoot ? null : node.id;
  state.maximizedNote = null;
  saveNoteViewState();
  localStorage.setItem("pt_current", root.id);
  if (window.innerWidth < 900 && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true;
    applySidebar();
  }
  renderSidebar();
  renderThread();
  renderNotes();
  updateComposer();
  if (!opts.noScroll) requestAnimationFrame(() => scrollToNode(root.id, false));
}

function scrollToNode(id, instant = false) {
  const msg = els.thread.querySelector(`[data-node="${id}"]`);
  if (msg) {
    msg.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });
  } else {
    els.threadScroll.scrollTop = els.threadScroll.scrollHeight;
  }
}

/* ------------------------------------------------------------------ */
/* thread                                                             */
/* ------------------------------------------------------------------ */
function renderThread() {
  const roots = state.nodes
    .filter((n) => !n.parentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (!roots.length) {
    renderEmptyThread();
    return;
  }
  const keepScroll = els.threadScroll.scrollTop;
  els.thread.innerHTML = roots.map((node) => threadMessageHtml(node, 0)).join("");

  for (const node of roots) {
    if (node.status === "done" || node.status === "error") {
      const answerEl = els.thread.querySelector(`.answer[data-node-id="${node.id}"]`);
      if (answerEl) {
        answerEl.innerHTML = renderAnswerHtml(node);
        decorateAnchors(node, answerEl);
      }
    }
  }
  els.threadScroll.scrollTop = keepScroll;
  els.threadHint.textContent = `${roots.length} 棵树根 · 连续浏览`;
  bindThreadEvents();
}

function threadMessageHtml(node, index) {
  const grade = node.grade || gradeFor(node);
  const sourceCount = (node.sources || []).length;
  const noteCount = childrenOf(node.id).length;
  let body = "";
  if (node.status === "researching") {
    body = `<div class="status-box"><div class="spinner"></div><div style="flex:1;min-width:0"><div class="status-title">正在检索与验证…</div><div class="status-sub">DeepSeek Search + 学术 API</div><div class="status-lines">${(node.trace || []).slice(-4).map((t) => `<div class="status-line"><span class="dotmark"></span><span>${escapeHtml(t.message)}</span></div>`).join("")}</div></div></div>`;
  } else if (node.status === "error") {
    body = `<div class="error-box">${escapeHtml(node.answer || "检索失败")}</div>`;
  } else {
    body = `<div class="ai-body"><div class="answer" data-node-id="${node.id}"></div></div>`;
  }

  return `
    <section class="msg user" data-node="${node.id}">
      <div class="bubble">${escapeHtml(node.question)}</div>
      <div class="meta">${fmtFull(node.createdAt)} · ${relTime(node.createdAt)}</div>
    </section>
    <section class="msg ai" data-node="${node.id}">
      <div class="ai-head">
        <span class="ai-avatar">AI</span>
        <span class="ai-name">研究回答</span>
        <span>${fmtTime(node.completedAt || node.createdAt)}</span>
        ${node.usage?.total_tokens ? `<span>${node.usage.total_tokens.toLocaleString()} tokens</span>` : ""}
        <span class="ai-meta">${node.anchor?.quote ? "基于选中的句子" : "树根"}</span>
      </div>
      ${node.anchor?.quote ? `<blockquote class="anchor-quote" style="margin-bottom:10px"><span class="aq-mark">“</span>${escapeHtml(node.anchor.quote)}<span class="aq-src">来自上一回答</span></blockquote>` : ""}
      ${body}
      ${node.status === "done" ? `
        <div class="ai-foot">
          <span class="grade-badge ${grade}">${GRADE_LABEL[grade] || "未验证"}</span>
          ${sourceCount ? `<span class="source-pill" data-sources="${node.id}">${sourceCount} 个来源</span>` : ""}
          ${(node.claims || []).length ? `<span class="note-pill" data-claims="${node.id}">${node.claims.length} 条 claim</span>` : ""}
          ${noteCount ? `<span class="note-pill" data-notes="${node.id}">${noteCount} 个分支</span>` : ""}
          <span class="spacer"></span>
          <button class="link-btn" data-locate="${node.id}">在主对话定位</button>
        </div>` : ""}
    </section>`;
}

function renderEmptyThread() {
  els.thread.innerHTML = `
    <div class="empty-chat">
      <div class="empty-map-icon">🌱</div>
      <h2>边读边批注</h2>
      <p>先在设置里粘贴论文摘要或关键章节，然后问第一个问题。<br>回答里的任意句子都可以选中，新建一张批注便签；便签会浮在右侧，并用线指向原句。</p>
      <div class="suggestions">
        <button class="suggestion" data-suggest="这篇论文的核心贡献是什么？">这篇论文的核心贡献是什么？</button>
        <button class="suggestion" data-suggest="FlashAttention 真的把 attention 复杂度降到 O(n) 了吗？">FlashAttention 真的是 O(n) 吗？</button>
        <button class="suggestion" data-suggest="位置编码为什么用正弦函数？">位置编码为什么用正弦？</button>
      </div>
    </div>`;
  $$("[data-suggest]", els.thread).forEach((b) =>
    b.addEventListener("click", () => ask({ parentId: null, question: b.dataset.suggest, asNote: false }))
  );
  els.threadHint.textContent = "新会话";
}

function bindingForAnswer(answerEl) {
  return answerEl.closest(".note") ? answerEl.closest(".note").dataset.id : answerEl.closest("[data-node-id]")?.dataset.nodeId;
}

function decorateAnchors(parentNode, answerEl) {
  const mainSet = new Set(state.nodes.filter((n) => !n.parentId).map((n) => n.id));
  const kids = childrenOf(parentNode.id).filter((c) => c.anchor?.quote && !mainSet.has(c.id));
  if (!kids.length) return;

  const grouped = new Map();
  for (const child of kids) {
    const q = child.anchor.quote.trim();
    if (!grouped.has(q)) grouped.set(q, []);
    grouped.get(q).push(child);
  }

  const textNodes = () => {
    const out = [];
    const walker = document.createTreeWalker(answerEl, NodeFilter.SHOW_TEXT, {
      acceptNode(t) {
        if (!t.nodeValue || !t.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (t.parentElement?.closest("code,pre,a,button,.cite,.anchor")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  };

  const findText = (nodes, needle) => {
    for (const node of nodes) {
      const idx = node.nodeValue.indexOf(needle);
      if (idx >= 0) return { node, idx, len: needle.length };
    }
    return null;
  };

  for (const [quote, group] of grouped) {
    const nodes = textNodes();
    let hit = findText(nodes, quote);
    if (!hit) {
      // 引文可能跨过 <strong>/<sup> 等行内标签，退化为命中引文的一段
      const candidates = [
        quote.slice(0, 12),
        quote.slice(0, 8),
        quote.slice(0, 6),
        quote.slice(-12),
        quote.slice(-8),
        quote.slice(-6),
      ].filter((s) => s.trim().length >= 4);
      for (const candidate of candidates) {
        hit = findText(nodes, candidate);
        if (hit) break;
      }
    }
    if (!hit) continue;
    const target = hit.node;
    const range = document.createRange();
    range.setStart(target, hit.idx);
    range.setEnd(target, hit.idx + hit.len);
    const span = document.createElement("span");
    span.className = "anchor";
    span.dataset.noteId = group[0].id;
    span.dataset.quote = quote;
    span.title = "点击查看 / 收起批注";
    span.appendChild(range.extractContents());
    const num = document.createElement("sup");
    num.className = "anchor-num";
    num.textContent = group.length > 1 ? String(group.length) : String(noteNumber(group[0].id));
    span.appendChild(num);
    range.insertNode(span);
  }
}

/* ------------------------------------------------------------------ */
/* notes                                                              */
/* ------------------------------------------------------------------ */
function noteDescendants(id, out = []) {
  for (const child of childrenOf(id)) {
    out.push(child.id);
    noteDescendants(child.id, out);
  }
  return out;
}

function minimizeSubtree(id, persist = true) {
  const ids = [id, ...noteDescendants(id)];
  for (const noteId of ids) state.minimizedNotes.add(noteId);
  hideNoteSubtree(id);
  if (state.focusedNote && ids.includes(state.focusedNote)) state.focusedNote = null;
  if (state.maximizedNote && ids.includes(state.maximizedNote)) state.maximizedNote = null;
  if (persist) saveNoteViewState();
}

function unminimizePath(id) {
  let cur = byId(id);
  while (cur) {
    state.minimizedNotes.delete(cur.id);
    cur = cur.parentId ? byId(cur.parentId) : null;
  }
}

function revealNoteChain(id) {
  let cur = byId(id);
  while (cur && cur.parentId) {
    state.openedNotes.add(cur.id);
    cur = byId(cur.parentId);
  }
}

function hideNoteSubtree(id) {
  for (const noteId of [id, ...noteDescendants(id)]) state.openedNotes.delete(noteId);
}

function hasMinimizedAncestor(id) {
  let cur = byId(id);
  while (cur?.parentId) {
    cur = byId(cur.parentId);
    if (cur && state.minimizedNotes.has(cur.id)) return true;
  }
  return false;
}

function allNotesMinimized() {
  const notes = state.nodes.filter((n) => n.parentId);
  return notes.length > 0 && notes.every((n) => state.minimizedNotes.has(n.id));
}

function noteVisibleSet() {
  const roots = state.nodes.filter((n) => !n.parentId);
  const rootSet = new Set(roots.map((n) => n.id));
  const set = new Set();
  // 主窗口展示所有树根，所以每棵树的直属批注默认都可见
  for (const root of roots) {
    for (const child of childrenOf(root.id)) {
      if (!rootSet.has(child.id)) set.add(child.id);
    }
  }
  // 已经点开过的批注链；不会因为聚焦父批注就把所有子批注都弹出来
  for (const id of state.openedNotes) {
    let cur = byId(id);
    while (cur && cur.parentId) {
      set.add(cur.id);
      cur = byId(cur.parentId);
    }
  }
  if (state.focusedNote && byId(state.focusedNote)) {
    let cur = byId(state.focusedNote);
    while (cur && cur.parentId) {
      set.add(cur.id);
      cur = byId(cur.parentId);
    }
  }
  return set;
}

function updateNotesButton() {
  const count = state.nodes.filter((n) => n.parentId).length;
  if (!els.toggleNotes) return;
  const allMin = allNotesMinimized();
  els.toggleNotes.disabled = count === 0;
  els.toggleNotes.textContent = allMin ? "显示批注" : "收起批注";
  els.toggleNotes.title = allMin
    ? `显示本会话的全部 ${count} 条批注`
    : `收起全部批注，只保留原句高亮和序号`;
  els.toggleNotes.classList.toggle("active", allMin);
}

function toggleNotes() {
  if (state.drafts.size) return toast("先发送或取消正在编辑的批注");
  const notes = state.nodes.filter((n) => n.parentId);
  if (allNotesMinimized()) {
    state.minimizedNotes.clear();
    state.openedNotes = new Set(notes.map((n) => n.id));
  } else {
    for (const n of notes) state.minimizedNotes.add(n.id);
    state.openedNotes.clear();
    state.focusedNote = null;
    state.maximizedNote = null;
  }
  saveNoteViewState();
  renderThread();
  renderNotes();
  updateNotesButton();
}

function noteViewKey() {
  return `pt_note_view_${state.session?.id || "default"}`;
}

function saveNoteViewState() {
  try {
    localStorage.setItem(
      noteViewKey(),
      JSON.stringify({
        focused: state.focusedNote,
        maximized: state.maximizedNote,
        minimized: [...state.minimizedNotes],
        opened: [...state.openedNotes],
      })
    );
  } catch {}
}

function restoreNoteViewState() {
  try {
    const raw = localStorage.getItem(noteViewKey());
    if (!raw) return;
    const v = JSON.parse(raw);
    if (!v) return;
    const noteIds = state.nodes.filter((n) => n.parentId).map((n) => n.id);
    let mins = Array.isArray(v.minimized)
      ? v.minimized
      : v.hidden
        ? noteIds
        : [];
    if (Array.isArray(v.revealed)) mins = mins.filter((id) => !v.revealed.includes(id));
    state.minimizedNotes = new Set(mins.filter((id) => byId(id)?.parentId));
    state.openedNotes = new Set(
      (Array.isArray(v.opened) ? v.opened : []).filter((id) => byId(id)?.parentId)
    );
    for (const id of [...state.openedNotes]) {
      if (state.minimizedNotes.has(id) || hasMinimizedAncestor(id)) state.openedNotes.delete(id);
    }
    const focused = v.focused ? byId(v.focused) : null;
    if (focused?.parentId) {
      state.focusedNote = focused.id;
      unminimizePath(focused.id);
      revealNoteChain(focused.id);
    }
    const max = v.maximized ? byId(v.maximized) : null;
    if (max?.parentId) {
      state.maximizedNote = max.id;
      state.focusedNote = max.id;
      unminimizePath(max.id);
      revealNoteChain(max.id);
    }
    if (state.focusedNote && !noteVisibleSet().has(state.focusedNote)) {
      state.focusedNote = null;
      state.maximizedNote = null;
    }
  } catch {}
}

function renderNotes() {
  // 保留 draft，重建真实批注
  $$(".note:not(.draft)", els.notes).forEach((el) => el.remove());
  const visible = noteVisibleSet();
  const ids = [...visible].filter((id) => !state.minimizedNotes.has(id) && !hasMinimizedAncestor(id));
  const sorted = ids.map(byId).filter(Boolean).sort((a, b) => noteNumber(a.id) - noteNumber(b.id));

  for (const node of sorted) {
    const el = buildNote(node);
    els.notes.appendChild(el);
    layoutNote(el, node);
  }
  applyNoteFocus();
  layoutDrafts();
  scheduleConnectors();
  updateNotesButton();
}

function buildNote(node) {
  const grade = node.grade || gradeFor(node);
  const focused = state.focusedNote === node.id;
  const maximized = state.maximizedNote === node.id;
  let aboveMax = false;
  if (state.maximizedNote && !maximized) {
    let p = node.parentId ? byId(node.parentId) : null;
    while (p) {
      if (p.id === state.maximizedNote) {
        aboveMax = true;
        break;
      }
      p = p.parentId ? byId(p.parentId) : null;
    }
  }
  const el = document.createElement("div");
  el.className =
    "note" +
    (focused ? " focused" : "") +
    (maximized ? " maximized" : "") +
    (aboveMax ? " above-max" : "");
  el.dataset.id = node.id;
  el.style.setProperty("--c", rootColor(rootOf(node).id));
  el.innerHTML = `
    <div class="note-head">
      <span class="note-num">${noteNumber(node.id)}</span>
      <span class="note-kicker">批注</span>
      <span class="note-title" title="${escapeHtml(node.question)}">${escapeHtml(truncate(node.question, 34))}</span>
      <span class="note-time">${fmtTime(node.createdAt)}</span>
      <span class="note-actions">
        <button class="note-btn" data-act="maximize" title="${maximized ? "还原为中状态" : "最大化"}">${maximized ? "⤡" : "⛶"}</button>
        <button class="note-btn" data-act="close" title="最小化，只保留高亮和序号">✕</button>
      </span>
    </div>
    <div class="note-quote">“${escapeHtml(node.anchor?.quote || "（无锚点）")}”</div>
    <div class="note-body">
      ${noteBodyHtml(node)}
    </div>
    <div class="note-foot">
      <span class="grade-badge ${grade}">${GRADE_LABEL[grade] || "未验证"}</span>
      ${(node.sources || []).length ? `<span>${node.sources.length} 源</span>` : ""}
      ${(node.claims || []).length ? `<span>${node.claims.length} claim</span>` : ""}
      <span class="spacer"></span>
      <button class="link-btn" data-act="promote">定位到树根 ↗</button>
    </div>
    <div class="note-resize" title="拖动调整大小"></div>`;

  const answerEl = el.querySelector(".answer");
  if (answerEl) {
    answerEl.innerHTML = renderAnswerHtml(node);
    decorateAnchors(node, answerEl);
  }

  el.addEventListener("click", (e) => {
    if (e.target.closest("button,input,textarea,a,.note-resize,.note-body,.note-quote")) return;
    if (e.target.closest(".anchor")) return;
    if (!window.getSelection()?.isCollapsed) return;
    if (state.focusedNote === node.id || state.maximizedNote === node.id) return;
    focusNote(node.id);
  });
  el.querySelector('[data-act="maximize"]').addEventListener("click", (e) => {
    e.stopPropagation();
    maximizeNote(node.id);
  });
  el.querySelector('[data-act="close"]').addEventListener("click", (e) => {
    e.stopPropagation();
    minimizeSubtree(node.id);
    renderNotes();
    updateNotesButton();
  });
  el.querySelector('[data-act="promote"]').addEventListener("click", (e) => {
    e.stopPropagation();
    selectNode(node.id);
  });
  el.querySelector(".note-head").addEventListener("pointerdown", (e) => startNoteDrag(e, node));
  el.querySelector(".note-resize").addEventListener("pointerdown", (e) => startNoteResize(e, node));
  return el;
}

function noteBodyHtml(node) {
  if (node.status === "researching") {
    return `<div class="note-status"><div class="spinner"></div><div style="flex:1"><div>正在检索…</div><div class="note-status-lines">${(node.trace || []).slice(-4).map((t) => `<div>· ${escapeHtml(t.message)}</div>`).join("")}</div></div></div>`;
  }
  if (node.status === "error") {
    return `<div class="error-box" style="font-size:10.5px">${escapeHtml(node.answer || "检索失败")}</div>`;
  }
  return `<div class="note-question" style="font-size:10.5px;font-weight:650;margin-bottom:5px;color:#5a4c33">${escapeHtml(node.question)}</div><div class="answer" data-node-id="${node.id}"></div>`;
}

function applyNoteFocus() {
  const maxId = state.maximizedNote;
  els.noteBackdrop.hidden = !maxId;
  els.chatMain.classList.toggle("has-max", Boolean(maxId));
  els.annotationLayer.classList.toggle("maximized", Boolean(maxId));
  $$(".note:not(.draft)", els.notes).forEach((el) => {
    const isMax = el.dataset.id === maxId;
    const focused = el.dataset.id === state.focusedNote;
    el.classList.toggle("maximized", isMax);
    el.classList.toggle("focused", focused);
    el.classList.remove("dim");
  });
}

function focusNoteInPlace(node, el) {
  if (state.focusedNote === node.id) {
    el.classList.add("focused");
    return;
  }
  state.focusedNote = node.id;
  revealNoteChain(node.id);
  $$(".note:not(.draft)", els.notes).forEach((n) => {
    n.classList.toggle("focused", n === el);
  });
  const root = rootOf(node);
  if (state.currentId !== root.id) {
    state.currentId = root.id;
    localStorage.setItem("pt_current", root.id);
    renderSidebar();
  }
  saveNoteViewState();
}

function focusNote(id) {
  const node = byId(id);
  if (!node) return;
  const root = rootOf(node);
  if (state.currentId !== root.id) {
    state.currentId = root.id;
    localStorage.setItem("pt_current", root.id);
    renderSidebar();
  }
  // 从最小态点开：这一张和它的父批注链恢复为可见；已有最大窗口不改变
  unminimizePath(id);
  revealNoteChain(id);
  state.focusedNote = id;
  saveNoteViewState();
  renderNotes();
  updateNotesButton();
}

function maximizeNote(id) {
  const node = byId(id);
  if (!node) return;
  const root = rootOf(node);
  if (state.currentId !== root.id) {
    state.currentId = root.id;
    localStorage.setItem("pt_current", root.id);
    renderSidebar();
  }
  unminimizePath(id);
  revealNoteChain(id);
  if (state.maximizedNote === id) {
    state.maximizedNote = null;
    state.focusedNote = id;
  } else {
    state.maximizedNote = id;
    state.focusedNote = id;
  }
  saveNoteViewState();
  renderNotes();
  updateNotesButton();
}

function blurNotes() {
  if (!state.focusedNote && !state.maximizedNote) return;
  state.focusedNote = null;
  state.maximizedNote = null;
  saveNoteViewState();
  renderNotes();
}

function anchorElement(noteId) {
  return els.notes.querySelector(`.anchor[data-note-id="${noteId}"]`) || els.thread.querySelector(`.anchor[data-note-id="${noteId}"]`);
}

function layoutNote(el, node) {
  const main = els.chatMain.getBoundingClientRect();
  const note = node.note || {};
  const num = noteNumber(node.id);
  const anchor = anchorElement(node.id);
  const aRect = anchor ? anchor.getBoundingClientRect() : null;
  const ax = aRect ? aRect.right - main.left : main.width - 390;
  const ay = aRect ? aRect.top + aRect.height / 2 - main.top : 120 + Number(num) * 18;
  const ox = Number.isFinite(note.ox) ? note.ox : 24 + (Number(num) % 3) * 14;
  const oy = Number.isFinite(note.oy) ? note.oy : -18 + (Number(num) % 4) * 38;

  let w;
  let h;
  let left;
  let top;
  if (state.maximizedNote === node.id) {
    w = Math.max(240, Math.min(1200, main.width - 48));
    h = Math.max(240, main.height - 80);
    left = (main.width - w) / 2;
    top = 24;
  } else {
    // 中状态每次都回到默认尺寸；手动缩放只在当前中状态内有效
    w = Math.min(NOTE_W, Math.max(220, main.width - 20));
    h = Math.min(NOTE_H, Math.max(120, main.height - 80));
    const parentNode = node.parentId ? byId(node.parentId) : null;
    const parentCard = parentNode
      ? els.notes.querySelector(`.note[data-id="${parentNode.id}"]`)
      : null;
    if (parentCard && !note.moved) {
      const p = parentCard.getBoundingClientRect();
      const others = $$(".note", els.notes)
        .filter((other) => other !== el)
        .map((other) => other.getBoundingClientRect());
      const fits = (l) => Math.max(10, Math.min(l, main.width - w - 10));
      const cands = [
        { left: fits(p.right - main.left + 24), top: p.top - main.top + 28 },
        { left: fits(p.left - main.left - w - 24), top: p.top - main.top + 28 },
        { left: fits(p.left - main.left), top: p.bottom - main.top + 24 },
        { left: fits(p.left - main.left), top: p.top - main.top - h - 24 },
      ];
      const area = (a, b) =>
        Math.max(0, Math.min(a.left + w, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.top + h, b.bottom) - Math.max(a.top, b.top));
      let chosen = cands[0];
      let bestOverlap = Infinity;
      for (const c of cands) {
        const box = {
          left: c.left + main.left,
          top: c.top + main.top,
          right: c.left + main.left + w,
          bottom: c.top + main.top + h,
        };
        const overlap = others.reduce((sum, r) => sum + area(box, r), 0);
        if (overlap < bestOverlap) {
          bestOverlap = overlap;
          chosen = c;
        }
        if (overlap === 0) break;
      }
      left = chosen.left;
      top = chosen.top;
    } else {
      left = ax + ox;
      top = ay + oy;
    }
  }

  left = Math.max(10, Math.min(left, main.width - w - 10));
  // 不把 top 夹到顶栏/输入框：批注必须和锚点一起随内容滚动

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.zIndex = String(10 + Number(num));
}

function scheduleConnectors() {
  if (scheduleConnectors._raf) return;
  scheduleConnectors._raf = requestAnimationFrame(() => {
    scheduleConnectors._raf = null;
    drawConnectors();
  });
}

function noteRects(main) {
  const rel = (r) => ({
    left: r.left - main.left,
    right: r.right - main.left,
    top: r.top - main.top,
    bottom: r.bottom - main.top,
    width: r.width,
    height: r.height,
  });
  const out = new Map();
  for (const el of $$(".note", els.notes)) out.set(el, rel(el.getBoundingClientRect()));
  return out;
}

function connectorSidePoint(r, side) {
  if (side === "left") return { x: r.left, y: r.top + r.height / 2 };
  if (side === "right") return { x: r.right, y: r.top + r.height / 2 };
  if (side === "top") return { x: r.left + r.width / 2, y: r.top };
  return { x: r.left + r.width / 2, y: r.bottom };
}

function connectorPath(start, end, side) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = side === "left" || side === "right";
  const c1 = horizontal
    ? { x: start.x + dx * 0.5, y: start.y }
    : { x: start.x, y: start.y + dy * 0.5 };
  const c2 = horizontal
    ? { x: end.x - dx * 0.5, y: end.y }
    : { x: end.x, y: end.y - dy * 0.5 };
  return {
    c1,
    c2,
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
  };
}

function connectorHits(start, end, path, blockers, target) {
  let hits = 0;
  for (let i = 1; i <= 12; i++) {
    const t = i / 14;
    const mt = 1 - t;
    const x =
      mt * mt * mt * start.x +
      3 * mt * mt * t * path.c1.x +
      3 * mt * t * t * path.c2.x +
      t * t * t * end.x;
    const y =
      mt * mt * mt * start.y +
      3 * mt * mt * t * path.c1.y +
      3 * mt * t * t * path.c2.y +
      t * t * t * end.y;
    for (const r of blockers) {
      if (x > r.left - 3 && x < r.right + 3 && y > r.top - 3 && y < r.bottom + 3) {
        hits++;
        break;
      }
    }
    if (
      target &&
      t < 0.9 &&
      x > target.left + 6 &&
      x < target.right - 6 &&
      y > target.top + 6 &&
      y < target.bottom - 6
    ) {
      hits++;
    }
  }
  return hits;
}

function pointInRect(x, y, r, pad = 2) {
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}

function connectorSideCovered(r, side, blockers) {
  if (!blockers.length) return false;
  const points = [];
  for (const t of [0.25, 0.5, 0.75]) {
    if (side === "left") points.push([r.left, r.top + r.height * t]);
    else if (side === "right") points.push([r.right, r.top + r.height * t]);
    else if (side === "top") points.push([r.left + r.width * t, r.top]);
    else points.push([r.left + r.width * t, r.bottom]);
  }
  return points.some(([x, y]) => blockers.some((b) => pointInRect(x, y, b, 2)));
}

function connectorColor(el) {
  return el.style.getPropertyValue("--c") || "#b7791f";
}

function addConnectorPath(layer, d, color, id) {
  const NS = "http://www.w3.org/2000/svg";
  const path = document.createElementNS(NS, "path");
  path.dataset.connectorId = id;
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color);
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-dasharray", "3 4");
  path.setAttribute("opacity", ".72");
  layer.appendChild(path);
}

function addConnectorDot(layer, x, y, color, id) {
  const NS = "http://www.w3.org/2000/svg";
  const dot = document.createElementNS(NS, "circle");
  dot.dataset.connectorId = id;
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", "2.6");
  dot.setAttribute("fill", color);
  dot.setAttribute("opacity", ".9");
  layer.appendChild(dot);
}

function clearConnector(id) {
  for (const svg of [els.connectors, els.connectorsTop]) {
    svg.querySelectorAll(`[data-connector-id="${id}"]`).forEach((n) => n.remove());
  }
}

function buildConnector(el, rects) {
  const id = el.dataset.id || el.dataset.draft;
  const anchor = el.dataset.draft
    ? els.notes.querySelector(`.anchor[data-draft="${id}"]`) || els.thread.querySelector(`.anchor[data-draft="${id}"]`)
    : anchorElement(id);
  const n = rects.get(el);
  if (!anchor || !n) return;
  const a = anchor.getBoundingClientRect();
  if (!a.width) return;
  const main = els.chatMain.getBoundingClientRect();
  const rel = (r) => ({
    left: r.left - main.left,
    right: r.right - main.left,
    top: r.top - main.top,
    bottom: r.bottom - main.top,
    width: r.width,
    height: r.height,
  });
  const aRel = rel(a);
  const rawLineRects = [];
  const textWalker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  while (textWalker.nextNode()) {
    const textNode = textWalker.currentNode;
    if (!textNode.nodeValue?.trim()) continue;
    if (textNode.parentElement?.closest(".anchor-num")) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    rawLineRects.push(...range.getClientRects());
  }
  const lineRects = rawLineRects
    .filter((r) => r.width > 1 && r.height > 1)
    .map(rel);
  const anchorRects = lineRects.length ? lineRects : [aRel];
  let aLine = anchorRects[0];
  const union = anchorRects.reduce(
    (u, r) => ({
      top: Math.min(u.top, r.top),
      bottom: Math.max(u.bottom, r.bottom),
    }),
    { top: Infinity, bottom: -Infinity }
  );
  const noteCY = n.top + n.height / 2;
  if (noteCY >= union.bottom) {
    aLine = anchorRects.reduce((best, r) => (r.bottom > best.bottom ? r : best), anchorRects[0]);
  } else if (noteCY <= union.top) {
    aLine = anchorRects.reduce((best, r) => (r.top < best.top ? r : best), anchorRects[0]);
  } else {
    let aLineDist = Infinity;
    for (const r of anchorRects) {
      const dx = r.left + r.width / 2 - (n.left + n.width / 2);
      const dy = r.top + r.height / 2 - noteCY;
      const d = dx * dx + dy * dy;
      if (d < aLineDist) {
        aLineDist = d;
        aLine = r;
      }
    }
  }
  const color = connectorColor(el);
  const sides = ["left", "right", "top", "bottom"];
  const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" };
  const parentCard = anchor.closest(".note");
  const parentRect = parentCard && parentCard !== el ? rects.get(parentCard) : null;

  const pickSide = (from, to, order = sides) => {
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const facing = Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0 ? "left" : "right"
      : dy >= 0 ? "top" : "bottom";
    return [facing, ...order.filter((s) => s !== facing)];
  };

  if (parentRect) {
    // 父批注里的子批注：一条连续曲线，直接从高亮文字指向子窗口
    const blockers = [...rects.entries()]
      .filter(([other]) => other !== el && other !== parentCard)
      .map(([, r]) => r);
    const portBlockers = parentRect ? [...blockers, parentRect] : blockers;
    const order = pickSide(aLine, n);
    let best = null;
    for (const side of order) {
      const start = connectorSidePoint(aLine, opposite[side]);
      const end = connectorSidePoint(n, side);
      const path = connectorPath(start, end, side);
      const covered = connectorSideCovered(n, side, portBlockers);
      const hits = connectorHits(start, end, path, blockers, n) + (covered ? 8 : 0);
      if (!best || hits < best.hits) best = { start, end, path, hits };
      if (hits === 0) break;
    }
    if (!best) return;
    addConnectorPath(els.connectorsTop, best.path.d, color, id);
    addConnectorDot(els.connectorsTop, best.start.x, best.start.y, color, id);
    return;
  }

  // 正文批注：四边中点选一条不被其它窗口遮挡的路径
  const blockers = [...rects.entries()]
    .filter(([other]) => other !== el)
    .map(([, r]) => r);
  const order = pickSide(aLine, n);
  let best = null;
  for (const side of order) {
    const start = connectorSidePoint(aLine, opposite[side]);
    const end = connectorSidePoint(n, side);
    const path = connectorPath(start, end, side);
    const covered = connectorSideCovered(n, side, blockers);
    const hits = connectorHits(start, end, path, blockers, n) + (covered ? 8 : 0);
    if (!best || hits < best.hits) best = { start, end, path, hits };
    if (hits === 0) break;
  }
  if (!best) return;
  addConnectorPath(els.connectors, best.path.d, color, id);
  addConnectorDot(els.connectors, best.start.x, best.start.y, color, id);
}

function drawConnectors() {
  const main = els.chatMain.getBoundingClientRect();
  for (const svg of [els.connectors, els.connectorsTop]) {
    svg.setAttribute("width", String(main.width));
    svg.setAttribute("height", String(main.height));
    svg.innerHTML = "";
  }
  const rects = noteRects(main);
  for (const el of $$(".note", els.notes)) buildConnector(el, rects);
}

function updateConnectorFor(id) {
  const main = els.chatMain.getBoundingClientRect();
  for (const svg of [els.connectors, els.connectorsTop]) {
    svg.setAttribute("width", String(main.width));
    svg.setAttribute("height", String(main.height));
  }
  clearConnector(id);
  const el = $$(".note", els.notes).find((n) => (n.dataset.id || n.dataset.draft) === id);
  if (!el) return;
  buildConnector(el, noteRects(main));
}

function updateConnectorsForTree(id) {
  // 移动/缩放一张卡片时：只更新相关连线，不移动其它窗口
  updateConnectorFor(id);
  for (const child of childrenOf(id)) updateConnectorsForTree(child.id);
}

/* note drag/resize */
function startNoteDrag(e, node) {
  if (e.button !== 0) return;
  if (state.maximizedNote === node.id) return;
  if (e.target.closest("button,input,textarea,a,.note-resize")) return;
  e.preventDefault();
  const el = e.currentTarget.closest(".note");
  if (!el) return;
  // 按住左键先聚焦，再开始移动
  focusNoteInPlace(node, el);
  el.classList.add("dragging");
  const main = els.chatMain.getBoundingClientRect();
  const anchor = anchorElement(node.id);
  const aRect = anchor ? anchor.getBoundingClientRect() : null;
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = el.offsetLeft;
  const startTop = el.offsetTop;
  const ax = aRect ? aRect.right - main.left : main.width - 390;
  const ay = aRect ? aRect.top + aRect.height / 2 - main.top : 120;
  const pointerId = e.pointerId;
  try {
    e.currentTarget.setPointerCapture(pointerId);
  } catch {}

  const move = (ev) => {
    const left = Math.max(8, Math.min(startLeft + ev.clientX - startX, main.width - el.offsetWidth - 8));
    const top = Math.max(58, Math.min(startTop + ev.clientY - startY, main.height - el.offsetHeight - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    node.note = { ...(node.note || {}), ox: left - ax, oy: top - ay, moved: true };
    updateConnectorsForTree(node.id);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    try {
      e.currentTarget.releasePointerCapture?.(pointerId);
    } catch {}
    el.classList.remove("dragging");
    saveNote(node);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function startNoteResize(e, node) {
  if (e.button !== 0) return;
  if (state.maximizedNote === node.id) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget.closest(".note");
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = el.offsetWidth;
  const startH = el.offsetHeight;
  const pointerId = e.pointerId;
  try {
    e.currentTarget.setPointerCapture(pointerId);
  } catch {}
  const move = (ev) => {
    const w = Math.max(240, Math.min(720, startW + ev.clientX - startX));
    const h = Math.max(120, Math.min(720, startH + ev.clientY - startY));
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    updateConnectorsForTree(node.id);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    try {
      e.currentTarget.releasePointerCapture?.(pointerId);
    } catch {}
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function saveNote(node) {
  clearTimeout(state.noteSaveTimer);
  state.noteSaveTimer = setTimeout(() => {
    api(`/api/nodes/${node.id}`, {
      method: "PATCH",
      body: JSON.stringify({ note: node.note || {} }),
    }).catch(() => {});
  }, 400);
}

/* ------------------------------------------------------------------ */
/* drafts                                                             */
/* ------------------------------------------------------------------ */
function createDraft(parentNode, quote, rect) {
  if (state.activeAsk) {
    toast("等当前检索完成再新建批注");
    return;
  }
  const id = `draft_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const main = els.chatMain.getBoundingClientRect();
  const draft = {
    id,
    parentId: parentNode.id,
    quote,
    x: Math.max(10, Math.min(rect.right - main.left + 18, main.width - 350)),
    y: Math.max(64, Math.min(rect.top - main.top - 10, main.height - 280)),
  };
  state.drafts.set(id, draft);
  const el = document.createElement("div");
  el.className = "note draft focused";
  el.dataset.draft = id;
  el.style.left = `${draft.x}px`;
  el.style.top = `${draft.y}px`;
  el.style.width = "330px";
  el.style.height = "250px";
  el.style.zIndex = "110";
  el.style.setProperty("--c", "#b7791f");
  el.innerHTML = `
    <div class="note-head">
      <span class="note-num">＋</span>
      <span class="note-kicker">新建批注</span>
      <span class="note-title">就这句话提问</span>
      <span class="spacer" style="flex:1"></span>
      <button class="note-btn" data-act="cancel" title="取消">✕</button>
    </div>
    <div class="note-quote">“${escapeHtml(truncate(quote, 120))}”</div>
    <div class="note-body">
      <textarea class="note-draft-input" placeholder="写下你的问题…（Ctrl+Enter 发送）"></textarea>
      <div class="note-draft-actions">
        <span class="hint">批注会挂在这句话下面</span>
        <span class="spacer"></span>
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn primary" data-act="send">提问</button>
      </div>
    </div>`;
  els.notes.appendChild(el);
  applyNoteFocus();
  updateNotesButton();

  const ta = el.querySelector("textarea");
  setTimeout(() => ta.focus(), 30);
  el.querySelectorAll('[data-act="cancel"]').forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelDraft(id);
    })
  );
  el.querySelector('[data-act="send"]').addEventListener("click", (e) => {
    e.stopPropagation();
    sendDraft(id);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendDraft(id);
    }
  });
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button,textarea")) return;
    startDraftDrag(e, draft, el);
  });
  scheduleConnectors();
}

function startDraftDrag(e, draft, el) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = el.offsetLeft;
  const startTop = el.offsetTop;
  const pointerId = e.pointerId;
  el.setPointerCapture(pointerId);
  const move = (ev) => {
    draft.x = Math.max(8, startLeft + ev.clientX - startX);
    draft.y = Math.max(58, startTop + ev.clientY - startY);
    el.style.left = `${draft.x}px`;
    el.style.top = `${draft.y}px`;
    updateConnectorFor(draft.id);
  };
  const up = () => {
    el.releasePointerCapture?.(pointerId);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

function draftAnchor(id) {
  return (
    els.notes.querySelector(`.anchor[data-draft="${id}"]`) ||
    els.thread.querySelector(`.anchor[data-draft="${id}"]`)
  );
}

function cancelDraft(id) {
  const draft = state.drafts.get(id);
  const el = els.notes.querySelector(`[data-draft="${id}"]`);
  const anchor = draftAnchor(id);
  if (anchor) anchor.replaceWith(...anchor.childNodes);
  el?.remove();
  state.drafts.delete(id);
  applyNoteFocus();
  scheduleConnectors();
}

async function sendDraft(id) {
  const draft = state.drafts.get(id);
  if (!draft) return;
  if (state.activeAsk) return toast("等当前检索完成再发送");
  const el = els.notes.querySelector(`[data-draft="${id}"]`);
  const ta = el?.querySelector("textarea");
  const question = ta?.value.trim();
  if (!question) {
    ta?.focus();
    return;
  }
  // 清掉草稿与临时高亮；真实 anchor 会在节点返回后重新渲染
  const anchor = draftAnchor(id);
  if (anchor) anchor.replaceWith(...anchor.childNodes);
  el?.remove();
  state.drafts.delete(id);
  applyNoteFocus();
  await ask({
    parentId: draft.parentId,
    question,
    anchor: { quote: draft.quote },
    asNote: true,
    noteSeed: { ox: 24, oy: -18, w: 340, h: 236 },
  });
}

function layoutDrafts() {
  for (const draft of state.drafts.values()) {
    const el = els.notes.querySelector(`[data-draft="${draft.id}"]`);
    if (!el) continue;
    el.style.left = `${draft.x}px`;
    el.style.top = `${draft.y}px`;
  }
}

/* ------------------------------------------------------------------ */
/* ask / SSE                                                          */
/* ------------------------------------------------------------------ */
function updateComposer() {
  const busy = Boolean(state.activeAsk);
  els.sendBtn.disabled = busy ? false : !els.input.value.trim();
  els.sendBtn.textContent = busy ? "■" : "↑";
  els.sendBtn.classList.toggle("stop", busy);
  els.sendBtn.title = busy ? "停止" : "发送";
  const rootCount = state.nodes.filter((n) => !n.parentId).length;
  els.threadHint.textContent = rootCount ? `${rootCount} 棵树根 · 连续浏览` : "新会话";
}

async function sendMain() {
  if (state.activeAsk) {
    state.activeAsk.controller.abort();
    return;
  }
  const question = els.input.value.trim();
  if (!question) return;
  els.input.value = "";
  els.input.style.height = "auto";
  await ask({ parentId: null, question, asNote: false });
}

async function ask({ parentId, question, anchor = null, asNote = false, noteSeed = null }) {
  if (state.activeAsk) {
    toast("已有检索任务在运行");
    return;
  }
  const tempId = `tmp_${Date.now()}`;
  const parentNode = parentId ? byId(parentId) : null;
  // 从已聚焦/最大化的批注里继续提问：父批注保持原有状态
  const keepParentView = Boolean(
    asNote &&
      parentNode?.parentId &&
      (state.focusedNote === parentNode.id || state.maximizedNote === parentNode.id)
  );
  const temp = {
    id: tempId,
    parentId,
    question,
    answer: "",
    status: "researching",
    createdAt: new Date().toISOString(),
    completedAt: null,
    anchor,
    mode: els.askMode.value,
    sources: [],
    claims: [],
    trace: [],
    usage: null,
    collapsed: false,
    understood: false,
    isDemo: state.config?.demo,
    note: asNote ? noteSeed || { ox: 24, oy: -18, w: 340, h: 236 } : null,
  };
  state.nodes.push(temp);
  buildNoteNumbers();
  if (asNote) revealNoteChain(tempId);
  if (!asNote) {
    state.currentId = tempId;
    state.focusedNote = null;
  } else if (!keepParentView) {
    state.focusedNote = tempId;
  }
  renderSidebar();
  renderThread();
  renderNotes();
  updateComposer();
  if (!asNote) requestAnimationFrame(() => scrollToNode(tempId, false));

  const controller = new AbortController();
  state.activeAsk = { controller, tempId, nodeId: tempId };
  updateComposer();

  let activeId = tempId;
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId, question, anchor, mode: els.askMode.value }),
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
        const idx = state.nodes.findIndex((n) => n.id === tempId);
        const old = idx >= 0 ? state.nodes[idx] : temp;
        const merged = {
          ...real,
          note: old.note || real.note || null,
          trace: old.trace || [],
          sources: old.sources || [],
          claims: old.claims || [],
        };
        if (idx >= 0) state.nodes.splice(idx, 1, merged);
        else state.nodes.push(merged);
        if (state.currentId === tempId) state.currentId = real.id;
        if (state.focusedNote === tempId) state.focusedNote = real.id;
        if (state.openedNotes.delete(tempId)) state.openedNotes.add(real.id);
        state.minimizedNotes.delete(real.id);
        saveNoteViewState();
        activeId = real.id;
        state.activeAsk.nodeId = real.id;
        buildNoteNumbers();
        renderSidebar();
        renderThread();
        renderNotes();
      },
      trace: (t) => {
        const n = byId(activeId);
        if (!n) return;
        n.trace.push(t);
        if (state.currentId === activeId) renderThread();
        if (state.focusedNote === activeId || noteVisibleSet().has(activeId)) renderNotes();
      },
      sources: (sources) => {
        const n = byId(activeId);
        if (!n) return;
        n.sources = sources;
        if (state.currentId === activeId) renderThread();
        renderNotes();
        renderSidebar();
      },
      answer: ({ answer, claims, grade }) => {
        const n = byId(activeId);
        if (!n) return;
        n.answer = answer;
        n.claims = claims || [];
        n.grade = grade || gradeFor(n);
        n.status = "done";
        n.completedAt = new Date().toISOString();
        if (state.currentId === activeId) renderThread();
        renderNotes();
        renderSidebar();
        if (!asNote) requestAnimationFrame(() => scrollToNode(activeId, false));
      },
      error: ({ message }) => {
        const n = byId(activeId);
        if (!n) return;
        n.status = "error";
        n.answer = message || "检索失败";
        if (state.currentId === activeId) renderThread();
        renderNotes();
        renderSidebar();
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
        if (state.currentId === activeId) renderThread();
        renderNotes();
        renderSidebar();
      },
    });
  } catch (err) {
    const n = byId(activeId);
    if (n) {
      n.status = "error";
      n.answer = err.name === "AbortError" ? "已停止本次检索。" : `检索/回答失败：${err.message || err}`;
      if (state.currentId === activeId) renderThread();
      renderNotes();
      renderSidebar();
    }
  } finally {
    state.activeAsk = null;
    updateComposer();
  }
}

async function streamSse(res, handlers) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("浏览器不支持流式响应");
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
/* selection toolbar                                                  */
/* ------------------------------------------------------------------ */
let selToolbar = null;
function hideSelToolbar() {
  selToolbar?.remove();
  selToolbar = null;
}

function showSelToolbar(rect, text, node) {
  hideSelToolbar();
  const bar = document.createElement("div");
  bar.className = "sel-toolbar";
  bar.innerHTML = `<button data-a="note">＋ 新建批注</button><span class="st-sep"></span><button data-a="copy">复制</button>`;
  document.body.appendChild(bar);
  const w = bar.offsetWidth;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 12);
  let top = rect.top - 42;
  if (top < 64) top = rect.bottom + 8;
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
  bar.querySelector('[data-a="note"]').addEventListener("click", () => {
    createDraft(node, text, rect);
    hideSelToolbar();
    window.getSelection()?.removeAllRanges();
  });
  bar.querySelector('[data-a="copy"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      toast("复制失败");
    }
    hideSelToolbar();
  });
  selToolbar = bar;
}

/* ------------------------------------------------------------------ */
/* source drawer / settings                                           */
/* ------------------------------------------------------------------ */
function openSource(nodeId, sourceId) {
  const node = byId(nodeId);
  if (!node) return;
  const s = (node.sources || []).find((x) => x.id === sourceId);
  if (!s) return toast("找不到来源");
  const claims = (node.claims || []).filter((c) => (c.sourceIds || []).includes(sourceId));
  $("#drawerTitle").textContent = s.title || "Untitled";
  $("#drawerBody").innerHTML = `
    <div class="drawer-section"><div class="claim-meta" style="margin-top:0">
      <span class="tier-badge tier-${s.tier}">${s.tier}</span>
      ${s.peerReviewed ? '<span class="source-tag peer">同行评审</span>' : ""}
      ${s.type === "preprint" ? '<span class="source-tag">预印本</span>' : ""}
      ${s.retracted ? '<span class="source-tag warn">已撤稿</span>' : ""}
    </div></div>
    <div class="drawer-section"><h4>作者 / 出处</h4><p>${escapeHtml((s.authors || []).join(", ") || "未知作者")}</p><p>${escapeHtml([s.year, s.venue].filter(Boolean).join(" · "))}</p></div>
    <div class="drawer-section"><h4>摘要 / 正文片段</h4><div class="drawer-quote">${escapeHtml(s.abstract || s.content || "无摘要")}</div></div>
    <div class="drawer-section"><h4>标识</h4><p class="mono">${escapeHtml([s.doi ? `DOI: ${s.doi}` : "", s.arxivId ? `arXiv: ${s.arxivId}` : "", s.url ? `URL: ${s.url}` : ""].filter(Boolean).join("\n") || "无")}</p></div>
    ${claims.length ? `<div class="drawer-section"><h4>用它支撑的 claim</h4>${claims.map((c) => `<div class="claim" style="margin-bottom:7px"><div class="claim-text">${escapeHtml(c.text)}</div>${c.quote ? `<div class="claim-quote">“${escapeHtml(c.quote)}”</div>` : ""}</div>`).join("")}</div>` : ""}
    <div class="drawer-actions">
      ${s.oaUrl ? `<a href="${safeUrl(s.oaUrl)}" target="_blank" rel="noreferrer">打开 OA 原文 ↗</a>` : ""}
      ${s.url ? `<a href="${safeUrl(s.url)}" target="_blank" rel="noreferrer">打开链接 ↗</a>` : ""}
    </div>`;
  els.drawerBackdrop.hidden = false;
  els.sourceDrawer.classList.add("open");
  els.sourceDrawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  els.sourceDrawer.classList.remove("open");
  els.sourceDrawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
}

function renderApiStatus() {
  const c = state.config || {};
  const box = $("#apiStatus");
  if (!box) return;
  if (state.desktop) {
    const has = Boolean(state.desktopInfo?.hasKey || c.mode === "live");
    box.className = has ? "api-status ok" : "api-status demo";
    box.innerHTML = has
      ? "DESKTOP · DeepSeek Key 已配置（本机加密保存）。"
      : "DESKTOP · 还没有配置 DeepSeek Key。填入下方 Key 并保存。";
    return;
  }
  box.className = c.mode === "live" ? "api-status ok" : "api-status demo";
  box.innerHTML = c.mode === "live" ? `LIVE · ${escapeHtml(c.model || "deepseek-flash")}` : "DEMO · 当前使用内置示例树。";
}

function openSettings() {
  const s = state.session || {};
  $("#sessionTitleInput").value = s.title || "";
  $("#paperTitleInput").value = s.paperTitle || "";
  $("#paperTextInput").value = s.paperText || "";
  $("#modeInput").value = s.mode === "web" ? "web" : "academic";
  renderApiStatus();
  const desktopField = $("#desktopKeyField");
  desktopField.hidden = !state.desktop;
  const keyHelp = $("#keyHelp");
  keyHelp.hidden = Boolean(state.desktop);
  if (!state.desktop) {
    keyHelp.innerHTML =
      state.config?.mode === "live"
        ? "Key 只在服务端读取；桌面版可在设置里直接填写。"
        : "配置方式：复制 <code>app/.env.example</code> 为 <code>app/.env</code>，填入 <code>DEEPSEEK_API_KEY</code>，重启服务。";
  }
  if (state.desktop) $("#desktopKeyInput").value = "";
  els.settingsModal.hidden = false;
}

function closeSettings() {
  els.settingsModal.hidden = true;
}

async function saveSettings() {
  try {
    const data = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        title: $("#sessionTitleInput").value.trim(),
        paperTitle: $("#paperTitleInput").value.trim(),
        paperText: $("#paperTextInput").value,
        mode: $("#modeInput").value,
      }),
    });
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
  if (!clear && !key) return toast("请输入 DeepSeek API Key");
  const btn = clear ? $("#clearDesktopKey") : $("#saveDesktopKey");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    await state.desktop.setApiKey(key);
    toast(clear ? "已清除 Key，正在切换演示模式…" : "Key 已保存，正在重启检索服务…");
    setTimeout(() => location.reload(), 700);
  } catch (err) {
    toast(`保存失败：${err.message || err}`);
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function resetAll() {
  if (!confirm("确定清空所有节点？论文设置会保留。")) return;
  await api("/api/reset", { method: "POST" });
  state.nodes = [];
  state.roots = [];
  state.currentId = null;
  state.focusedNote = null;
  state.maximizedNote = null;
  state.minimizedNotes.clear();
  state.openedNotes.clear();
  saveNoteViewState();
  localStorage.removeItem("pt_current");
  closeSettings();
  renderAll();
}

async function loadDemo() {
  const data = await api("/api/demo", { method: "POST" });
  state.nodes = data.nodes || [];
  state.roots = state.nodes.filter((n) => !n.parentId);
  state.currentId = state.roots[0]?.id || null;
  state.focusedNote = null;
  state.maximizedNote = null;
  state.minimizedNotes.clear();
  state.openedNotes.clear();
  saveNoteViewState();
  buildNoteNumbers();
  closeSettings();
  renderAll();
  if (state.currentId) requestAnimationFrame(() => scrollToNode(state.currentId, true));
}

/* ------------------------------------------------------------------ */
/* graph                                                              */
/* ------------------------------------------------------------------ */
function openGraph() {
  els.graphModal.hidden = false;
  requestAnimationFrame(() => {
    renderGraph();
    fitGraph();
  });
}

function closeGraph() {
  els.graphModal.hidden = true;
}

const G_W = 176;
const G_H = 54;
const G_GAP_X = 70;
const G_GAP_Y = 14;

function graphSubtreeHeight(node) {
  const kids = childrenOf(node.id);
  if (!kids.length) return G_H;
  return Math.max(G_H, kids.reduce((s, c) => s + graphSubtreeHeight(c), 0) + G_GAP_Y * (kids.length - 1));
}

function graphPlace(node, depth, top, height, out) {
  const x = 40 + depth * (G_W + G_GAP_X);
  const y = top + (height - G_H) / 2;
  out.set(node.id, { x, y });
  const kids = childrenOf(node.id);
  if (!kids.length) return;
  const hs = kids.map(graphSubtreeHeight);
  const total = hs.reduce((a, b) => a + b, 0) + G_GAP_Y * (kids.length - 1);
  let cy = top + (height - total) / 2;
  kids.forEach((c, i) => {
    graphPlace(c, depth + 1, cy, hs[i], out);
    cy += hs[i] + G_GAP_Y;
  });
}

function renderGraph() {
  state.roots = state.nodes.filter((n) => !n.parentId);
  const pos = new Map();
  let y = 30;
  for (const root of state.roots) {
    const h = graphSubtreeHeight(root);
    graphPlace(root, 0, y, h, pos);
    y += h + 50;
  }
  let maxX = 760;
  let maxY = 430;
  for (const [id, p] of pos) {
    const n = byId(id);
    n._gx = p.x;
    n._gy = p.y;
    maxX = Math.max(maxX, p.x + G_W + 60);
    maxY = Math.max(maxY, p.y + G_H + 60);
  }
  els.graphCanvas.style.width = `${maxX}px`;
  els.graphCanvas.style.height = `${maxY}px`;
  els.graphEdges.setAttribute("width", maxX);
  els.graphEdges.setAttribute("height", maxY);
  els.graphNodes.innerHTML = "";
  els.graphEdges.innerHTML = "";
  const NS = "http://www.w3.org/2000/svg";

  for (const n of state.nodes) {
    if (!pos.has(n.id)) continue;
    const p = pos.get(n.id);
    const el = document.createElement("div");
    el.className = "graph-node";
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.setProperty("--c", rootColor(rootOf(n).id));
    el.innerHTML = `<div class="strip"></div><div class="gmain"><div class="gtitle">${escapeHtml(truncate(n.question, 48))}</div><div class="gmeta"><span>${fmtTime(n.createdAt)}</span>${(n.sources || []).length ? `<span>· ${n.sources.length} 源</span>` : ""}</div></div>`;
    el.addEventListener("click", () => {
      closeGraph();
      selectNode(n.id);
    });
    els.graphNodes.appendChild(el);

    if (n.parentId) {
      const parent = byId(n.parentId);
      const pp = parent ? pos.get(parent.id) : null;
      if (!pp) continue;
      const x1 = pp.x + G_W;
      const y1 = pp.y + G_H / 2;
      const x2 = p.x;
      const y2 = p.y + G_H / 2;
      const dx = Math.max(30, (x2 - x1) * 0.5);
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#c6bdac");
      path.setAttribute("stroke-width", "1.3");
      if (n.anchor?.quote) path.setAttribute("stroke-dasharray", "6 5");
      els.graphEdges.appendChild(path);
    }
  }
  applyGraphView();
}

function applyGraphView() {
  els.graphCanvas.style.transform = `translate(${state.graphView.x}px, ${state.graphView.y}px) scale(${state.graphView.k})`;
}

function fitGraph() {
  const vp = els.graphViewport.getBoundingClientRect();
  const w = parseFloat(els.graphCanvas.style.width) || 900;
  const h = parseFloat(els.graphCanvas.style.height) || 620;
  const k = Math.min((vp.width - 60) / w, (vp.height - 50) / h, 1.25);
  state.graphView = {
    x: (vp.width - w * k) / 2,
    y: (vp.height - h * k) / 2,
    k: Math.max(0.3, k),
  };
  applyGraphView();
}

function bindGraphEvents() {
  let drag = null;
  els.graphViewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".graph-node") || e.target.closest("button")) return;
    drag = { x: e.clientX, y: e.clientY, ox: state.graphView.x, oy: state.graphView.y };
    els.graphViewport.classList.add("dragging");
    els.graphViewport.setPointerCapture(e.pointerId);
  });
  els.graphViewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    state.graphView.x = drag.ox + e.clientX - drag.x;
    state.graphView.y = drag.oy + e.clientY - drag.y;
    applyGraphView();
  });
  const end = () => {
    drag = null;
    els.graphViewport.classList.remove("dragging");
  };
  els.graphViewport.addEventListener("pointerup", end);
  els.graphViewport.addEventListener("pointercancel", end);
  els.graphViewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = els.graphViewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.min(1.7, Math.max(0.3, state.graphView.k * Math.exp(-e.deltaY * 0.0012)));
    state.graphView.x = mx - (mx - state.graphView.x) * (next / state.graphView.k);
    state.graphView.y = my - (my - state.graphView.y) * (next / state.graphView.k);
    state.graphView.k = next;
    applyGraphView();
  }, { passive: false });
}

/* ------------------------------------------------------------------ */
/* bindings                                                           */
/* ------------------------------------------------------------------ */
function bindThreadEvents() {
  $$("[data-sources]", els.thread).forEach((b) => {
    b.addEventListener("click", () => {
      const n = byId(b.dataset.sources);
      if (n?.sources?.[0]) openSource(n.id, n.sources[0].id);
    });
  });
  $$("[data-claims]", els.thread).forEach((b) => {
    b.addEventListener("click", () => {
      const n = byId(b.dataset.claims);
      if (n) toast(`${n.claims.length} 条 claim：${n.claims.map((c) => VERDICT_LABEL[c.verdict] || c.verdict).join(" / ")}`);
    });
  });
  $$("[data-notes]", els.thread).forEach((b) => {
    b.addEventListener("click", () => {
      const n = byId(b.dataset.notes);
      const first = childrenOf(n.id)[0];
      if (!first) return;
      if (state.currentId && pathOf(byId(state.currentId)).some((x) => x.id === first.id)) {
        selectNode(first.id);
      } else {
        focusNote(first.id);
      }
    });
  });
  $$("[data-locate]", els.thread).forEach((b) => {
    b.addEventListener("click", () => locateInThread(b.dataset.locate));
  });
}

function flashNode(id) {
  const nodes = $$(`[data-node="${id}"]`, els.thread);
  nodes.forEach((msg) => {
    msg.classList.remove("flash");
    void msg.offsetWidth;
    msg.classList.add("flash");
  });
  setTimeout(() => nodes.forEach((msg) => msg.classList.remove("flash")), 1500);
}

function locateInThread(id) {
  const node = byId(id);
  if (!node) return;
  const path = state.currentId ? pathOf(byId(state.currentId)) : [];
  const onPath = path.some((n) => n.id === id);
  if (!onPath) {
    selectNode(id);
    setTimeout(() => flashNode(id), 280);
    return;
  }
  if (state.maximizedNote) state.maximizedNote = null;
  if (state.focusedNote) state.focusedNote = null;
  renderNotes();
  const msg = els.thread.querySelector(`[data-node="${id}"]`);
  msg?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => flashNode(id), 260);
}

function bindUI() {
  const toggleSidebar = (collapsed) => {
    state.sidebarCollapsed = typeof collapsed === "boolean" ? collapsed : !state.sidebarCollapsed;
    localStorage.setItem("pt_sidebar", state.sidebarCollapsed ? "1" : "0");
    applySidebar();
    requestAnimationFrame(() => {
      for (const el of $$(".note:not(.draft)", els.notes)) {
        const n = byId(el.dataset.id);
        if (n) layoutNote(el, n);
      }
      scheduleConnectors();
    });
  };
  $("#sidebarFold").addEventListener("click", () => toggleSidebar(true));
  $("#sidebarUnfold").addEventListener("click", () => toggleSidebar(false));
  els.toggleNotes.addEventListener("click", toggleNotes);
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#settingsBtn2").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#cancelSettings").addEventListener("click", closeSettings);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#resetBtn").addEventListener("click", resetAll);
  $("#demoBtn").addEventListener("click", loadDemo);
  $("#settingsModal").addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });
  if (state.desktop) {
    $("#saveDesktopKey")?.addEventListener("click", () => saveDesktopKey(false));
    $("#clearDesktopKey")?.addEventListener("click", () => saveDesktopKey(true));
    $("#openDataDir")?.addEventListener("click", () => state.desktop.openDataDir().catch(() => {}));
  }

  $("#graphBtn").addEventListener("click", openGraph);
  $("#graphBtn2").addEventListener("click", openGraph);
  $("#graphClose").addEventListener("click", closeGraph);
  $("#graphFit").addEventListener("click", fitGraph);
  els.graphModal.addEventListener("click", (e) => {
    if (e.target === els.graphModal) closeGraph();
  });
  bindGraphEvents();

  $("#closeDrawer").addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);
  els.noteBackdrop.addEventListener("click", () => {
    if (state.maximizedNote) maximizeNote(state.maximizedNote);
  });

  $("#clearQuote").addEventListener("click", () => {
    els.quoteChip.hidden = true;
    els.quoteText.textContent = "";
    els.input.placeholder = "继续追问当前回答…（Enter 发送，Shift+Enter 换行）";
  });
  els.input.addEventListener("input", () => {
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(130, els.input.scrollHeight)}px`;
    updateComposer();
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendMain();
    }
  });
  els.sendBtn.addEventListener("click", sendMain);
  els.askMode.addEventListener("change", () => {
    api("/api/settings", { method: "POST", body: JSON.stringify({ mode: els.askMode.value }) }).catch(() => {});
  });

  els.thread.addEventListener("click", (e) => {
    if (e.target.closest(".note")) return;
    if (e.target.closest(".sel-toolbar")) return;
    const cite = e.target.closest(".cite");
    if (cite) {
      const answer = cite.closest("[data-node-id]");
      if (answer) openSource(answer.dataset.nodeId, cite.dataset.source);
      return;
    }
    const anchor = e.target.closest(".anchor[data-note-id]");
    if (anchor) {
      focusNote(anchor.dataset.noteId);
      return;
    }
    blurNotes();
  });

  els.notes.addEventListener("click", (e) => {
    const cite = e.target.closest(".cite");
    if (cite) {
      const answer = cite.closest("[data-node-id]");
      if (answer) openSource(answer.dataset.nodeId, cite.dataset.source);
      return;
    }
    const anchor = e.target.closest(".anchor[data-note-id]");
    if (anchor) {
      focusNote(anchor.dataset.noteId);
    }
  });

  document.addEventListener("mousedown", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (!t.closest(".sel-toolbar")) hideSelToolbar();
    if (!t.closest(".note") && !t.closest(".anchor") && !t.closest(".sel-toolbar")) blurNotes();
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
      const nodeId = answer.dataset.nodeId;
      const node = nodeId ? byId(nodeId) : null;
      if (!node) return;
      showSelToolbar(range.getBoundingClientRect(), text, node);
    }, 10);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.settingsModal.hidden) return closeSettings();
      if (!els.graphModal.hidden) return closeGraph();
      if (els.sourceDrawer.classList.contains("open")) return closeDrawer();
      if (selToolbar) return hideSelToolbar();
      if (state.maximizedNote) {
        maximizeNote(state.maximizedNote);
        return;
      }
      if (state.drafts.size) {
        const last = [...state.drafts.keys()].pop();
        cancelDraft(last);
        return;
      }
      if (state.focusedNote) return blurNotes();
      const current = state.currentId ? byId(state.currentId) : null;
      if (current?.parentId) selectNode(current.parentId);
    }
  });

  els.threadScroll.addEventListener("scroll", () => {
    hideSelToolbar();
    for (const el of $$(".note:not(.draft)", els.notes)) {
      const n = byId(el.dataset.id);
      if (n) layoutNote(el, n, false);
    }
    for (const draft of state.drafts.values()) {
      const el = els.notes.querySelector(`[data-draft="${draft.id}"]`);
      if (el) {
        el.style.left = `${draft.x}px`;
        el.style.top = `${draft.y}px`;
      }
    }
    scheduleConnectors();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (window.innerWidth < 900 && !state.sidebarCollapsed) {
      state.sidebarCollapsed = true;
      localStorage.setItem("pt_sidebar", "1");
      applySidebar();
    }
    for (const el of $$(".note:not(.draft)", els.notes)) {
      const n = byId(el.dataset.id);
      if (n) layoutNote(el, n);
    }
    scheduleConnectors();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      for (const el of $$(".note:not(.draft)", els.notes)) {
        const n = byId(el.dataset.id);
        if (n) layoutNote(el, n);
      }
      scheduleConnectors();
    }).observe(els.chatMain);
  }
}

/* ------------------------------------------------------------------ */
/* init                                                               */
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
  const storedSidebar = localStorage.getItem("pt_sidebar");
  state.sidebarCollapsed =
    window.innerWidth < 900 ? true : storedSidebar !== null ? storedSidebar === "1" : window.innerWidth < 1100;
  applySidebar();
  bindUI();
  try {
    await loadState();
  } catch (err) {
    els.thread.innerHTML = `<div class="empty-chat"><h2>加载失败</h2><p>${escapeHtml(err.message || String(err))}</p></div>`;
  }
}

init();

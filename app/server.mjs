import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, newNode } from "./lib/store.mjs";
import { DeepSeekClient } from "./lib/deepseek.mjs";
import { runResearch } from "./lib/research.mjs";
import { demoResearch, makeDemoNodes } from "./lib/demo.mjs";
import { formatError, truncate, uid } from "./lib/util.mjs";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, "public");
const DATA_DIR = path.join(APP_DIR, "data");
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(DATA_DIR, "db.json");

for (const envFile of [path.join(APP_DIR, ".env"), path.join(path.dirname(APP_DIR), ".env")]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // .env 不存在时忽略
  }
}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4317);
const HAS_KEY = Boolean(process.env.DEEPSEEK_API_KEY);
const DEMO = process.env.DEMO === "1" || !HAS_KEY;
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const STRONG_MODEL = process.env.DEEPSEEK_STRONG_MODEL || "deepseek-v4-pro";

const client = HAS_KEY
  ? new DeepSeekClient({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: MODEL,
      strongModel: STRONG_MODEL,
    })
  : null;

const store = await createStore(DATA_FILE);

if (DEMO && store.nodes.length === 0) {
  store.replaceNodes(makeDemoNodes());
  await store.save();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("请求体过大（上限 2MB）");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

function statePayload() {
  return {
    session: store.session,
    nodes: store.nodes,
    config: {
      mode: DEMO ? "demo" : "live",
      hasKey: HAS_KEY,
      demo: DEMO,
      model: MODEL,
      strongModel: STRONG_MODEL,
      version: "0.3.3",
    },
  };
}

function gradeForClaims(claims) {
  if (!Array.isArray(claims) || !claims.length) return "none";
  if (claims.some((c) => c.verdict === "retracted")) return "retracted";
  if (claims.some((c) => c.verdict === "contested")) return "contested";
  if (claims.every((c) => c.verdict === "strong")) return "strong";
  if (claims.some((c) => c.verdict === "strong" || c.verdict === "moderate")) return "moderate";
  return "single-source";
}

async function handleAsk(req, res) {
  const body = await readJson(req);
  const question = String(body.question || "").trim();
  if (!question) return sendJson(res, 400, { error: "问题不能为空" });
  if (question.length > 4000) return sendJson(res, 400, { error: "问题太长（上限 4000 字）" });

  const parentId = body.parentId || null;
  if (parentId && !store.getNode(parentId)) return sendJson(res, 404, { error: "父节点不存在" });

  const mode = body.mode === "web" ? "web" : "academic";
  const anchor =
    body.anchor && typeof body.anchor.quote === "string" && body.anchor.quote.trim()
      ? { quote: body.anchor.quote.trim().slice(0, 1200), page: body.anchor.page || null }
      : null;

  const node = newNode({ parentId, question, anchor, mode, status: "researching", isDemo: DEMO });
  store.addNode(node);
  await store.save();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  const send = (event, data) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  };
  const ping = setInterval(() => {
    if (!closed) {
      try {
        res.write(": ping\n\n");
      } catch {
        closed = true;
      }
    }
  }, 15000);

  req.on("close", () => {
    closed = true;
    clearInterval(ping);
  });

  send("node", { node });

  try {
    if (DEMO) {
      const result = demoResearch(question, parentId);
      for (const t of result.trace) {
        node.trace.push(t);
        send("trace", t);
        await new Promise((r) => setTimeout(r, 220));
      }
      node.sources = result.sources;
      node.claims = result.claims;
      node.answer = result.answer;
      node.usage = result.usage;
      node.status = "done";
      node.completedAt = new Date().toISOString();
      await store.save();
      const grade = gradeForClaims(node.claims);
      send("sources", node.sources);
      send("answer", { answer: node.answer, claims: node.claims, grade, caveats: [] });
      send("done", { node });
      return;
    }

    if (!client) throw new Error("DeepSeek 未配置");

    const result = await runResearch({
      client,
      question,
      parent: parentId ? store.getNode(parentId) : null,
      session: store.session,
      nodes: store.nodes,
      anchor,
      mode,
      emit: (event, data) => {
        if (event === "trace") {
          node.trace.push(data);
        }
        if (event === "sources") {
          node.sources = data;
        }
        send(event, data);
      },
    });

    node.answer = result.answer;
    node.claims = result.claims || [];
    node.sources = result.sources || [];
    node.trace = result.trace || node.trace;
    node.usage = result.usage || null;
    node.status = "done";
    node.completedAt = new Date().toISOString();
    node.grade = result.grade || gradeForClaims(node.claims);
    await store.save();
    send("answer", {
      answer: node.answer,
      claims: node.claims,
      grade: node.grade,
      caveats: result.caveats || [],
    });
    send("done", { node });
  } catch (err) {
    node.status = "error";
    node.answer = `检索/回答失败：${formatError(err)}`;
    node.completedAt = new Date().toISOString();
    await store.save();
    send("error", { message: node.answer });
    send("done", { node });
  } finally {
    clearInterval(ping);
    if (!res.writableEnded) res.end();
  }
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/annotate.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return serveStatic(req, res, path.posix.join(pathname, "index.html"));
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, mode: DEMO ? "demo" : "live", version: "0.3.3" });
  }
  if (pathname === "/api/state" && req.method === "GET") {
    return sendJson(res, 200, statePayload());
  }
  if (pathname === "/api/settings" && req.method === "POST") {
    const body = await readJson(req);
    const patch = {};
    if (typeof body.title === "string") patch.title = body.title.slice(0, 120);
    if (typeof body.paperTitle === "string") patch.paperTitle = body.paperTitle.slice(0, 240);
    if (typeof body.paperText === "string") patch.paperText = body.paperText.slice(0, 200_000);
    if (body.mode === "academic" || body.mode === "web") patch.mode = body.mode;
    store.updateSession(patch);
    await store.save();
    return sendJson(res, 200, { session: store.session });
  }
  if (pathname === "/api/ask" && req.method === "POST") {
    return handleAsk(req, res);
  }
  if (pathname.startsWith("/api/nodes/") && req.method === "PATCH") {
    const id = pathname.split("/").pop();
    const node = store.getNode(id);
    if (!node) return sendJson(res, 404, { error: "节点不存在" });
    const body = await readJson(req);
    const patch = {};
    if (typeof body.collapsed === "boolean") patch.collapsed = body.collapsed;
    if (typeof body.understood === "boolean") patch.understood = body.understood;
    if (typeof body.scrollOffset === "number") patch.scrollOffset = Math.max(0, body.scrollOffset);
    if (body.note && typeof body.note === "object") {
      const note = body.note;
      patch.note = {
        ox: Number.isFinite(note.ox) ? note.ox : 24,
        oy: Number.isFinite(note.oy) ? note.oy : -10,
        w: Number.isFinite(note.w) ? Math.max(220, Math.min(900, note.w)) : 340,
        h: Number.isFinite(note.h) ? Math.max(120, Math.min(760, note.h)) : 230,
        collapsed: Boolean(note.collapsed),
        moved: Boolean(note.moved),
      };
    }
    store.updateNode(id, patch);
    await store.save();
    return sendJson(res, 200, { node });
  }
  if (pathname === "/api/reset" && req.method === "POST") {
    store.resetNodes();
    await store.save();
    return sendJson(res, 200, statePayload());
  }
  if (pathname === "/api/demo" && req.method === "POST") {
    store.replaceNodes(makeDemoNodes());
    await store.save();
    return sendJson(res, 200, statePayload());
  }

  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "API not found" });
  }
  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: formatError(err) });
    } else {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  PaperTree 0.1");
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  mode: ${DEMO ? "DEMO (未配置 DEEPSEEK_API_KEY)" : "LIVE"}`);
  console.log(`  model: ${MODEL}${HAS_KEY ? "" : " (not configured)"}`);
  console.log("");
  if (DEMO) {
    console.log("  配置方式：复制 app/.env.example 为 app/.env，填入 DEEPSEEK_API_KEY，然后重启。");
    console.log("");
  }
});

process.on("SIGINT", async () => {
  try {
    await store.flush();
  } finally {
    process.exit(0);
  }
});

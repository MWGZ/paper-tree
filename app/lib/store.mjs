import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, uid } from "./util.mjs";

export function defaultSession() {
  const now = nowIso();
  return {
    id: "session_main",
    title: "Transformer 论文精读",
    paperTitle: "Attention Is All You Need",
    paperText: "",
    mode: "academic",
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyData() {
  return {
    version: 1,
    session: defaultSession(),
    nodes: [],
  };
}

export async function createStore(file) {
  let data;
  try {
    const raw = await fs.readFile(file, "utf8");
    data = JSON.parse(raw);
  } catch {
    data = emptyData();
  }

  if (!data.session) data.session = defaultSession();
  if (!Array.isArray(data.nodes)) data.nodes = [];
  data.nodes = data.nodes.map((node) => ({
    collapsed: false,
    understood: false,
    scrollOffset: 0,
    sources: [],
    claims: [],
    trace: [],
    ...node,
  }));

  let writeQueue = Promise.resolve();

  async function persist() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  function save() {
    writeQueue = writeQueue.then(persist, persist);
    return writeQueue;
  }

  return {
    get data() {
      return data;
    },
    get session() {
      return data.session;
    },
    get nodes() {
      return data.nodes;
    },
    getNode(id) {
      return data.nodes.find((n) => n.id === id) || null;
    },
    addNode(node) {
      data.nodes.push(node);
      return node;
    },
    updateNode(id, patch) {
      const node = data.nodes.find((n) => n.id === id);
      if (!node) return null;
      Object.assign(node, patch);
      return node;
    },
    updateSession(patch) {
      Object.assign(data.session, patch, { updatedAt: nowIso() });
      return data.session;
    },
    replaceNodes(nodes) {
      data.nodes = nodes;
    },
    resetNodes() {
      data.nodes = [];
    },
    save,
    async flush() {
      await writeQueue;
    },
  };
}

export function newNode({ parentId = null, question, anchor = null, mode = "academic", status = "researching", isDemo = false }) {
  return {
    id: uid("n"),
    parentId,
    question,
    answer: "",
    status,
    createdAt: nowIso(),
    completedAt: null,
    anchor,
    mode,
    sources: [],
    claims: [],
    trace: [],
    usage: null,
    collapsed: false,
    understood: false,
    scrollOffset: 0,
    isDemo,
  };
}

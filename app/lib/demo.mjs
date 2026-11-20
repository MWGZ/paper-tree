import { nowIso, uid } from "./util.mjs";

const DEMO_FETCHED_AT = nowIso();

function src(partial) {
  return {
    id: "",
    title: "",
    authors: [],
    year: new Date().getFullYear(),
    venue: "",
    doi: "",
    arxivId: "",
    pmid: "",
    url: "",
    oaUrl: "",
    type: "journal",
    tier: "A1",
    peerReviewed: true,
    retracted: false,
    citationCount: 0,
    abstract: "",
    content: "",
    source: "demo",
    authority: null,
    fetchedAt: DEMO_FETCHED_AT,
    snapshotHash: "demo",
    ...partial,
  };
}

export const DEMO_SOURCES = [
  src({
    id: "S1",
    title: "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness",
    authors: ["Tri Dao", "Daniel Y. Fu", "Stefano Ermon", "Atri Rudra", "Christopher Ré"],
    year: 2022,
    venue: "NeurIPS 2022",
    arxivId: "2205.14135",
    url: "https://arxiv.org/abs/2205.14135",
    oaUrl: "https://arxiv.org/pdf/2205.14135",
    type: "conference",
    tier: "A1",
    peerReviewed: true,
    citationCount: 4200,
    abstract:
      "Attention is slow and memory-hungry on long sequences. FlashAttention is an IO-aware exact attention algorithm that uses tiling to reduce memory reads/writes between GPU high bandwidth memory and on-chip SRAM. It computes exact attention, speeds up training 2-4x, and reduces memory from quadratic to linear.",
    content:
      "FlashAttention is an IO-aware exact attention algorithm. It uses tiling to reduce HBM accesses. It computes exact attention (not an approximation), speeds up training 2-4x, and reduces memory from quadratic to linear. The asymptotic compute complexity of attention remains quadratic in sequence length.",
  }),
  src({
    id: "S2",
    title: "BigBird: Transformers for Longer Sequences",
    authors: ["Manzil Zaheer", "Guru Guruganesh", "Avinava Dubey", "Joshua Ainslie", "Chris Alberti"],
    year: 2020,
    venue: "NeurIPS 2020",
    arxivId: "2007.14062",
    url: "https://arxiv.org/abs/2007.14062",
    oaUrl: "https://arxiv.org/pdf/2007.14062",
    type: "conference",
    tier: "A1",
    peerReviewed: true,
    citationCount: 3000,
    abstract:
      "BigBird proposes sparse attention mechanisms, including sliding-window attention, global tokens, and random connections, to reduce the quadratic complexity of Transformer attention to linear complexity while preserving expressiveness.",
    content:
      "BigBird uses sparse attention with sliding-window, global, and random connections. It reduces the quadratic complexity of attention to linear complexity in sequence length, while maintaining theoretical expressiveness.",
  }),
  src({
    id: "S3",
    title: "FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning",
    authors: ["Tri Dao"],
    year: 2023,
    venue: "arXiv preprint",
    arxivId: "2307.08691",
    url: "https://arxiv.org/abs/2307.08691",
    oaUrl: "https://arxiv.org/pdf/2307.08691",
    type: "preprint",
    tier: "B",
    peerReviewed: false,
    citationCount: 1200,
    abstract:
      "FlashAttention-2 improves the parallelism and work partitioning of FlashAttention. It remains an exact attention algorithm; the quadratic compute complexity is unchanged, while memory efficiency and GPU utilization are improved.",
    content:
      "FlashAttention-2 is an exact attention algorithm. It improves parallelism and work partitioning. The quadratic compute complexity of attention is unchanged; the improvements are in memory efficiency and GPU utilization.",
  }),
  src({
    id: "S4",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones"],
    year: 2017,
    venue: "NeurIPS 2017",
    arxivId: "1706.03762",
    url: "https://arxiv.org/abs/1706.03762",
    oaUrl: "https://arxiv.org/pdf/1706.03762",
    type: "conference",
    tier: "A1",
    peerReviewed: true,
    citationCount: 120000,
    abstract:
      "The Transformer uses self-attention to draw global dependencies between input and output. Scaled dot-product attention computes QK^T, applies softmax, and multiplies by V, which requires an n x n attention matrix.",
    content:
      "Scaled dot-product attention computes QK^T, applies softmax, and multiplies by V. Q and K have shape n x d_k, so QK^T is n x n. The total attention complexity is O(n^2 d). The paper scales dot products by 1/sqrt(d_k) to avoid softmax saturation when d_k is large.",
  }),
];

function claim({ text, sourceIds, quote = "", verdict = "single-source", note = "", independenceGroups = 1, quoteVerified = true }) {
  return {
    text,
    sourceIds,
    quote,
    verdict,
    note,
    independenceGroups,
    quoteVerified,
  };
}

function makeNode({ id, parentId, question, answer, createdAt, anchor = null, sources, claims, trace, mode = "academic" }) {
  return {
    id,
    parentId,
    question,
    answer,
    status: "done",
    createdAt,
    completedAt: createdAt,
    anchor,
    mode,
    sources,
    claims,
    trace,
    usage: { prompt_tokens: 3200, completion_tokens: 620, total_tokens: 3820 },
    collapsed: false,
    understood: false,
    scrollOffset: 0,
    isDemo: true,
  };
}

const T = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

const ROOT_A_ANSWER = `没有。**FlashAttention 仍然是 O(n²) 计算**，它优化的是显存和 IO，而不是渐进复杂度 [S1]。

标准 self-attention 要先算 n×n 的分数矩阵，再乘 V，计算量是 O(n²d) [S4]。FlashAttention 通过分块（tiling）减少 HBM 读写，把显存从 O(n²) 降到 O(n)、速度提升 2–4 倍，但它算的仍然是**精确注意力**，没有把 n×n 的交互降成线性 [S1]。

把复杂度降到 O(n) 的是另一类方法：BigBird 的稀疏/局部注意力、线性注意力等 [S2][S3]。

所以准确说法是：**FlashAttention 降低的是显存和 IO 成本，不是渐进复杂度。**`;

const MEMORY_ANSWER = `FlashAttention 把显存从 O(n²) 降到 O(n)，靠的是**分块（tiling）+ 不物化 n×n 注意力矩阵** [S1]。

标准 attention 会先把 QKᵀ 的 n×n 分数矩阵写回 HBM，再读出来做 softmax、再乘 V；显存占用是 O(n²)。FlashAttention 把 Q、K、V 切块，在 SRAM 里完成 softmax 和乘 V，只把最终结果写回 HBM，所以不再需要保存完整的 n×n 矩阵 [S1]。

注意：这里降的是**显存**，不是计算复杂度；它仍然是 exact attention，计算量仍是 O(n²) [S1][S3]。`;

const CHILD_A_ANSWER = `FlashAttention 和 BigBird 解决的不是同一个问题：

- **FlashAttention 是精确注意力的 IO 优化**：计算仍是 O(n²)，但显存 O(n)、速度快，不改变注意力模式 [S1]。
- **BigBird 用稀疏注意力换长度**：滑窗 + 全局 token + 随机连接，把复杂度降到 O(n)，但改变了注意力模式 [S2]。
- 所以前者不改变模型表达，后者用稀疏性换长度；两者可以叠加，但不是替代关系 [S3]。`;

const ROOT_B_ANSWER = `因为 QKᵀ 会生成一个 n×n 的分数矩阵 [S4]。

Q、K 的形状是 n×d_k，QKᵀ 的计算量是 O(n²d_k)；softmax 对 n² 个元素归一化，O(n²)；再乘 V 是 O(n²d_v)。所以总复杂度是 **O(n²d)** [S4]。

这也是为什么序列长度翻倍，计算量和显存大约变成 4 倍；BigBird 等稀疏方法就是为了绕开这个 n×n 矩阵 [S2]。`;

const CHILD_B_ANSWER = `点积的方差随 d_k 线性增长。假设 q、k 各分量独立、均值 0、方差 1，则 q·k 的方差是 d_k，标准差是 √d_k [S4]。

如果不缩放，d_k 大时 softmax 的输入会进入饱和区，梯度很小，训练不稳定。除以 √d_k 把方差拉回 1 左右 [S4]。

论文里这也是 scaled dot-product attention 的“scaled”含义 [S4]。`;

const ROOT_A_TRACE = [
  { at: T(46), type: "plan", message: "识别为学术事实核查；生成 3 个查询（英文优先）" },
  { at: T(45), type: "search", message: "OpenAlex · 12 条 → 去重 7 篇" },
  { at: T(45), type: "search", message: "Semantic Scholar · 8 条 → 3 篇新增" },
  { at: T(44), type: "fetch", message: "精读 3 篇：FlashAttention / FlashAttention-2 / BigBird" },
  { at: T(44), type: "verify", message: "4 条 claim：2 强 / 1 中等 / 1 单一来源" },
];

const CHILD_A_TRACE = [
  { at: T(31), type: "plan", message: "对比型问题；检索两条技术路线" },
  { at: T(30), type: "search", message: "OpenAlex · 9 条；Semantic Scholar · 5 条" },
  { at: T(30), type: "fetch", message: "精读 2 篇：FlashAttention-2 / BigBird" },
  { at: T(29), type: "verify", message: "3 条 claim：2 强 / 1 单一来源" },
];

const ROOT_B_TRACE = [
  { at: T(21), type: "plan", message: "概念解释；优先原始论文" },
  { at: T(20), type: "search", message: "OpenAlex · 6 条；Crossref · 4 条" },
  { at: T(20), type: "fetch", message: "精读 Attention Is All You Need + BigBird" },
  { at: T(19), type: "verify", message: "3 条 claim：1 强 / 2 单一来源" },
];

const CHILD_B_TRACE = [
  { at: T(13), type: "plan", message: "公式解释；查原始论文的 scaled dot-product 段落" },
  { at: T(12), type: "search", message: "OpenAlex · 5 条；Crossref · 2 条" },
  { at: T(12), type: "verify", message: "2 条 claim：均为单一来源（原始论文）" },
];

export function makeDemoNodes() {
  return [
    makeNode({
      id: "n_demo_flash_root",
      parentId: null,
      question: "FlashAttention 真的把 attention 复杂度降到 O(n) 了吗？",
      answer: ROOT_A_ANSWER,
      createdAt: T(46),
      sources: DEMO_SOURCES,
      claims: [
        claim({
          text: "FlashAttention 是精确注意力，计算复杂度仍是 O(n²)，没有把 n×n 交互降成线性",
          sourceIds: ["S1", "S3"],
          quote: "It computes exact attention (not an approximation)",
          verdict: "moderate",
          note: "A1 原始论文 + B 预印本；预印本只作辅助。",
          independenceGroups: 2,
        }),
        claim({
          text: "FlashAttention 把显存从 O(n²) 降到 O(n)",
          sourceIds: ["S1"],
          quote: "reduces memory from quadratic to linear",
          verdict: "single-source",
          note: "只有原始论文；可再找独立复现/综述。",
          independenceGroups: 1,
        }),
        claim({
          text: "BigBird 用稀疏注意力把复杂度降到 O(n)",
          sourceIds: ["S2"],
          quote: "reduces the quadratic complexity of Transformer attention to linear complexity",
          verdict: "single-source",
          note: "BigBird 原论文直接支持；尚未找独立综述。",
          independenceGroups: 1,
        }),
        claim({
          text: "FlashAttention 与 BigBird 解决的不是同一个问题",
          sourceIds: ["S1", "S2"],
          quote: "exact attention / sparse attention",
          verdict: "strong",
          note: "两篇 A1 独立来源，结论方向一致。",
          independenceGroups: 2,
        }),
      ],
      trace: ROOT_A_TRACE,
    }),
    makeNode({
      id: "n_demo_flash_child",
      parentId: "n_demo_flash_root",
      question: "那它和 Longformer/BigBird 的区别是什么？",
      answer: CHILD_A_ANSWER,
      createdAt: T(31),
      anchor: { quote: "把复杂度降到 O(n) 的是另一类方法", page: null },
      sources: [DEMO_SOURCES[0], DEMO_SOURCES[1], DEMO_SOURCES[2]],
      claims: [
        claim({
          text: "FlashAttention 是精确注意力，不改变注意力模式",
          sourceIds: ["S1"],
          quote: "exact attention",
          verdict: "single-source",
          independenceGroups: 1,
        }),
        claim({
          text: "BigBird 用稀疏注意力把复杂度降到 O(n)",
          sourceIds: ["S2"],
          quote: "linear complexity",
          verdict: "single-source",
          independenceGroups: 1,
        }),
        claim({
          text: "两者解决的不是同一个问题，可以叠加",
          sourceIds: ["S1", "S2"],
          quote: "exact vs sparse",
          verdict: "strong",
          note: "两篇 A1 独立来源。",
          independenceGroups: 2,
        }),
      ],
      trace: CHILD_A_TRACE,
    }),
    makeNode({
      id: "n_demo_complexity_root",
      parentId: null,
      question: "Transformer 的 self-attention 复杂度为什么是 O(n²)？",
      answer: ROOT_B_ANSWER,
      createdAt: T(21),
      sources: [DEMO_SOURCES[3], DEMO_SOURCES[1]],
      claims: [
        claim({
          text: "QKᵀ 生成 n×n 的分数矩阵，总复杂度 O(n²d)",
          sourceIds: ["S4"],
          quote: "QK^T is n x n; total attention complexity is O(n^2 d)",
          verdict: "single-source",
          independenceGroups: 1,
        }),
        claim({
          text: "BigBird 等稀疏方法绕开 n×n 矩阵，把复杂度降到 O(n)",
          sourceIds: ["S2"],
          quote: "linear complexity",
          verdict: "single-source",
          independenceGroups: 1,
        }),
      ],
      trace: ROOT_B_TRACE,
    }),
    makeNode({
      id: "n_demo_scale_child",
      parentId: "n_demo_complexity_root",
      question: "为什么要除以 √d_k？",
      answer: CHILD_B_ANSWER,
      createdAt: T(13),
      anchor: { quote: "总复杂度是 O(n²d)", page: null },
      sources: [DEMO_SOURCES[3]],
      claims: [
        claim({
          text: "点积方差随 d_k 线性增长，标准差是 √d_k",
          sourceIds: ["S4"],
          quote: "scale dot products by 1/sqrt(d_k)",
          verdict: "single-source",
          independenceGroups: 1,
        }),
        claim({
          text: "不缩放会让 softmax 进入饱和区，梯度变小",
          sourceIds: ["S4"],
          quote: "softmax saturation",
          verdict: "single-source",
          independenceGroups: 1,
        }),
      ],
      trace: CHILD_B_TRACE,
    }),
  ];
}

export function demoResearch(question, parentId = null) {
  const nodeId = uid("n_demo");
  const isMemory = /显存|memory|HBM|SRAM/i.test(question);
  const isCompare = /区别|longformer|bigbird|稀疏|sparse/i.test(question);
  const isFlash = /flashattention|flash attention|o\(n\)|复杂度/i.test(question);

  let answer;
  let sources;
  let claims;
  if (isMemory) {
    answer = MEMORY_ANSWER;
    sources = [DEMO_SOURCES[0], DEMO_SOURCES[2]];
    claims = [
      claim({
        text: "FlashAttention 用分块避免物化 n×n 注意力矩阵，把显存从 O(n²) 降到 O(n)",
        sourceIds: ["S1"],
        quote: "reduces memory from quadratic to linear",
        verdict: "single-source",
        independenceGroups: 1,
      }),
      claim({
        text: "它仍然是精确注意力，计算复杂度仍是 O(n²)",
        sourceIds: ["S1", "S3"],
        quote: "exact attention",
        verdict: "moderate",
        independenceGroups: 2,
      }),
    ];
  } else if (isCompare) {
    answer = CHILD_A_ANSWER;
    sources = [DEMO_SOURCES[0], DEMO_SOURCES[1], DEMO_SOURCES[2]];
    claims = [
      claim({
        text: "FlashAttention 是精确注意力，不改变注意力模式",
        sourceIds: ["S1"],
        quote: "exact attention",
        verdict: "single-source",
        independenceGroups: 1,
      }),
      claim({
        text: "BigBird 用稀疏注意力把复杂度降到 O(n)",
        sourceIds: ["S2"],
        quote: "linear complexity",
        verdict: "single-source",
        independenceGroups: 1,
      }),
      claim({
        text: "两者解决的不是同一个问题，可以叠加",
        sourceIds: ["S1", "S2"],
        quote: "exact vs sparse",
        verdict: "strong",
        independenceGroups: 2,
      }),
    ];
  } else if (isFlash) {
    answer = ROOT_A_ANSWER;
    sources = DEMO_SOURCES;
    claims = [
      claim({
        text: "FlashAttention 是精确注意力，复杂度仍是 O(n²)",
        sourceIds: ["S1", "S3"],
        quote: "exact attention",
        verdict: "moderate",
        independenceGroups: 2,
      }),
      claim({
        text: "BigBird 用稀疏注意力把复杂度降到 O(n)",
        sourceIds: ["S2"],
        quote: "linear complexity",
        verdict: "single-source",
        independenceGroups: 1,
      }),
    ];
  } else {
    answer = `（演示模式）当前没有配置 \`DEEPSEEK_API_KEY\`，所以这是一个模拟回答。

你问的是：「${question}」。

配置 key 后，这里会走完整流程：研究计划 → DeepSeek Search + OpenAlex/Semantic Scholar → 证据抽取 → 带引用回答。示例树里已经展示了引用 chip、来源卡、证据表和研究轨迹的样子。`;
    sources = [];
    claims = [];
  }

  return {
    nodeId,
    answer,
    sources,
    claims,
    trace: [
      { at: nowIso(), type: "plan", message: "演示模式：不会真的调用检索或模型" },
      { at: nowIso(), type: "search", message: "跳过 DeepSeek Search / 学术 API" },
      { at: nowIso(), type: "verify", message: "跳过交叉验证" },
    ],
    usage: null,
    mode: "demo",
  };
}

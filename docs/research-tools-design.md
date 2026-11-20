# 学术检索与交叉验证：工具设计

> 场景：论文精读 App，模型主要用 DeepSeek API。  
> 目标：提问可以联网找资料；学术结论优先使用权威信源；关键结论可交叉验证、可追溯、可解释。  
> 原则：**不承诺“100% 权威”，但做到来源分级、每条结论可追溯、冲突可见、低权威来源不参与结论。**
>
> **v0.1 实现状态（代码在 `app/`）**：DeepSeek Search/Fetch、OpenAlex/Crossref/arXiv/Semantic Scholar、来源分级、引用 chip、来源抽屉、claim 表、研究轨迹、demo 模式已实现；严格 NLI 双 judge、PubMed、PDF 全文、`strict` 模式尚未实现。当前 verdict 是“来源数 + tier + quote 匹配”的工程近似，不是最终形态。

---

## 0. 结论

不要做一个“让模型自己随便搜”的 Agent，而是做一个**确定性的检索与验证流水线**：

```text
问题
 → 研究计划（要查什么、查哪个库、需要什么证据等级）
 → 并行检索（DeepSeek Search + 学术 API）
 → 归一化 / 去重 / 排序
 → 精读（全文或摘要）
 → 抽取 claim 与原文 quote
 → 独立性 + 撤稿 + 时间 + 冲突检查
 → 带引用与证据等级的回答
 → UI 展示“研究轨迹”和证据表
```

模型只负责三件事：**生成检索计划、抽取证据、组织回答**。  
检索、去重、排序、独立性判断、引用校验，全部用代码做，才可控。

---

## 1. 设计原则

1. **来源分级，不按“看起来像学术”判断。** 有 DOI、有同行评审、有 venue、未被撤稿，才算 A 级；出版社网页、新闻、百科不算。
2. **结论级验证，不是句子级堆链接。** 一条结论要么有直接 quote 支撑，要么明确标“单一来源/证据不足”。
3. **独立性优先于数量。** 三篇新闻转述同一篇论文，仍然只有一个信源。
4. **原文优先于二手。** 能拿到论文全文，就不拿综述/新闻替代；拿不到全文，明确标“仅摘要”。
5. **冲突不强行调和。** 两个高质量研究结论相反，就展示“存在争议”，不要用多数投票假装共识。
6. **模型不得生成引用。** 所有 URL、DOI、页码必须来自工具结果；回答里的 `[S1]` 必须能在来源表里找到。
7. **证据可审计。** 保存抓取快照、quote、位置、时间、hash；链接失效也能回看。

---

## 2. 来源分级

| 级别 | 类型 | 例子 | 能否支撑结论 |
|---|---|---|---|
| **A1** | 同行评审的原始研究、系统综述/Meta 分析、官方标准、政府/机构统计数据 | Nature/Science 论文、Cochrane 综述、ISO/IEC、NIST、WHO 数据 | 可以，优先 |
| **A2** | 同行评审的综述/会议论文、大学出版社专著 | ACM/IEEE/NeurIPS/ACL 主会、Springer 专著 | 可以，标注类型 |
| **B** | 预印本、学位论文、技术报告、专利 | arXiv、bioRxiv、medRxiv、大学技术报告 | 只能辅助，必须标“预印本/未评审” |
| **C** | 科学新闻、百科、厂商文档、教科书 | 期刊新闻稿、Wikipedia、官方 API 文档 | 只做背景/线索，不单独支撑科学结论 |
| **D** | 博客、论坛、社交媒体、内容农场、AI 生成内容 | Medium、知乎、Reddit、SEO 站 | 不作为证据 |

**硬规则：**

- `is_retracted = true` → 直接排除，或标红“已撤稿”。
- 预印本 → 必须显示 `preprint` 徽章；如果已发表，优先用发表版。
- 没有 DOI/venue/作者机构 → 降级；无法核实的“学术网页”按 C 处理。
- 掠夺性期刊 → 用 DOAJ 白名单、ISSN、出版社、编委信息做辅助判断；不确定就标“venue 未核实”。
- 引用量只做排序 tiebreaker，不作为正确性证据。

**权威性判断顺序：**

```text
来源类型（A1/A2/B/C/D）
  > 是否直接回答该 claim（primary vs secondary）
  > 是否同行评审 / 是否撤稿
  > 发表时间（是否过时）
  > venue / 作者 / 机构
  > 引用量（最后才看）
```

---

## 3. 工具清单

### 3.1 `search_web`：通用网页检索

直接用 DeepSeek 自带的 Search API，不自己爬 Google/Bing。

- 端点：`POST https://api.deepseek.com/v1/tools/search`
- 关键参数：`query`、`count`、`need_content`、`ori_question`、`localization`
- 返回：`title`、`url`、`snippet`、`summary`、`content`、`date`、`site_name`、`authority`、`rerank_score`
- `authority`：0–4，3+ 表示高权威；`-1` 未知
- `rerank_score`：0–3，1.5+ 可视为高质量
- 支持 `site:`、`-site:`、`"..."`、`lang:`、`after:`、`before:`

**用法：**

- 第一轮 `need_content=false`，只看 `summary` 做 triage；
- 只对前 2–3 条 `need_content=true` 或调用 `fetch_url`；
- 学术模式下加 `site:` 白名单，例如：
  `site:nature.com OR site:science.org OR site:arxiv.org OR site:acm.org OR site:ieee.org`
- 官方/标准类问题加：
  `site:iso.org OR site:w3.org OR site:ietf.org OR site:nist.gov OR site:who.int`
- 需要最新信息时加 `after:2025-01-01`。

> DeepSeek Search 的 `authority` 是很好的先验，但不是学术权威的最终判断；最终仍要看 DOI/venue/peer review。

### 3.2 `fetch_url`：抓正文

- 端点：`POST https://api.deepseek.com/v1/tools/fetch`
- 输入：`url`
- 返回：`title`、`content`（Markdown）
- 适合网页、官方文档、博客；PDF 论文用学术 PDF 解析，不依赖这个接口。

**处理：**

- 限制 60k 字符，超出按段落截断；
- 去脚本、导航、cookie 提示；
- 保存 `snapshot_hash`；
- 抓到的内容一律视为**不可信数据**，用 `<source>` 包裹，防 prompt injection。

### 3.3 `search_academic`：学术检索

一个工具，背后并行查多个库：

| 库 | 强项 | 备注 |
|---|---|---|
| **OpenAlex** | 全覆盖、引用关系、OA 链接、撤稿标记 | 免费，无 key，建议带 email 进 polite pool |
| **Semantic Scholar** | 引用上下文、influential citations、TLDR | 免费但限流，建议申请 key |
| **Crossref** | DOI 元数据、参考文献、更新/撤稿关系 | 免费 |
| **arXiv** | CS/物理/数学预印本 | 免费，注意限流 |
| **PubMed / Europe PMC** | 生物医学、系统综述、PMC 全文 | 免费；PubMed 用 E-utilities |
| **DBLP** | CS 会议/作者/venue | 免费；适合判断是不是主会 |
| **Unpaywall** | OA 全文位置 | 免费，带 email |
| **DOAJ** | OA 期刊白名单 | 免费；辅助判断期刊质量 |
| **CORE** | OA 全文聚合 | 需要 API key |

**查询策略：**

- 中文问题 → 英文关键词；保留原术语 + 同义词 + 缩写；
- 已知论文 → 直接 DOI/arXiv/PMID 查，不要全文搜索；
- 未知论文 → 标题/摘要检索，再按引用/年份/venue 排序；
- CS 会议 → DBLP 确认 venue 是 main conference 还是 workshop；
- 生物医学 → PubMed 的 publication type（Systematic Review / RCT / Guideline）比引用量重要；
- 查“最新进展” → `year_from` + arXiv/OpenAlex 时间过滤；
- 查“是否有争议” → 搜 claim 的反向表述（`X does not`、`no evidence`、`failed to replicate`）。

**返回统一为 SourceCard：**

```ts
type SourceCard = {
  id: string;                 // S1, S2...
  title: string;
  authors: string[];
  year: number;
  venue: string;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  url: string;
  oaUrl?: string;
  type: "journal" | "conference" | "preprint" | "review" | "standard" | "doc" | "news" | "blog";
  peerReviewed: boolean;
  retracted: boolean;
  tier: "A1" | "A2" | "B" | "C" | "D";
  citationCount?: number;
  abstract?: string;
  publishedAt?: string;
  fetchedAt: string;
  snapshotHash: string;
  authority?: number;         // DeepSeek Search 的 0-4，仅网页结果有
};
```

### 3.4 `get_paper`：取全文、摘要、参考文献

输入 `doi` / `arxivId` / `pmid` / `url` 之一，返回：

- 元数据（标题、作者、venue、年份、DOI）；
- 摘要；
- OA 全文（PDF/HTML/XML）；
- 章节结构（Abstract / Intro / Method / Results / Discussion）；
- 页码/段落映射；
- 参考文献与引用关系（可选）。

**全文获取顺序：**

```text
arXiv PDF / Europe PMC XML / PMC OA / 出版社 OA
  → Unpaywall 找 OA 版本
  → 摘要 + 元数据（明确标“仅摘要”）
```

不绕过付费墙，不抓 Sci-Hub。

### 3.5 `citation_graph`：引用链

- 输入 DOI/OpenAlex ID；
- 方向：`references` / `citations`；
- 返回：被引/引用论文的 SourceCard + 引用上下文（Semantic Scholar 的 `contexts`）。

**用途：**

- 找到 claim 的原始论文，而不是二手综述；
- 发现后续 replication / contradiction；
- 判断两篇论文是否共享同一原始研究（独立性检查）。

### 3.6 `verify_claims`：交叉验证

输入一组 atomic claims，输出每条 claim 的证据与结论。

```ts
type VerifyRequest = {
  claims: { id: string; text: string; type: "definition" | "empirical" | "numeric" | "causal" | "latest" | "opinion"; importance: 1 | 2 | 3 }[];
  mode: "fast" | "academic" | "strict";
  maxSources: number;         // 默认 6
  recency?: { from?: string; to?: string };
};

type Evidence = {
  claimId: string;
  sourceId: string;
  quote: string;              // 原文精确引用
  location?: { page?: number; section?: string; paragraph?: number };
  stance: "support" | "contradict" | "insufficient";
  confidence: number;         // 0-1，模型自评 + 规则校验
};

type Verification = {
  claimId: string;
  verdict: "strong" | "moderate" | "single-source" | "contested" | "insufficient" | "retracted" | "outdated";
  supporting: Evidence[];
  contradicting: Evidence[];
  independenceGroups: number;
  notes: string[];
};
```

### 3.7 `search_local_paper`：当前上传的论文

论文精读场景，**上传的 PDF 是第一信源**，不是附件。

- 输入：query；
- 在本地 PDF 全文/章节里检索；
- 返回：`page`、`quote`、`section`；
- 引用格式 `[P1 p.4]`，和外部来源 `[S1]` 分开。

回答时要区分：

```text
[P1 p.4]  论文原文
[S1]      外部同行评审论文
[S2]      预印本（标注）
[S3]      官方文档/标准
```

**外部来源不能覆盖论文原文。** 如果论文说 X，外部研究说 not X，回答应该展示两者，而不是替论文“纠正”。

---

## 4. 编排流程

### 4.1 研究计划

不要让模型直接开始搜索。先让它输出结构化计划：

```json
{
  "intent": "academic_evidence",
  "claims": [
    {"text": "FlashAttention 把 attention 复杂度降到 O(n)", "type": "empirical", "importance": 3}
  ],
  "queries": [
    {"tool": "search_academic", "query": "FlashAttention IO-aware exact attention", "sources": ["openalex", "semantic_scholar", "arxiv"], "year_from": 2022},
    {"tool": "search_web", "query": "FlashAttention complexity site:arxiv.org", "authority_min": 3}
  ],
  "verification": "strict"
}
```

- 用 JSON Output 或 `plan_research` 工具；
- 代码校验：query 数量 ≤ 8、每个 query 长度 ≤ 128、tool 在白名单；
- 不合法就修复/重试一次，仍失败则用确定性 fallback（原问题关键词查 OpenAlex + DeepSeek Search）。

### 4.2 并行检索

```text
search_web (DeepSeek)  ─┐
search_academic (OpenAlex / S2 / Crossref / arXiv / PubMed / DBLP) ─┼─→ 归一化 → 去重 → 排序
search_local_paper (PDF) ─┘
```

- 独立请求并发；
- 每个库单独超时（8–12s）；
- 某库失败不影响整体，结果里记录 `partial: true`；
- 最多 8 个 query、6 次 fetch、60s 总预算。

### 4.3 归一化与去重

优先级：

```text
DOI > arXiv ID > PMID > OpenAlex ID > 规范化标题 + 第一作者 + 年份
```

- 预印本 + 发表版 → 合并，保留发表版，标注“曾为预印本”；
- 新闻转述论文 → 合并到论文，新闻只作传播线索；
- 同一 DOI 的多条记录 → 合并，保留最全元数据。

### 4.4 排序

```text
score = 相关性
      + 来源层级（A1 > A2 > B > C）
      + 直接性（primary > review > news）
      + 时间新鲜度（latest 类问题权重更高）
      + venue/作者匹配
      + 引用百分位（仅 tiebreaker）
      - 撤稿/掠夺性/无元数据惩罚
```

不要用一个不可解释的加权总分直接决定“权威”；层级和硬过滤优先，分数只用于同层排序。

### 4.5 精读与证据抽取

- 全文：按章节切块，保留页码/段落；
- 摘要：只用于 triage，不用于强结论；
- 对每个 claim，检索 top 4–6 个候选段落；
- 让模型输出**精确 quote**，代码做字符串匹配；匹配不上就丢弃；
- 模型判断 `support / contradict / insufficient`，必须附 quote；
- 高重要性 claim 用第二个 judge（`deepseek-v4-pro`）复核分歧。

---

## 5. 交叉验证

### 5.1 先拆 claim

把回答拆成原子断言，而不是整段：

```text
"FlashAttention 通过 IO-aware 分块，把 attention 的显存从 O(n²) 降到 O(n)，但计算复杂度仍是 O(n²)。"
→ C1: FlashAttention 的显存是 O(n)
→ C2: FlashAttention 的计算复杂度仍是 O(n²)
→ C3: 它使用 IO-aware 分块
```

每个 claim 标注类型和重要性：

- `definition`：定义/概念，1 个 A2 即可；
- `empirical`：实验结论，至少 1 个 A1，严格模式 2 个独立；
- `numeric`：数字/比例，必须 primary source + 精确 quote；
- `causal`：因果/临床，系统综述/RCT/指南优先；
- `latest`：最新进展，官方/一手来源 + 日期；
- `opinion`：观点，标注“作者观点”，不强行验证。

### 5.2 找证据

对每个 claim：

1. 先看回答里已引用的来源，验证 quote；
2. 再检索 2–4 个独立来源；
3. 优先找**直接研究**，不是转述；
4. 找不到直接证据 → `insufficient`，不要用相关研究硬凑。

### 5.3 独立性检查

以下情况算**同一个信源**：

- 同一 DOI / arXiv ID / PMID；
- 预印本与它的发表版；
- 同一作者组、同一 institution、同一数据集；
- 新闻/博客转述同一篇论文；
- B 引用 A，且没有新增数据/分析。

**只有独立来源才计数。** 这是“交叉验证”与“多贴几个链接”的区别。

### 5.4 结论等级

| 等级 | 条件 | UI |
|---|---|---|
| **strong** | ≥2 个独立 A1/A2 支持，无可信反驳 | 绿色“强证据” |
| **moderate** | 1 个 A1/A2 + 1 个独立 B/C 支持，无反驳 | 蓝色“中等” |
| **single-source** | 只有 1 个独立来源 | 黄色“单一来源” |
| **contested** | 有可信来源反驳，证据量级相当 | 红色“存在争议” |
| **insufficient** | 没有直接 quote/研究 | 灰色“证据不足” |
| **retracted** | 支撑来源已撤稿 | 红色“已撤稿” |
| **outdated** | 对“最新”类问题，来源过旧 | 灰色“可能过时” |

**默认模式**：定义类 1 个 A2；经验/数字类 1 个 A1 + 1 个独立来源；  
**严格模式**：所有 empirical/numeric/causal claim 必须 2 个独立 A1/A2，且无撤稿、无冲突。

### 5.5 冲突、撤稿、预印本、时间

- **冲突**：不要平均，不要“多数投票”；列出双方研究类型、样本、年份、结论，给“暂未共识”。
- **撤稿**：OpenAlex `is_retracted`、Crossref `update-to`、PubMed publication type、出版社页面，至少查两个。
- **预印本**：标 `preprint`；检查是否已发表；预印本不能单独支撑 clinical/causal 结论。
- **时间**：用 `publishedAt`，不是 `fetchedAt`；对“最新”问题，明确“截至 2026-10-18”。
- **掠夺性期刊**：DOAJ 白名单 + ISSN + 出版社 + 编委；不确定就标“venue 未核实”，不升 A。

---

## 6. DeepSeek 集成

### 6.1 模型选择

按当前 DeepSeek API 文档（2026-10）：

| 模型 | 用途 | 备注 |
|---|---|---|
| `deepseek-flash` | 计划、query 生成、证据抽取、多数回答 | 1M context，工具调用，便宜 |
| `deepseek-v4-pro` | 严格模式的最终裁决、复杂综述、冲突分析 | 更强，成本更高 |

建议：**默认 flash，严格模式/高重要性 claim 用 pro 复核**。不要所有请求都上 pro。

### 6.2 工具循环

- 计划阶段：`thinking: disabled` + JSON Output / `plan_research`；
- 工具循环：`thinking: disabled` + `tool_choice: "auto"`，最多 4 轮；
- 综合阶段：`thinking: enabled` + `reasoning_effort: high`，不再调用工具（或只允许 `verify_claims`）；
- 工具参数：用 Zod/Pydantic 校验；不合法就把错误信息回给模型重试，最多 2 次；
- 工具结果：只回传归一化 JSON，不回传 HTML/整页；控制 token。

> 注意：DeepSeek 文档明确说 `tool_choice: "required"` 和指定工具在 thinking mode 下不支持（会 400）。所以工具循环用非 thinking 模式，或 thinking 模式只用 `auto`。

### 6.3 `strict` 模式

- 需要 `base_url="https://api.deepseek.com/beta"`；
- 所有 function 设 `strict: true`；
- 所有 object 的 properties 必须全部 `required`，`additionalProperties: false`；
- 支持 object/string/number/integer/boolean/array/enum/anyOf；
- 不支持 minLength/maxLength/minItems/maxItems 等。

建议对 `search_academic`、`verify_claims` 这类参数复杂的工具开 strict；如果 schema 报错，回退普通模式 + 代码校验。

### 6.4 上下文缓存

- 静态内容放前面：system、工具定义、当前论文全文/章节；
- 动态内容放后面：search 结果、fetch 内容、当前问题/锚点；
- 记录 `prompt_cache_hit_tokens`，在 UI 里显示“缓存命中”；
- 1M context 不等于要全塞：top 6 来源 × 2–4k tokens 足够；
- 论文全文可以放，但只放相关章节 + 摘要，其它用检索。

### 6.5 成本

按当前官方价（2026-10）：

- Search：$0.75 / 1,000 次成功请求；
- Fetch：$0.75 / 1,000 次；
- `deepseek-flash`：cache miss $0.15/M input（off-peak），output $0.6/M；
- `deepseek-v4-pro`：cache miss $0.66/M input，output $1.98/M。

一次带 6 次搜索、4 次抓取、30k input、2k output 的回答，通常**不到 $0.05**。严格模式会翻几倍，但仍然可控。给每次回答设预算上限（例如 $0.10），超出就降级为“快速模式”并提示。

### 6.6 失败处理

- 429/5xx：指数退避，最多 2 次；
- 空结果：换同义词/英文/去掉过窄 filter；
- Fetch 404/付费墙：改用摘要，标“仅摘要”；
- 工具 JSON 不合法：回传错误让模型修，仍失败则代码 fallback；
- 某学术库超时：`partial: true`，继续用其它库；
- 所有来源都不够：输出“证据不足”，给检索建议，不要编。

---

## 7. UI

### 7.1 节点上的研究标记

```text
┌────────────────────────────┐
│▌ FlashAttention 是 O(n) 吗？│
│  19:38 · 🔍 6 源 · 强证据   │
└────────────────────────────┘
```

- `🔍 6 源`：点击打开研究轨迹；
- `强证据 / 单一来源 / 争议`：颜色区分；
- 工具调用失败：灰色 `⚠ 检索不完整`。

### 7.2 阅读器

- 引用 chip：`[S1]`、`[P1 p.4]`，hover 显示标题/年份/venue/quote；
- 点击 chip → 右侧来源抽屉：摘要、DOI、OA 链接、页码、证据等级；
- 回答下方“证据表”：claim × source × stance × verdict；
- “研究轨迹”折叠面板：计划 → 查询 → 命中 → 精读 → 验证；
- “重新验证” → 生成新的回答变体，旧回答保留；
- “不要用这篇” → 排除来源并重跑；
- “仅学术 / 严格验证 / 最近一年”三个开关。

### 7.3 研究轨迹示例

```text
研究计划：3 个查询 · 严格模式
✓ OpenAlex        12 条 → 去重 7 篇
✓ Semantic Scholar 8 条 → 3 篇新增
✓ DeepSeek Search  6 条（authority ≥ 3）
精读：4 篇全文 + 2 篇摘要
验证：5 条 claim → 3 强 / 1 单一 / 1 争议
```

这个面板让用户知道“AI 到底查了什么”，也是调试上下文的最好入口。

---

## 8. 分期

| 阶段 | 范围 | 验收 |
|---|---|---|
| **M1（3–5 天）** | DeepSeek Search/Fetch、SourceCard、引用 chip、研究轨迹 UI | 回答里每个 URL/DOI 都来自工具；无编造引用 |
| **M2（约 1 周）** | OpenAlex / Crossref / Semantic Scholar / arXiv / PubMed 适配器、去重、排序、OA 全文 | 同一论文多库合并；A1/A2 识别准确 |
| **M3（约 1 周）** | claim 拆分、证据抽取、独立性、撤稿/预印本/时间检查、verdict | 20 条测试问题：引用准确率 ≥95%，无“假强证据” |
| **M4（可选）** | 引用链、系统综述识别、冲突对比 UI、证据表导出 | 能回答“这篇论文后来被推翻了吗” |

测试集建议：

- 10 条有明确共识的 claim；
- 5 条有争议的 claim；
- 5 条最新进展；
- 5 条常见误解（例如“FlashAttention 是 O(n)”）；
- 记录：引用准确率、证据等级分布、平均延迟、单次成本。

---

## 9. 风险

| 风险 | 对策 |
|---|---|
| DeepSeek `authority` 不透明 | 只作先验；最终看 DOI/venue/peer review |
| 学术 API 限流/缺字段 | 缓存、重试、多库 fallback；缺失字段显式标注 |
| 付费墙 | 只用 OA/摘要；不绕过；标“仅摘要” |
| 掠夺性期刊 | DOAJ/ISSN/出版社/编委检查；不确定降级 |
| 引用量偏差 | 只做 tiebreaker；按来源类型和直接性优先 |
| LLM judge 误判 | 精确 quote 匹配 + 两 judge + 人工可见证据 |
| 新闻稿重复 | 独立性分组；同一 DOI/作者/机构算一个 |
| Prompt injection | 抓取内容视为数据；分隔符；不执行页面指令 |
| 延迟 | 并行检索、超时、先展示来源再合成 |
| 成本 | 预算上限、缓存、top-N 精读、严格模式按需 |
| 链接失效 | 保存快照/hash；引用面板可回看 |
| 模型编造引用 | 只允许工具返回的 ID；解析并校验每个 `[S#]` |

---

## 10. 示例：FlashAttention 是不是 O(n)

用户问：

> “FlashAttention 真的把 attention 的复杂度降到 O(n) 了吗？”

**研究计划：**

- claim：`FlashAttention 把 attention 复杂度降到 O(n)`，类型 empirical，重要性 3；
- 检索：FlashAttention 原论文、Longformer 原论文、一篇 attention 综述；
- 模式：strict。

**证据：**

- S1 FlashAttention（A1）：摘要/正文说“exact attention”“IO-aware”，复杂度仍是 O(n²)，显存 O(n)；
- S2 Longformer（A1）：用滑窗 + 全局 token 把复杂度降到 O(n)；
- S3 综述（A1）：把 FlashAttention 归类为“exact, IO-aware”，不是线性注意力。

**结论：**

> 没有。FlashAttention 仍然是 O(n²) 计算，它优化的是显存和 IO，不是渐进复杂度；把复杂度降到 O(n) 的是 Longformer/BigBird/线性注意力等工作。

这就是交叉验证的价值：一个听起来很合理、甚至很多博客会重复的说法，被三篇原始论文直接纠正。

---

## 11. 参考

- [DeepSeek Search & Fetch](https://api-docs.deepseek.com/guides/search)
- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion)
- [OpenAlex API](https://docs.openalex.org/)
- [Semantic Scholar API](https://api.semanticscholar.org/)
- [Crossref REST API](https://api.crossref.org/)
- [arXiv API](https://info.arxiv.org/help/api/index.html)
- [PubMed E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [Unpaywall API](https://unpaywall.org/products/api)
- [DOAJ API](https://doaj.org/api/docs)
- [Bing Search API 停用公告](https://learn.microsoft.com/zh-cn/lifecycle/announcements/bing-search-api-retirement)

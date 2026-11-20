import { formatError, safeJson, truncate } from "./util.mjs";

export class DeepSeekError extends Error {
  constructor(message, status = 0, body = "") {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DeepSeekClient {
  constructor({ apiKey, baseUrl = "https://api.deepseek.com", model = "deepseek-flash", strongModel = "deepseek-v4-pro" }) {
    this.apiKey = apiKey || "";
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.strongModel = strongModel;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async request(path, body, { timeout = 60000, retries = 2 } = {}) {
    if (!this.apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY 未配置", 401);

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(this.baseUrl + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });
        const text = await res.text();
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          const err = new DeepSeekError(
            `DeepSeek API ${res.status}: ${truncate(text, 400)}`,
            res.status,
            text
          );
          if (retryable && attempt < retries) {
            lastError = err;
            await sleep(500 * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new DeepSeekError(`DeepSeek 返回了非 JSON 内容: ${truncate(text, 200)}`, res.status, text);
        }
      } catch (err) {
        if (err instanceof DeepSeekError) throw err;
        lastError = err;
        if (attempt < retries) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw new DeepSeekError(`DeepSeek 请求失败: ${formatError(err)}`, 0, "");
      }
    }
    throw lastError || new DeepSeekError("DeepSeek 请求失败");
  }

  async chat(messages, opts = {}) {
    const body = {
      model: opts.model || this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 4000,
      stream: false,
      thinking: { type: opts.thinking ? "enabled" : "disabled" },
    };
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
    if (opts.json) body.response_format = { type: "json_object" };
    if (opts.stop) body.stop = opts.stop;

    const data = await this.request("/chat/completions", body, { timeout: opts.timeout ?? 90000 });
    const message = data?.choices?.[0]?.message;
    if (!message) throw new DeepSeekError("DeepSeek 没有返回 message", 0, JSON.stringify(data).slice(0, 300));
    return { message, usage: data.usage || null, raw: data };
  }

  async chatJson(messages, opts = {}) {
    const first = await this.chat(messages, { ...opts, json: true, temperature: opts.temperature ?? 0.1 });
    let parsed = safeJson(first.message.content || "");
    if (parsed) return { ...first, data: parsed };

    // 一次修复重试：把模型自己的输出贴回去，要求只返回 JSON。
    const repair = [
      ...messages,
      { role: "assistant", content: first.message.content || "" },
      { role: "user", content: "你上一次的输出不是合法 JSON。请只返回合法 JSON，不要代码块、不要解释。" },
    ];
    const second = await this.chat(repair, { ...opts, json: true, temperature: 0 });
    parsed = safeJson(second.message.content || "");
    if (!parsed) throw new DeepSeekError("模型没有返回合法 JSON", 0, truncate(second.message.content, 300));
    return { ...second, data: parsed };
  }

  async search(query, { count = 6, needContent = false, oriQuestion = "", timeout = 30000 } = {}) {
    const body = { query: String(query).slice(0, 128), count, need_content: Boolean(needContent) };
    if (oriQuestion) body.ori_question = String(oriQuestion).slice(0, 128);
    const data = await this.request("/v1/tools/search", body, { timeout, retries: 1 });
    return Array.isArray(data?.results) ? data.results : [];
  }

  async fetchUrl(url, { timeout = 30000 } = {}) {
    const data = await this.request("/v1/tools/fetch", { url }, { timeout, retries: 1 });
    return {
      title: data?.title || "",
      content: data?.content || "",
    };
  }
}

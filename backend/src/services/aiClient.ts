import * as zaiSdk from "z-ai-web-dev-sdk";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { loadZAIConfig } from "../config/zaiConfig.js";
import { HttpError } from "../utils/errors.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIChatClient {
  chat(messages: ChatMessage[]): Promise<string>;
  chatWithPaper(
    userMessage: string,
    history: Array<{ role: string; content: string }>,
    paper: any
  ): Promise<{ content: string }>;
  translateParagraph(originalText: string): Promise<{ content: string }>;
}

const normalizeMessageContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const maybeText = (item as { text?: unknown; content?: unknown }).text;
          const maybeContent = (item as { text?: unknown; content?: unknown }).content;
          if (typeof maybeText === "string") {
            return maybeText;
          }
          if (typeof maybeContent === "string") {
            return maybeContent;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
};

const extractResponseText = (response: unknown): string => {
  if (!response) {
    return "";
  }

  if (typeof response === "string") {
    return response;
  }

  if (typeof response === "object") {
    const anyResponse = response as Record<string, unknown>;

    if (typeof anyResponse.output_text === "string") {
      return anyResponse.output_text;
    }

    if (typeof anyResponse.text === "string") {
      return anyResponse.text;
    }

    const choices = (anyResponse.choices ??
      (anyResponse.data as Record<string, unknown> | undefined)?.choices) as
      | Array<Record<string, unknown>>
      | undefined;

    if (Array.isArray(choices) && choices.length > 0) {
      const firstChoice = choices[0] ?? {};
      const message = firstChoice.message as Record<string, unknown> | undefined;
      const candidate = message?.content ?? firstChoice.text;
      const normalized = normalizeMessageContent(candidate);
      if (normalized) {
        return normalized;
      }
    }

    const output = anyResponse.output;
    if (Array.isArray(output) && output.length > 0) {
      const normalized = normalizeMessageContent(output);
      if (normalized) {
        return normalized;
      }
    }
  }

  return "";
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const getErrorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const directCode = (error as { code?: unknown }).code;
    if (typeof directCode === "string") {
      return directCode;
    }

    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
      const causeCode = (cause as { code?: unknown }).code;
      if (typeof causeCode === "string") {
        return causeCode;
      }
    }
  }

  return "";
};

const isRetryableError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  if (
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED"
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /fetch failed|timeout|timed out|network/i.test(message);
};

const withTimeout = async <T>(
  producer: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    producer()
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
};

export class ZAIClient implements AIChatClient {
  private readonly sdkModule: any;
  private config: ReturnType<typeof loadZAIConfig> | null = null;
  private client: any;

  constructor(clientInstance?: unknown) {
    this.sdkModule = zaiSdk as any;
    this.client = clientInstance ?? null;
  }

  private getConfig(): ReturnType<typeof loadZAIConfig> {
    if (!this.config) {
      this.config = loadZAIConfig();
    }

    return this.config;
  }

  private createClient(config: ReturnType<typeof loadZAIConfig>): any {
    const initConfig: Record<string, unknown> = {
      baseUrl: config.baseUrl,
      baseURL: config.baseUrl,
      apiKey: config.apiKey
    };

    if (config.chatId) {
      initConfig.chatId = config.chatId;
    }

    if (config.userId) {
      initConfig.userId = config.userId;
    }

    const factoryCandidates = [
      () => (typeof this.sdkModule.createClient === "function" ? this.sdkModule.createClient(initConfig) : null),
      () => (typeof this.sdkModule.ZAIClient === "function" ? new this.sdkModule.ZAIClient(initConfig) : null),
      () =>
        typeof this.sdkModule.default?.createClient === "function"
          ? this.sdkModule.default.createClient(initConfig)
          : null,
      () => (typeof this.sdkModule.default === "function" ? new this.sdkModule.default(initConfig) : null),
      () => (typeof this.sdkModule.createOpenAI === "function" ? this.sdkModule.createOpenAI(initConfig) : null),
      () => this.sdkModule
    ];

    for (const factory of factoryCandidates) {
      try {
        const created = factory();
        if (created) {
          return created;
        }
      } catch {
        // Ignore creation attempt errors and continue.
      }
    }

    return this.sdkModule;
  }

  private resolvePreferredSdkCall(): ((payload: Record<string, unknown>) => Promise<unknown>) | null {
    if (typeof this.client?.chat?.completions?.create === "function") {
      return async (payload) => this.client.chat.completions.create(payload);
    }

    if (typeof this.client?.chat?.create === "function") {
      return async (payload) => this.client.chat.create(payload);
    }

    if (typeof this.client?.chat === "function") {
      return async (payload) => this.client.chat(payload);
    }

    if (typeof this.client?.generate === "function") {
      return async (payload) => this.client.generate(payload);
    }

    if (typeof this.sdkModule?.chat?.completions?.create === "function") {
      return async (payload) => this.sdkModule.chat.completions.create(payload);
    }

    return null;
  }

  private async requestWithNodeHttp(
    payload: Record<string, unknown>,
    config: ReturnType<typeof loadZAIConfig>
  ): Promise<unknown> {
    // 自动修正 baseUrl，防止重复拼接 /chat/completions
    let cleanBaseUrl = config.baseUrl.replace(/\/$/, ''); // 去掉末尾斜杠
    if (cleanBaseUrl.endsWith('/chat/completions')) {
      cleanBaseUrl = cleanBaseUrl.substring(0, cleanBaseUrl.length - '/chat/completions'.length);
    }
    
    const endpoint = new URL(`${cleanBaseUrl}/chat/completions`);
    const requestBody = JSON.stringify(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "X-Z-AI-From": "Z",
      "Content-Length": String(Buffer.byteLength(requestBody))
    };

    if (config.chatId) {
      headers["X-Chat-Id"] = config.chatId;
    }

    if (config.userId) {
      headers["X-User-Id"] = config.userId;
    }

    if (config.token) {
      headers["X-Token"] = config.token;
    }

    return await new Promise<unknown>((resolve, reject) => {
      const requester = endpoint.protocol === "https:" ? httpsRequest : httpRequest;

      const req = requester(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port ? Number(endpoint.port) : undefined,
          method: "POST",
          path: `${endpoint.pathname}${endpoint.search}`,
          headers
        },
        (res) => {
          let responseText = "";

          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            responseText += chunk;
          });

          res.on("end", () => {
            const statusCode = Number(res.statusCode ?? 500);
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`API request failed with status ${statusCode}: ${responseText}`));
              return;
            }

            if (!responseText.trim()) {
              reject(new Error("AI 返回空响应。"));
              return;
            }

            try {
              resolve(JSON.parse(responseText) as unknown);
            } catch {
              resolve(responseText);
            }
          });
        }
      );

      req.setTimeout(config.requestTimeoutMs, () => {
        req.destroy(new Error(`AI 请求超时（${config.requestTimeoutMs}ms）`));
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  private async callWithRetries(
    runner: () => Promise<unknown>,
    config: ReturnType<typeof loadZAIConfig>,
    sourceLabel: string,
    maxAttempts?: number
  ): Promise<unknown> {
    const totalAttempts = maxAttempts ?? config.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        return await withTimeout(
          runner,
          config.requestTimeoutMs,
          `${sourceLabel} 调用超时（${config.requestTimeoutMs}ms）`
        );
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error);

        if (!retryable || attempt >= totalAttempts) {
          break;
        }

        const waitMs = config.retryDelayMs * attempt;
        console.warn(`[AI] ${sourceLabel} 第 ${attempt} 次失败，${waitMs}ms 后重试。`, error);
        await sleep(waitMs);
      }
    }

    throw lastError;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const config = this.getConfig();
    const startedAt = Date.now();

    if (!this.client) {
      this.client = this.createClient(config);
    }

    console.info(
      `[AI] Start model=${config.model} timeout=${config.requestTimeoutMs}ms retries=${config.maxRetries}`
    );

    const payload: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: 0.2
    };

    if (config.chatId) {
      payload.chatId = config.chatId;
    }

    if (config.userId) {
      payload.userId = config.userId;
    }

    const sdkCall = this.resolvePreferredSdkCall();

    let sdkError: unknown;
    if (sdkCall) {
      try {
        const sdkResponse = await this.callWithRetries(
          () => sdkCall(payload),
          config,
          "SDK",
          config.maxRetries + 1
        );
        const sdkContent = extractResponseText(sdkResponse);
        if (sdkContent) {
          console.info(`[AI] SDK success in ${Date.now() - startedAt}ms`);
          return sdkContent;
        }

        sdkError = new Error("SDK 返回为空，尝试 HTTP 兜底。");
      } catch (error) {
        console.warn("[AI] SDK failed, switch to HTTP fallback.", error);
        sdkError = error;
      }
    }

    let fallbackError: unknown;
    try {
      const fallbackResponse = await this.callWithRetries(
        () => this.requestWithNodeHttp(payload, config),
        config,
        "HTTP",
        1
      );

      const fallbackContent = extractResponseText(fallbackResponse);
      if (fallbackContent) {
        console.info(`[AI] HTTP fallback success in ${Date.now() - startedAt}ms`);
        return fallbackContent;
      }

      fallbackError = new Error("HTTP 兜底返回为空。请检查模型输出格式。");
    } catch (error) {
      fallbackError = error;
    }

    const finalError = fallbackError ?? sdkError;

    if (finalError instanceof Error) {
      const code = getErrorCode(finalError);
      if (
        code === "UND_ERR_HEADERS_TIMEOUT" ||
        /headers timeout|调用超时|请求超时|timed out|timeout/i.test(finalError.message)
      ) {
        throw new HttpError(
          504,
          `AI 服务响应超时，请稍后重试。可在 .z-ai-config 中调大 requestTimeoutMs（当前 ${config.requestTimeoutMs}ms）。`
        );
      }

      throw new HttpError(502, `AI 服务调用失败：${finalError.message}`);
    }

    throw new HttpError(502, "AI 服务调用失败，请检查 .z-ai-config 与网络连接。");
  }

  /**
   * 与论文对话（带上下文）
   */
  async chatWithPaper(
    userMessage: string,
    history: Array<{ role: string; content: string }>,
    paper: any
  ): Promise<{ content: string }> {
    // 构建论文上下文
    let paperContext = `论文：${paper.fileName}\n\n`;
    paperContext += "论文内容（按章节）：\n";

    for (const section of paper.sections) {
      paperContext += `\n## ${section.title}\n`;
      for (const para of section.paragraphs) {
        paperContext += `\n[段落ID: ${para.id}]\n${para.originalText}\n`;
      }
    }

    const systemPrompt = `【角色设定】
你是一位顶级的"AI 前沿论文拆解导师"。你的特长是将晦涩难懂、充满数学公式和学术黑话的 AI 顶会论文，转化为连非科班出身的读者都能听懂的"大白话"故事。你的讲解风格幽默犀利、一针见血，极其擅长使用生活中的比喻（如考试、下棋、花钱算账等）来降维打击复杂概念。

【核心任务】
当用户指示"进入第 X 部分"或"下一部分"时，你需要对该部分进行极其严格的逐段精读和拆解。

【铁律与执行规范（必须严格遵守）】

1. 绝对逐段，绝不合并：
   - 禁止将几段话总结成一大段。
   - 必须以论文的自然段落为单位，一段一段地讲解。哪怕是一句过渡句，也要单独拿出来点明它的作用。

2. 标准格式（每一段都必须长这样）：
   - 先引用论文原文的一整段话（用引用格式 > ）
  - 然后换行写"译文："，给出准确、完整、自然的中文译文，不要漏句。
  - 再换行写"讲解："。
  - 用接地气的大白话解释这段话。必须要回答几个问题：作者在这段想表达什么？为什么这么规定？有什么潜台词？如果可以，一定要用比喻（比如把模型比作学生，把验证器比作裁判，把算力比作预算）。

3. 抓住"灵魂"与"反直觉点"：
   - 不要做无情的翻译机器。
   - 如果某段话隐藏了一个"大坑"、一个"反直觉的惊人发现"（比如：越高级的搜索反而越差），必须用加粗、感叹号等方式重点强调，像说书人一样抖包袱。

4. 承上启下的章节总结：
   - 当一个完整的子章节（如 5.1, 5.2 等）结束时，必须用斜体字加括号的形式写一段简短总结，概括这部分的战果，并顺势引出下一部分的期待。
   - 格式示例：*（第 X 部分结束。至此，作者证明了 A，接下来将要抛出更炸裂的观点 B！进入第 Y 部分！）*

5. 语言风格：
   - 拒绝生硬的学术腔调。
   - 多用短句。
   - 允许使用适度的情绪化词汇（如："太天真了"、"大跌眼镜"、"极其精妙"、"一记响亮的耳光"、"这就有点扯了"）。

6. 图表处理：
   - 如果遇到图表描述，结合文字说明其核心含义，不需要纠结具体的坐标轴数值，重点讲"图表想证明什么结论"。

7. 段落引用标记：
   - 在讲解每一段时，必须在段落末尾加上 [引用段落:para-id] 的标记，让系统能自动展示该段的原文中英对照。

【交互流程】
- 用户说"进入第 X 部分"：你直接从该部分的第一段开始，按上述铁律逐段输出。
- 用户说"下一部分"：你无缝衔接上一讲结束的地方，继续往下逐段输出。
- 用户问具体问题：先直接回答问题，然后逐步讲解相关段落。

当前论文内容：
${paperContext}`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: String(msg.content),
      })),
      { role: "user", content: String(userMessage) },
    ];

    const content = await this.chat(messages);
    return { content };
  }

  /**
   * 翻译单个段落
   */
  async translateParagraph(originalText: string): Promise<{ content: string }> {
    const systemPrompt = `你是一个专业的翻译助手。请将以下英文内容翻译成中文，要求：
1. 准确传达原文含义
2. 语言流畅自然
3. 保持学术专业性
4. 只返回翻译结果，不要添加额外说明

原文：`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt + originalText },
    ];

    const content = await this.chat(messages);
    return { content };
  }
}

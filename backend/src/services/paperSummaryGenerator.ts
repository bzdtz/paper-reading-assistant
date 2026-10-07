import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/errors.js";
import { parseStrictJson } from "../utils/jsonParser.js";
import { type AIChatClient, ZAIClient } from "./aiClient.js";

/**
 * 结构化摘要生成器。
 *
 * 解析完成后再跑：章节已经入库存好了，这里只负责把它们读出来交给 LLM
 * 压缩成「摘要 / 核心观点 / 研究贡献」三块。
 *
 * 与解析主链路解耦是刻意的：解析成功但摘要失败，用户照样能看章节、翻译和讲解。
 * 失败只落到 summaryStatus / summaryError，不往外抛、不回滚解析结果。
 */

export interface PaperSummaryResult {
  summary: string;
  keyPoints: string[];
  contributions: string[];
}

interface SummaryAiPayload {
  summary?: unknown;
  keyPoints?: unknown;
  contributions?: unknown;
}

const MAX_CORPUS_CHARS = 24000;
const MAX_SUMMARY_CHARS = 1400;
const KEY_POINT_RANGE: [number, number] = [3, 7];
const CONTRIBUTION_RANGE: [number, number] = [1, 5];

const SUMMARY_SYSTEM_PROMPT = `你是学术论文解读助手。请通读下方论文内容，输出结构化导读。

要求：
1. summary：中文 Markdown，200-400 字。说清研究问题、方法、主要结论与意义。不要写成章节目录，也不要罗列公式。
2. keyPoints：3-7 条核心观点，每条 20-60 字。必须是论文实际论证过的内容，不要空话套话。
3. contributions：1-5 条研究贡献，每条点明"新在哪"（新方法、新数据集、新结果还是新视角）。
4. 不得编造原文没有的数据、指标、比较对象或结论。拿不准就宁可不写。
5. 只返回严格 JSON，不要输出任何额外文字。

返回格式：
{
  "summary": "中文 Markdown 摘要",
  "keyPoints": ["核心观点一", "核心观点二"],
  "contributions": ["研究贡献一", "研究贡献二"]
}`;

/** 段落里是图片/表格占位符时，喂给 LLM 只有噪音，跳过。 */
const isNonTextOnly = (text: string): boolean => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return true;
  }

  const imageCount = (trimmed.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  if (imageCount > 0 && trimmed.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim().length < 20) {
    return true;
  }

  return /^\s*<(table|img)/i.test(trimmed);
};

const buildCorpus = (sections: Array<{ title: string; paragraphs: Array<{ originalText: string }> }>): string => {
  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  for (const section of sections) {
    const body = section.paragraphs
      .map((paragraph) => String(paragraph.originalText || "").trim())
      .filter((text) => text.length > 0 && !isNonTextOnly(text))
      .join("\n\n");

    if (!body) {
      continue;
    }

    const block = `## ${section.title}\n\n${body}`;
    if (total + block.length > MAX_CORPUS_CHARS) {
      truncated = true;
      break;
    }

    parts.push(block);
    total += block.length;
  }

  if (!parts.length) {
    throw new HttpError(400, "论文没有可用于生成摘要的正文内容。");
  }

  const footer = truncated ? "\n\n（正文过长，以上为前文部分）" : "";
  return parts.join("\n\n") + footer;
};

const normalizeStringList = (value: unknown, range: [number, number], label: string): string[] => {
  let items: unknown[];

  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string" && value.trim()) {
    items = value.split(/\n|。/);
  } else {
    items = [];
  }

  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const text = String(item ?? "")
      .replace(/^[\s>*-]+/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    cleaned.push(text);
  }

  if (cleaned.length < range[0]) {
    throw new HttpError(502, `AI 返回的${label}少于 ${range[0]} 条，请重试。`);
  }

  return cleaned.slice(0, range[1]);
};

const persistSummary = async (paperId: string, result: PaperSummaryResult) => {
  await prisma.paper.update({
    where: { id: paperId },
    data: {
      summary: result.summary,
      keyPoints: JSON.stringify(result.keyPoints),
      contributions: JSON.stringify(result.contributions),
      summaryStatus: "done",
      summaryError: null
    }
  });
};

export class PaperSummaryGenerator {
  constructor(private readonly aiClient: AIChatClient = new ZAIClient()) {}

  async generate(paperId: string, force = false): Promise<PaperSummaryResult> {
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: {
            paragraphs: { orderBy: { order: "asc" } }
          }
        }
      }
    });

    if (!paper) {
      throw new HttpError(404, "论文不存在");
    }

    if (!force && paper.summaryStatus === "done" && paper.summary) {
      return this.toResult(paper.summary, paper.keyPoints, paper.contributions);
    }

    const corpus = buildCorpus(paper.sections);

    await prisma.paper.update({
      where: { id: paperId },
      data: { summaryStatus: "generating", summaryError: null }
    });

    const aiRaw = await this.aiClient.chat([
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: `请为以下论文生成结构化导读：\n\n${corpus}` }
    ]);

    const parsed = parseStrictJson<SummaryAiPayload>(aiRaw);
    const summary = String(parsed.summary ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SUMMARY_CHARS);

    if (!summary) {
      throw new HttpError(502, "AI 返回的摘要为空，请重试。");
    }

    const result: PaperSummaryResult = {
      summary,
      keyPoints: normalizeStringList(parsed.keyPoints, KEY_POINT_RANGE, "核心观点"),
      contributions: normalizeStringList(parsed.contributions, CONTRIBUTION_RANGE, "研究贡献")
    };

    await persistSummary(paperId, result);
    return result;
  }

  private toResult(summary: string | null, keyPoints: string | null, contributions: string | null): PaperSummaryResult {
    return {
      summary: String(summary ?? "").trim(),
      keyPoints: this.parseList(keyPoints),
      contributions: this.parseList(contributions)
    };
  }

  private parseList(raw: string | null): string[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

export const paperSummaryGenerator = new PaperSummaryGenerator();

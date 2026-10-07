import type { PaperSection } from "../types/paper.js";
import { HttpError } from "../utils/errors.js";
import { parseStrictJson } from "../utils/jsonParser.js";
import { type AIChatClient, ZAIClient } from "./aiClient.js";

interface AnalyzeResult {
  sections?: Array<Partial<PaperSection>>;
}

interface ExplainResult {
  explanation?: string;
}

const MIN_SECTIONS = 5;
const MAX_SECTIONS = 10;
const SINGLE_SHOT_CHAR_THRESHOLD = 16000;

const SYSTEM_PROMPT = `你是一名论文辅助器。请根据输入论文完成以下任务：
1. 分析论文整体结构（如摘要、引言、方法、实验、结果、结论等）。
2. 将论文拆分为 5-10 个有意义的逻辑章节。
3. 每个章节必须包含：title、content、explanation。
4. content 必须保留该章节对应的原始论文文本，不要改写成摘要。
5. explanation 必须是详细、易懂的中文 Markdown 讲解，解释关键术语、方法与章节意义。
6. 只返回 JSON，不要返回任何额外说明文字。

返回格式必须严格如下：
{
  "sections": [
    {
      "title": "章节标题",
      "content": "章节原文",
      "explanation": "中文讲解（Markdown）"
    }
  ]
}`;

const EXPLAIN_SYSTEM_PROMPT = `你是一名论文辅助器。你会收到某一章节的原文，请输出该章节的中文讲解。
要求：
1. 讲解使用中文 Markdown。
2. 解释本章节的核心观点、关键术语、方法与意义。
3. 可用小标题和要点列表，但避免空泛描述。
4. 只返回严格 JSON，不要额外文字。

返回格式：
{
  "explanation": "中文 Markdown 讲解"
}`;

const defaultTitles = ["摘要", "引言", "相关工作", "研究方法", "实验设置", "实验结果", "讨论", "结论"];

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const getTargetSectionCount = (contentLength: number): number => {
  if (contentLength <= 25000) {
    return 5;
  }
  if (contentLength <= 45000) {
    return 6;
  }
  if (contentLength <= 70000) {
    return 7;
  }
  return 8;
};

const splitByParagraph = (content: string): string[] => {
  return content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const splitBySentence = (content: string): string[] => {
  return content
    .split(/(?<=[。！？!?\.])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const splitLongUnit = (unit: string): string[] => {
  if (unit.length <= 3500) {
    return [unit];
  }

  const sentences = splitBySentence(unit);
  if (sentences.length <= 1) {
    const midpoint = Math.floor(unit.length / 2);
    return [unit.slice(0, midpoint).trim(), unit.slice(midpoint).trim()].filter(Boolean);
  }

  const parts: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if ((buffer + sentence).length > 3000 && buffer.length >= 1200) {
      parts.push(buffer.trim());
      buffer = sentence;
      continue;
    }
    buffer = `${buffer}${buffer ? " " : ""}${sentence}`;
  }

  if (buffer.trim()) {
    parts.push(buffer.trim());
  }

  return parts.length > 0 ? parts : [unit];
};

const buildLogicalChunks = (content: string, targetCount: number): string[] => {
  const baseUnits = splitByParagraph(content);
  const units = (baseUnits.length > 0 ? baseUnits : splitBySentence(content)).flatMap(splitLongUnit);

  const chunks: string[] = [];
  const targetChars = Math.ceil(content.length / targetCount);

  let current = "";
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }

    const next = `${current}\n\n${unit}`;
    const shouldSplit = next.length > targetChars && current.length >= Math.floor(targetChars * 0.6);

    if (shouldSplit) {
      chunks.push(current.trim());
      current = unit;
      continue;
    }

    current = next;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  while (chunks.length > targetCount) {
    const tail = chunks.pop() ?? "";
    const mergeIndex = Math.max(0, chunks.length - 1);
    chunks[mergeIndex] = `${chunks[mergeIndex]}\n\n${tail}`.trim();
  }

  while (chunks.length < targetCount) {
    let longestIndex = 0;
    for (let i = 1; i < chunks.length; i += 1) {
      if (chunks[i].length > chunks[longestIndex].length) {
        longestIndex = i;
      }
    }

    const longest = chunks[longestIndex] ?? "";
    const parts = splitLongUnit(longest);
    if (parts.length < 2) {
      break;
    }

    const first = parts.shift() ?? "";
    const second = parts.join("\n\n").trim();
    chunks.splice(longestIndex, 1, first.trim(), second);
  }

  return chunks.map((item) => item.trim()).filter(Boolean);
};

const pickTitle = (chunk: string, index: number): string => {
  const firstLine = chunk.split(/\n/).find((line) => line.trim())?.trim() ?? "";
  if (
    firstLine &&
    firstLine.length <= 28 &&
    /摘要|引言|方法|实验|结果|讨论|结论|绪论|背景|研究/i.test(firstLine)
  ) {
    return firstLine;
  }

  if (index < defaultTitles.length) {
    return defaultTitles[index];
  }

  return `章节 ${index + 1}`;
};

const normalizeChunkSections = (chunks: string[]): PaperSection[] => {
  return chunks.map((chunk, index) => ({
    title: pickTitle(chunk, index),
    content: chunk,
    explanation: ""
  }));
};

const normalizeSection = (item: Partial<PaperSection>, index: number): PaperSection => {
  const title = String(item.title ?? "").trim() || `章节 ${index + 1}`;
  const content = String(item.content ?? "").trim();
  const explanation = String(item.explanation ?? "").trim();

  if (!content) {
    throw new HttpError(502, `AI 返回的第 ${index + 1} 个章节缺少原文内容。`);
  }

  if (!explanation) {
    throw new HttpError(502, `AI 返回的第 ${index + 1} 个章节缺少中文讲解。`);
  }

  return {
    title,
    content,
    explanation
  };
};

export class PaperAnalyzer {
  private readonly aiClient: AIChatClient;

  constructor(aiClient?: AIChatClient) {
    this.aiClient = aiClient ?? new ZAIClient();
  }

  private async explainSection(section: PaperSection, index: number, total: number): Promise<PaperSection> {
    console.info(`[PaperAnalyzer] explain section ${index + 1}/${total}: ${section.title}`);

    const userPrompt = [
      `章节标题：${section.title}`,
      "请对以下章节原文生成中文讲解：",
      section.content
    ].join("\n\n");

    const aiRaw = await this.aiClient.chat([
      {
        role: "system",
        content: EXPLAIN_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: userPrompt
      }
    ]);

    const parsed = parseStrictJson<ExplainResult>(aiRaw);
    const explanation = String(parsed.explanation ?? "").trim();

    if (!explanation) {
      throw new HttpError(502, `AI 返回的第 ${index + 1} 个章节缺少中文讲解。`);
    }

    return {
      ...section,
      explanation
    };
  }

  private async analyzeByWholeDocument(content: string): Promise<PaperSection[]> {
    const prompt = ["请分析以下论文并按要求返回 JSON：", content].join("\n\n");

    const aiRaw = await this.aiClient.chat([
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: prompt
      }
    ]);

    const parsed = parseStrictJson<AnalyzeResult>(aiRaw);
    const rawSections = parsed.sections;

    if (!Array.isArray(rawSections)) {
      throw new HttpError(502, "AI 返回格式错误：缺少 sections 数组。");
    }

    const sections = rawSections.map((item, index) => normalizeSection(item, index));
    if (sections.length < MIN_SECTIONS || sections.length > MAX_SECTIONS) {
      throw new HttpError(502, "AI 返回章节数量不符合要求，请重新分析。");
    }

    return sections;
  }

  private async analyzeByChunks(content: string): Promise<PaperSection[]> {
    const targetCount = clamp(getTargetSectionCount(content.length), MIN_SECTIONS, MAX_SECTIONS);
    const chunkTexts = buildLogicalChunks(content, targetCount);
    const sections = normalizeChunkSections(chunkTexts);

    if (sections.length < MIN_SECTIONS || sections.length > MAX_SECTIONS) {
      throw new HttpError(502, "分段失败，请重新分析或缩短文本后重试。");
    }

    const explained: PaperSection[] = [];
    for (let i = 0; i < sections.length; i += 1) {
      const done = await this.explainSection(sections[i], i, sections.length);
      explained.push(done);
    }

    return explained;
  }

  async analyze(content: string): Promise<PaperSection[]> {
    const normalizedContent = content.trim();

    if (!normalizedContent) {
      throw new HttpError(400, "论文内容不能为空，请输入有效文本。");
    }

    if (normalizedContent.length < 120) {
      throw new HttpError(400, "论文内容过短，请提供更完整的论文文本。");
    }

    if (normalizedContent.length <= SINGLE_SHOT_CHAR_THRESHOLD) {
      console.info(`[PaperAnalyzer] single-shot mode chars=${normalizedContent.length}`);
      return await this.analyzeByWholeDocument(normalizedContent);
    }

    console.info(`[PaperAnalyzer] chunk mode chars=${normalizedContent.length}`);
    return await this.analyzeByChunks(normalizedContent);
  }
}

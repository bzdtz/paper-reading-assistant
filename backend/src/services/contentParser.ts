/**
 * 内容解析服务
 * 将 MinerU 返回的内容解析为章节-段落结构
 */
import { ZAIClient } from "./aiClient.js";

export interface ParsedSection {
  title: string;
  order: number;
  paragraphs: string[];
}

export interface ParsedPaper {
  sections: ParsedSection[];
}

const chatClient = new ZAIClient();

const looksLikeSectionHeading = (text: string): boolean => {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return false;
  }

  return (
    /^\d+(\.\d+)*[.)\s]/.test(normalized) ||
    /^[IVXLC]+\.\s+/i.test(normalized) ||
    /^第[一二三四五六七八九十百千]+[章节部分篇]/.test(normalized) ||
    (/^[A-Z][A-Z\s-]{3,}$/.test(normalized) && normalized.length <= 120)
  );
};

/**
 * 使用 AI 智能重组章节结构
 * 当正则无法正确识别标题时，调用 AI 分析文本结构
 */
export async function restructureWithAI(rawText: string): Promise<ParsedPaper> {
  const systemPrompt = `你是一个论文结构分析专家。
请将以下论文内容重组为章节结构。
请识别出所有章节标题，并将随后的段落归类到该章节下。

输出格式要求为 JSON：
{
  "sections": [
    {
      "title": "章节标题",
      "paragraphs": ["段落1", "段落2"]
    }
  ]
}

注意：
1. 保持段落原文完整，不要修改内容。
2. 准确识别标题和正文的区别。
3. 如果没有明显标题，请按语义逻辑分段。
4. 必须返回合法的 JSON。`;

  try {
    const response = await chatClient.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: rawText }
    ]);

    // 尝试提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*"sections"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sections: parsed.sections.map((s: any, i: number) => ({
          title: s.title || `未命名章节 ${i + 1}`,
          order: i + 1,
          paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs : [s.paragraphs]
        }))
      };
    }
  } catch (error) {
    console.error("AI 重组章节失败，使用默认解析:", error);
  }

  // 如果 AI 失败，回退到正则解析
  return parseMarkdownContent(rawText);
}

/**
 * 解析 MinerU 返回的 JSON 结构 (content_list)
 * 优先使用此方法，因为它能准确区分标题、正文、图表等
 */
export function parseMineruJson(contentList: any[]): ParsedPaper {
  if (!Array.isArray(contentList) || contentList.length === 0) {
    return { sections: [] };
  }

  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let order = 0;

  for (const block of contentList) {
    // MinerU block 通常包含 type/category/sub_type 和 text
    const category = String(block.type || block.category || block.sub_type || '').toLowerCase();
    const text = String(block.text || block.polygon_text || '').trim();
    const textLevel = Number(block.text_level ?? 0);

    if (!text) continue;

    // 识别章节标题块
    if (category === 'text' && textLevel === 1 && looksLikeSectionHeading(text)) {
      // 保存上一章节
      if (currentSection) {
        sections.push(currentSection);
      }

      // 创建新章节
      order++;
      currentSection = {
        title: text,
        order,
        paragraphs: []
      };
    } else if (currentSection) {
      // 将正文/图表等归类到当前章节
      currentSection.paragraphs.push(text);
    } else {
      // 如果还没遇到标题，创建默认章节
      order++;
      currentSection = {
        title: '前言/摘要',
        order,
        paragraphs: [text.trim()]
      };
    }
  }

  // 保存最后一个章节
  if (currentSection) {
    sections.push(currentSection);
  }

  return { sections };
}

/**
 * 解析 MinerU 返回的 Markdown 内容
 * 按标题分割章节，每个章节下包含若干段落
 */
export function parseMarkdownContent(markdown: string): ParsedPaper {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let currentParagraphs: string[] = [];
  let order = 0;

  const flushCurrentParagraphs = () => {
    if (currentParagraphs.length > 0) {
      const validParagraphs = currentParagraphs.filter(p => p.trim().length > 0);
      if (validParagraphs.length > 0 && currentSection) {
        currentSection.paragraphs = validParagraphs;
        sections.push(currentSection);
      }
    }
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 修复：只识别一级 (#) 和二级 (##) 标题为章节，避免产生 64 个章节
    const headingMatch = trimmedLine.match(/^(#{1,2})\s+(.+)$/);

    if (headingMatch) {
      flushCurrentParagraphs();
      order++;
      currentSection = {
        title: headingMatch[2].trim(),
        order,
        paragraphs: []
      };
      currentParagraphs = [];
    } else {
      if (trimmedLine) {
        currentParagraphs.push(trimmedLine);
      }
    }
  }

  flushCurrentParagraphs();

  if (sections.length === 0 && markdown.trim().length > 0) {
    const paragraphs = markdown
      .split(/\n\s*\n/)
      .filter(p => p.trim().length > 0);

    if (paragraphs.length > 0) {
      sections.push({
        title: '全文',
        order: 1,
        paragraphs
      });
    }
  }

  return { sections };
}

/**
 * 按更细粒度分割段落（例如按句子）
 * 用于实现"逐段"讲解
 */
export function splitParagraphIntoSegments(paragraph: string): string[] {
  // 简单实现：按句号、问号、感叹号分割
  // 但保持一定的上下文连贯性
  
  // 如果段落较短（少于3句），直接返回整段
  const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]+/g);
  if (!sentences || sentences.length <= 3) {
    return [paragraph.trim()];
  }

  // 否则按3-4句一组分割
  const segments: string[] = [];
  const chunkSize = 3;
  
  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunk = sentences.slice(i, i + chunkSize).join(' ').trim();
    if (chunk.length > 0) {
      segments.push(chunk);
    }
  }

  return segments.length > 0 ? segments : [paragraph.trim()];
}

/**
 * 将解析后的内容转换为可存储的结构
 */
export function flattenParsedContent(parsed: ParsedPaper): {
  sections: { title: string; order: number }[];
  paragraphs: { sectionOrder: number; text: string; order: number }[];
} {
  const sections: { title: string; order: number }[] = [];
  const paragraphs: { sectionOrder: number; text: string; order: number }[] = [];

  for (const section of parsed.sections) {
    sections.push({
      title: section.title,
      order: section.order
    });

    let paragraphOrder = 0;
    for (const paragraph of section.paragraphs) {
      // 进一步分割段落为更小的单元
      const segments = splitParagraphIntoSegments(paragraph);
      for (const segment of segments) {
        paragraphOrder++;
        paragraphs.push({
          sectionOrder: section.order,
          text: segment,
          order: paragraphOrder
        });
      }
    }
  }

  return { sections, paragraphs };
}

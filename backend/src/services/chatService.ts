import { PrismaClient } from "@prisma/client";
import { ZAIClient } from "./aiClient.js";

const prisma = new PrismaClient();
const chatClient = new ZAIClient();

const extractFigureRefs = (content: string): number[] => {
  const refs = new Set<number>();
  const text = String(content || '');
  const regex = /(fig(?:ure)?\.?|图)\s*([0-9]{1,3})/ig;

  for (const match of text.matchAll(regex)) {
    const number = Number(match[2]);
    if (Number.isFinite(number) && number > 0) {
      refs.add(number);
    }
  }

  return Array.from(refs);
};

const extractReferencedParagraphIds = (
  content: string,
  validParagraphIdSet: Set<string>,
  paper: any
): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();

  const pushIfValid = (rawId: string) => {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id) || !validParagraphIdSet.has(id)) {
      return;
    }
    seen.add(id);
    output.push(id);
  };

  const text = String(content || '');

  for (const match of text.matchAll(/\[\s*引用段落\s*[:：]\s*([^\]\s]+)\s*\]/gi)) {
    pushIfValid(match[1] || '');
  }

  for (const match of text.matchAll(/段落ID\s*[:：]\s*([a-zA-Z0-9-]{6,})/gi)) {
    pushIfValid(match[1] || '');
  }

  if (output.length > 0) {
    return output;
  }

  // 模型偶发不输出引用标记时，按“引用原文片段”进行兜底匹配。
  const normalizedContent = text.replace(/\s+/g, ' ').trim();
  if (!normalizedContent) {
    return output;
  }

  for (const section of paper.sections || []) {
    for (const paragraph of section.paragraphs || []) {
      const normalizedParagraph = String(paragraph.originalText || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalizedParagraph.length < 24) {
        continue;
      }

      const snippet = normalizedParagraph.slice(0, 80);
      if (normalizedContent.includes(snippet)) {
        pushIfValid(paragraph.id);
      }

      if (output.length >= 5) {
        return output;
      }
    }
  }

  return output;
};

const collectPaperFigures = (paper: any) => {
  const figures: Array<{
    key: string;
    caption: string;
    figureNo: number | null;
    url: string;
    paragraphId: string;
  }> = [];

  for (const section of paper.sections || []) {
    for (const paragraph of section.paragraphs || []) {
      const content = String(paragraph.originalText || paragraph.text || '');
      const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
      let match;

      while ((match = imageRegex.exec(content)) !== null) {
        const caption = String(match[1] || '').trim();
        const url = String(match[2] || '').trim();
        if (!url) {
          continue;
        }

        const figureNoMatch = caption.match(/(?:fig(?:ure)?\.?|图)\s*([0-9]{1,3})/i);
        figures.push({
          key: `${paragraph.id}-${match.index}`,
          caption,
          figureNo: figureNoMatch ? Number(figureNoMatch[1]) : null,
          url,
          paragraphId: paragraph.id,
        });
      }
    }
  }

  return figures;
};

/**
 * 创建新的对话会话
 */
export async function createChatSession(paperId: string) {
  const session = await prisma.chatSession.create({
    data: {
      paperId,
    },
  });

  return session;
}

/**
 * 获取会话的所有消息
 */
export async function getSessionMessages(sessionId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    include: {
      paragraphs: {
        include: {
          paragraph: {
            include: {
              section: true,
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return messages;
}

/**
 * 发送消息并获取 AI 回答
 */
export async function sendChatMessage(
  sessionId: string,
  userMessage: string
) {
  // 1. 保存用户消息
  const userMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "user",
      content: userMessage,
    },
  });

  // 2. 获取论文信息用于构建上下文
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        include: {
          paragraphs: {
            include: {
              paragraph: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    throw new Error("会话不存在");
  }

  // 3. 获取论文的所有段落（用于 AI 参考）
  const paper = await prisma.paper.findUnique({
    where: { id: session.paperId },
    include: {
      sections: {
        include: {
          paragraphs: {
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!paper) {
    throw new Error("论文不存在");
  }

  const validParagraphIdSet = new Set(
    paper.sections.flatMap((section) => section.paragraphs.map((paragraph) => paragraph.id))
  );

  // 4. 构建对话历史
  const conversationHistory = session.messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  // 5. 调用 AI 获取回答
  const aiResponse = await chatClient.chatWithPaper(
    userMessage,
    conversationHistory,
    paper
  );

  // 6. 解析 AI 回答中的段落引用
  let cleanContent = aiResponse.content;
  const figureRefs = extractFigureRefs(aiResponse.content);

  const referencedParagraphIds = extractReferencedParagraphIds(
    aiResponse.content,
    validParagraphIdSet,
    paper
  );

  // 清理回答中的引用标记（前端会展示卡片，不需要保留标记文本）
  cleanContent = aiResponse.content
    .replace(/\[\s*引用段落\s*[:：]\s*[^\]]+\]/gi, "")
    .trim();

  // 7. 保存 AI 回答
  const assistantMsg = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: cleanContent,
    },
  });

  // 8. 创建消息-段落关联
  if (referencedParagraphIds.length > 0) {
    await prisma.messageParagraphRef.createMany({
      data: referencedParagraphIds.map((paraId, index) => ({
        messageId: assistantMsg.id,
        paragraphId: paraId,
        order: index,
      })),
    });
  }

  // 9. 返回完整的消息（包含关联的段落）
  const fullMessage = await prisma.chatMessage.findUnique({
    where: { id: assistantMsg.id },
    include: {
      paragraphs: {
        include: {
          paragraph: {
            include: {
              section: true,
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  const paperFigures = collectPaperFigures(paper);
  const figures = (() => {
    if (!paperFigures.length || !figureRefs.length) {
      return paperFigures.slice(0, 3);
    }

    const output: typeof paperFigures = [];
    const seen = new Set<string>();
    const pushUnique = (item: (typeof paperFigures)[number]) => {
      if (seen.has(item.key)) {
        return;
      }
      seen.add(item.key);
      output.push(item);
    };

    for (const ref of figureRefs) {
      const exact = paperFigures.find((item) => item.figureNo === ref);
      if (exact) {
        pushUnique(exact);
        continue;
      }

      const fallback = paperFigures[ref - 1];
      if (fallback) {
        pushUnique(fallback);
      }
    }

    return output.length > 0 ? output : paperFigures.slice(0, 3);
  })();

  return {
    ...fullMessage,
    figureRefs,
    figures,
  };
}

/**
 * 批量翻译论文的所有段落
 */
export async function translateAllParagraphs(paperId: string) {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      sections: {
        include: {
          paragraphs: {
            where: {
              translation: null, // 只翻译还没有翻译的段落
            },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!paper) {
    throw new Error("论文不存在");
  }

  let translatedCount = 0;

  for (const section of paper.sections) {
    for (const paragraph of section.paragraphs) {
      try {
        const translation = await chatClient.translateParagraph(
          paragraph.originalText
        );

        await prisma.paragraph.update({
          where: { id: paragraph.id },
          data: { translation: translation.content },
        });

        translatedCount++;
      } catch (error) {
        console.error(`翻译段落 ${paragraph.id} 失败:`, error);
      }
    }
  }

  return {
    total: paper.sections.reduce(
      (sum, s) => sum + s.paragraphs.length,
      0
    ),
    translated: translatedCount,
  };
}

/**
 * 翻译单个段落
 */
export async function translateSingleParagraph(paragraphId: string) {
  const paragraph = await prisma.paragraph.findUnique({
    where: { id: paragraphId },
  });

  if (!paragraph) {
    throw new Error("段落不存在");
  }

  // 如果已经有翻译，直接返回
  if (paragraph.translation) {
    return {
      paragraphId: paragraph.id,
      translation: paragraph.translation,
    };
  }

  // 调用 AI 翻译
  const translation = await chatClient.translateParagraph(
    paragraph.originalText
  );

  // 保存到数据库
  await prisma.paragraph.update({
    where: { id: paragraphId },
    data: { translation: translation.content },
  });

  return {
    paragraphId: paragraph.id,
    translation: translation.content,
  };
}

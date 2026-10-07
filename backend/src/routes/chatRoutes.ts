import { Router } from "express";
import {
  createChatSession,
  getSessionMessages,
  sendChatMessage,
  translateAllParagraphs,
  translateSingleParagraph,
} from "../services/chatService.js";

export const chatRouter = Router();

/**
 * POST /api/v2/papers/:paperId/chat/sessions
 * 创建新的对话会话
 */
chatRouter.post("/papers/:paperId/chat/sessions", async (req, res, next) => {
  try {
    const { paperId } = req.params;
    const session = await createChatSession(paperId);
    res.status(201).json({
      message: "会话创建成功",
      sessionId: session.id,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v2/papers/:paperId/chat/sessions/:sessionId/messages
 * 获取会话的所有消息
 */
chatRouter.get(
  "/papers/:paperId/chat/sessions/:sessionId/messages",
  async (req, res, next) => {
    try {
      const { paperId, sessionId } = req.params;
      const messages = await getSessionMessages(sessionId);
      res.json({ messages });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v2/papers/:paperId/chat/sessions/:sessionId/messages
 * 发送消息并获取 AI 回答
 */
chatRouter.post(
  "/papers/:paperId/chat/sessions/:sessionId/messages",
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        res.status(400).json({ message: "消息内容不能为空" });
        return;
      }

      const assistantMessage = await sendChatMessage(sessionId, message);

      console.log('[chatRoutes] Assistant message:', assistantMessage);

      res.json({
        message: {
          id: assistantMessage?.id || '',
          content: String(assistantMessage?.content || ''),
          role: assistantMessage?.role || 'assistant',
          createdAt: assistantMessage?.createdAt || new Date()
        },
        paragraphs: (assistantMessage?.paragraphs || []).map((p) => ({
          id: p.id,
          order: p.order,
          paragraph: p.paragraph
        })),
        figureRefs: assistantMessage?.figureRefs || [],
        figures: assistantMessage?.figures || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v2/papers/:paperId/translate-all
 * 批量翻译所有段落
 */
chatRouter.post(
  "/papers/:paperId/translate-all",
  async (req, res, next) => {
    try {
      const { paperId } = req.params;
      const result = await translateAllParagraphs(paperId);
      res.json({
        message: "翻译完成",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v2/papers/paragraphs/:paragraphId/translate
 * 翻译单个段落
 */
chatRouter.post(
  "/papers/paragraphs/:paragraphId/translate",
  async (req, res, next) => {
    try {
      const { paragraphId } = req.params;
      const result = await translateSingleParagraph(paragraphId);
      res.json({
        message: "翻译完成",
        translation: result.translation,
        paragraphId: result.paragraphId,
      });
    } catch (error) {
      next(error);
    }
  }
);

import axios from 'axios';

const API_BASE = process.env.VUE_APP_API_BASE_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_BASE}/api/v2`,
  timeout: 120000, // 120秒超时
});

/**
 * 创建对话会话
 */
export async function createChatSession(paperId) {
  const response = await api.post(`/papers/${paperId}/chat/sessions`);
  return response.data;
}

/**
 * 获取会话的所有消息
 */
export async function getSessionMessages(paperId, sessionId) {
  const response = await api.get(`/papers/${paperId}/chat/sessions/${sessionId}/messages`);
  return response.data;
}

/**
 * 发送消息
 */
export async function sendMessage(paperId, sessionId, message) {
  const response = await api.post(
    `/papers/${paperId}/chat/sessions/${sessionId}/messages`,
    { message }
  );
  return response.data;
}

/**
 * 批量翻译所有段落
 */
export async function translateAllParagraphs(paperId) {
  const response = await api.post(`/papers/${paperId}/translate-all`);
  return response.data;
}

/**
 * 翻译单个段落
 */
export async function translateSingleParagraph(paragraphId) {
  const response = await api.post(`/papers/paragraphs/${paragraphId}/translate`);
  return response.data;
}

/**
 * 讲解单个段落
 */
export async function explainSingleParagraph(paragraphId) {
  const response = await api.post(`/papers/paragraphs/${paragraphId}/explain`);
  return response.data;
}

/**
 * 获取论文详情（复用现有 API）
 * 添加时间戳参数防止浏览器缓存，确保能获取最新的解析状态
 */
export async function getPaperDetail(paperId) {
  const response = await api.get(`/papers/${paperId}?t=${Date.now()}`);
  return response.data;
}

/**
 * 获取论文本地非文字内容（图片等）
 */
export async function getPaperNonTextItems(paperId) {
  const response = await api.get(`/papers/${paperId}/non-text-items?t=${Date.now()}`);
  return response.data;
}

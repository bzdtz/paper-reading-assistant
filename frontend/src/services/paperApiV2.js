/**
 * 新版 API 服务（v2）- 支持 MinerU 解析、翻译、讲解、追问
 */
import axios from "axios";

const http = axios.create({
  baseURL: process.env.VUE_APP_API_BASE_URL || "http://localhost:3000",
  timeout: 300000 // 5分钟超时
});

/**
 * 上传论文
 */
export const uploadPaperV2 = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await http.post("/api/v2/papers/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data"
    },
    onUploadProgress: (event) => {
      if (typeof onProgress !== "function") {
        return;
      }
      const loaded = Number(event?.loaded || 0);
      const total = Number(event?.total || 0);
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
      onProgress({ loaded, total: total || null, percent });
    }
  });

  return response.data;
};

/**
 * 获取论文详情
 */
export const getPaperDetail = async (paperId) => {
  const response = await http.get(`/api/v2/papers/${paperId}`);
  return response.data;
};

/**
 * 获取论文本地非文字内容（图片等）
 */
export const getPaperNonTextItems = async (paperId) => {
  const response = await http.get(`/api/v2/papers/${paperId}/non-text-items?t=${Date.now()}`);
  return response.data;
};

/**
 * 翻译段落
 */
export const translateParagraph = async (paragraphId) => {
  const response = await http.post(`/api/v2/papers/paragraphs/${paragraphId}/translate`);
  return response.data;
};

/**
 * 讲解段落
 */
export const explainParagraph = async (paragraphId) => {
  const response = await http.post(`/api/v2/papers/paragraphs/${paragraphId}/explain`);
  return response.data;
};

/**
 * 追问
 */
export const submitFollowUp = async (parentId, parentType, question) => {
  const response = await http.post("/api/v2/papers/follow-up", {
    parentId,
    parentType,
    question
  });
  return response.data;
};

/**
 * 获取追问记录
 */
export const getFollowUps = async (parentId) => {
  const response = await http.get(`/api/v2/papers/follow-up/${parentId}`);
  return response.data;
};

/**
 * 开始论文对话讲解会话
 */
export const startStudySession = async (paperId) => {
  const response = await http.post(`/api/v2/papers/${paperId}/study-session/start`);
  return response.data;
};

/**
 * 会话内发送消息
 */
export const sendStudyMessage = async (sessionId, message) => {
  const response = await http.post(`/api/v2/papers/study-session/${sessionId}/message`, {
    message
  });
  return response.data;
};

/**
 * 解析 API 错误
 */
export const parseApiError = (error) => {
  if (error?.response?.data?.message) {
    return error.response.data.message;
  }
  if (error?.message) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
};

export default http;

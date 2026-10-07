import axios from 'axios';

const API_BASE = process.env.VUE_APP_API_BASE_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_BASE}/api/v2/papers`,
  timeout: 120000
});

export const getAISettings = async () => {
  const response = await api.get('/settings/ai');
  return response.data;
};

export const saveAISettings = async (payload) => {
  const response = await api.put('/settings/ai', payload);
  return response.data;
};

export const testChatAI = async () => {
  const response = await api.post('/settings/ai/test-chat');
  return response.data;
};

export const testNonTextOrderAI = async () => {
  const response = await api.get('/non-text-order-ai/test');
  return response.data;
};

export const testMineruAPI = async () => {
  const response = await api.post('/settings/mineru/test');
  return response.data;
};

export const getPaperArtifactStatus = async (paperId) => {
  const response = await api.get(`/${paperId}/artifact-status`);
  return response.data;
};

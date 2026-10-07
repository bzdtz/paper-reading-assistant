import axios from "axios";

const http = axios.create({
  baseURL: process.env.VUE_APP_API_BASE_URL || "http://localhost:3000",
  timeout: 240000
});

export const analyzePaper = async (content) => {
  const response = await http.post("/api/analyze-paper", { content });
  return response.data;
};

export const uploadPaper = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await http.post("/api/upload-paper", formData, {
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

export const parseApiError = (error) => {
  if (error?.response?.data?.message) {
    return error.response.data.message;
  }

  if (error?.message) {
    return error.message;
  }

  return "请求失败，请稍后重试。";
};

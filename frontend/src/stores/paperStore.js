import { defineStore } from "pinia";

import { analyzePaper, parseApiError, uploadPaper } from "../services/paperApi";

const normalizeSections = (sections) => {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((item, index) => ({
      title: String(item?.title || `章节 ${index + 1}`),
      content: String(item?.content || ""),
      explanation: String(item?.explanation || "")
    }))
    .filter((item) => item.content && item.explanation);
};

export const usePaperStore = defineStore("paper", {
  state: () => ({
    sections: [],
    activeSection: 0,
    isLoading: false,
    errorMessage: "",
    fileName: "",
    extractedChars: 0,
    lastInputType: "",
    lastText: "",
    lastFile: null
  }),
  getters: {
    hasResult: (state) => state.sections.length > 0,
    currentSection: (state) => state.sections[state.activeSection] || null
  },
  actions: {
    setActiveSection(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.sections.length) {
        return;
      }
      this.activeSection = index;
    },
    clearError() {
      this.errorMessage = "";
    },
    clearResult() {
      this.sections = [];
      this.activeSection = 0;
      this.fileName = "";
      this.extractedChars = 0;
      this.errorMessage = "";
    },
    async analyzeByText(content) {
      this.isLoading = true;
      this.errorMessage = "";

      try {
        const payload = await analyzePaper(content);
        this.sections = normalizeSections(payload.sections);
        this.activeSection = 0;
        this.fileName = "";
        this.extractedChars = content.length;
        this.lastInputType = "text";
        this.lastText = content;
        this.lastFile = null;

        if (!this.sections.length) {
          throw new Error("分析结果为空，请重试。");
        }

        return this.sections;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw new Error(this.errorMessage);
      } finally {
        this.isLoading = false;
      }
    },
    async analyzeByFile(file, options = {}) {
      this.isLoading = true;
      this.errorMessage = "";

      try {
        const payload = await uploadPaper(file, options.onUploadProgress);
        this.sections = normalizeSections(payload.sections);
        this.activeSection = 0;
        this.fileName = String(payload.fileName || file.name || "未命名文件");
        this.extractedChars = Number(payload.extractedChars || 0);
        this.lastInputType = "file";
        this.lastText = "";
        this.lastFile = file;

        if (!this.sections.length) {
          throw new Error("分析结果为空，请重试。");
        }

        return this.sections;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw new Error(this.errorMessage);
      } finally {
        this.isLoading = false;
      }
    },
    async reAnalyze() {
      if (this.lastInputType === "text" && this.lastText.trim()) {
        return this.analyzeByText(this.lastText);
      }

      if (this.lastInputType === "file" && this.lastFile) {
        return this.analyzeByFile(this.lastFile);
      }

      throw new Error("没有可重新分析的输入，请返回输入页提交内容。");
    }
  }
});

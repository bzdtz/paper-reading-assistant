/**
 * 论文讲解 Store（v2）
 * 管理论文查看、翻译、讲解、追问的状态
 */
import { defineStore } from "pinia";
import {
  getPaperDetail,
  translateParagraph,
  explainParagraph,
  submitFollowUp,
  getFollowUps,
  parseApiError
} from "../services/paperApiV2";

export const usePaperDetailStore = defineStore("paperDetail", {
  state: () => ({
    // 论文信息
    paperId: null,
    paper: null,
    sections: [], // [{ id, title, order, paragraphs: [{ id, text, order }] }]
    
    // UI 状态
    loading: {
      paper: false,       // 加载论文
      translating: new Set(),  // 正在翻译的段落 ID
      explaining: new Set(),   // 正在讲解的段落 ID
      followUp: new Set()      // 正在追问的段落 ID
    },
    
    // 当前选中的段落
    activeParagraphId: null,
    
    // 显示模式：'translation' | 'explanation'
    displayMode: 'explanation',
    
    // 展开的章节 ID
    expandedSections: new Set(),
    
    // 错误信息
    errorMessage: ""
  }),
  
  getters: {
    // 获取翻译缓存
    getTranslation: (state) => (paragraphId) => {
      const section = state.sections.find(s => 
        s.paragraphs.some(p => p.id === paragraphId)
      );
      if (!section) return null;
      const paragraph = section.paragraphs.find(p => p.id === paragraphId);
      return paragraph?.translations?.[0] || null;
    },
    
    // 获取讲解缓存
    getExplanation: (state) => (paragraphId) => {
      const section = state.sections.find(s => 
        s.paragraphs.some(p => p.id === paragraphId)
      );
      if (!section) return null;
      const paragraph = section.paragraphs.find(p => p.id === paragraphId);
      return paragraph?.explanations?.[0] || null;
    }
  },
  
  actions: {
    /**
     * 加载论文详情
     */
    async loadPaper(paperId) {
      this.loading.paper = true;
      this.errorMessage = "";
      
      try {
        const response = await getPaperDetail(paperId);
        this.paperId = paperId;
        this.paper = response.paper;
        
        // 转换为前端使用的结构
        this.sections = (response.paper.sections || []).map(section => ({
          id: section.id,
          title: section.title,
          order: section.order,
          expanded: false,
          paragraphs: (section.paragraphs || []).map(p => ({
            id: p.id,
            text: p.originalText,
            order: p.order,
            translations: p.translations || [],
            explanations: p.explanations || []
          }))
        }));
        
        return response;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw error;
      } finally {
        this.loading.paper = false;
      }
    },
    
    /**
     * 翻译段落
     */
    async translateParagraph(paragraphId) {
      if (this.loading.translating.has(paragraphId)) {
        return; // 已在翻译中
      }
      
      this.loading.translating.add(paragraphId);
      
      try {
        const response = await translateParagraph(paragraphId);
        
        // 更新本地缓存
        this._updateParagraphCache(paragraphId, {
          translations: [response.translation]
        });
        
        return response.translation;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw error;
      } finally {
        this.loading.translating.delete(paragraphId);
      }
    },
    
    /**
     * 讲解段落
     */
    async explainParagraph(paragraphId) {
      if (this.loading.explaining.has(paragraphId)) {
        return; // 已在讲解中
      }
      
      this.loading.explaining.add(paragraphId);
      
      try {
        const response = await explainParagraph(paragraphId);
        
        // 更新本地缓存
        this._updateParagraphCache(paragraphId, {
          explanations: [response.explanation]
        });
        
        return response.explanation;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw error;
      } finally {
        this.loading.explaining.delete(paragraphId);
      }
    },
    
    /**
     * 切换显示模式
     */
    setDisplayMode(mode) {
      this.displayMode = mode;
    },
    
    /**
     * 切换章节展开状态
     */
    toggleSection(sectionId) {
      if (this.expandedSections.has(sectionId)) {
        this.expandedSections.delete(sectionId);
      } else {
        this.expandedSections.add(sectionId);
      }
    },
    
    /**
     * 设置当前活动段落
     */
    setActiveParagraph(paragraphId) {
      this.activeParagraphId = paragraphId;
    },
    
    /**
     * 追问
     */
    async askQuestion(parentId, parentType, question) {
      if (this.loading.followUp.has(parentId)) {
        return;
      }
      
      this.loading.followUp.add(parentId);
      
      try {
        const response = await submitFollowUp(parentId, parentType, question);
        return response.followUp;
      } catch (error) {
        this.errorMessage = parseApiError(error);
        throw error;
      } finally {
        this.loading.followUp.delete(parentId);
      }
    },
    
    /**
     * 获取追问记录
     */
    async loadFollowUps(parentId) {
      try {
        const response = await getFollowUps(parentId);
        return response.followUps;
      } catch (error) {
        console.error("Failed to load follow-ups:", error);
        return [];
      }
    },
    
    /**
     * 清除错误信息
     */
    clearError() {
      this.errorMessage = "";
    },
    
    /**
     * 内部方法：更新段落缓存
     */
    _updateParagraphCache(paragraphId, updates) {
      for (const section of this.sections) {
        const paragraph = section.paragraphs.find(p => p.id === paragraphId);
        if (paragraph) {
          Object.assign(paragraph, updates);
          break;
        }
      }
    }
  }
});

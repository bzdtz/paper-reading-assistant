<template>
  <main class="result-page-v2">
    <!-- 顶部导航栏 -->
    <header class="top-bar">
      <div class="meta">
        <button class="back-btn" @click="goBack">← 返回输入</button>
        <h2>{{ paper?.fileName || '论文查看' }}</h2>
      </div>
      <div class="top-actions">
        <button class="action-btn" @click="translateAll" :disabled="isTranslatingAll">
          {{ isTranslatingAll ? '翻译中...' : '🔤 翻译全部' }}
        </button>
        <button class="action-btn primary" @click="explainAll" :disabled="isExplainingAll">
          {{ isExplainingAll ? '讲解中...' : '📖 讲解全部' }}
        </button>
      </div>
    </header>

    <!-- 错误提示 -->
    <div v-if="store.errorMessage" class="error-banner">
      {{ store.errorMessage }}
      <button class="close-btn" @click="store.clearError()">×</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isPolling" class="loading-banner">
      <div class="loading-spinner"></div>
      <div class="loading-text">
        <p v-if="pollStatus === 'loading'">📄 正在获取论文信息...</p>
        <p v-else-if="pollStatus === 'processing'">⏳ MinerU 正在解析论文，请稍候...（可能需要几分钟）</p>
        <p v-else-if="pollStatus === 'done'">✅ 解析完成，正在加载...</p>
        <p v-else-if="pollStatus === 'failed'">❌ 解析失败：{{ pollError }}</p>
      </div>
    </div>

    <!-- 主内容区：左右分栏 -->
    <div class="main-layout">
      <!-- 左侧：章节树 -->
      <div class="original-panel">
        <div class="panel-head">
          <h3 class="panel-title">📚 论文章节树</h3>
          <div class="tree-meta">{{ store.sections.length }} 章 · {{ totalParagraphCount }} 段</div>
        </div>
        
        <div v-if="activeSection" class="outline-tip">
          当前定位：{{ activeSection.title }}
        </div>

        <div class="sections-list outline-tree">
          <div v-for="section in store.sections" :key="section.id" class="section-group outline-node">
            <button class="section-header outline-header" @click="store.toggleSection(section.id)">
              <span class="expand-icon">{{ store.expandedSections.has(section.id) ? '▼' : '▶' }}</span>
              <span class="section-title">{{ section.title }}</span>
              <span class="count-badge">{{ section.paragraphs.length }} 段</span>
            </button>

            <div v-show="store.expandedSections.has(section.id)" class="section-children">
              <div
                v-for="para in section.paragraphs"
                :key="para.id"
                class="paragraph-item outline-paragraph"
                :class="{ active: store.activeParagraphId === para.id }"
                @click="selectParagraph(para.id)"
              >
                <div class="paragraph-item-top">
                  <span class="para-index">{{ para.order }}</span>
                  <span class="para-badges">
                    <span v-if="hasFigureHint(para.text)" class="hint-badge figure">图</span>
                    <span v-if="hasTableHint(para.text)" class="hint-badge table">表</span>
                  </span>
                </div>
                <p class="para-text compact">{{ previewText(para.text, 72) }}</p>

                <div class="para-actions compact-actions">
                  <button
                    class="para-btn"
                    @click.stop="handleTranslate(para.id)"
                    :disabled="store.loading.translating.has(para.id)"
                  >
                    {{ store.loading.translating.has(para.id) ? '翻译中...' : '翻译' }}
                  </button>
                  <button
                    class="para-btn primary"
                    @click.stop="handleExplain(para.id)"
                    :disabled="store.loading.explaining.has(para.id)"
                  >
                    {{ store.loading.explaining.has(para.id) ? '讲解中...' : '讲解' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：当前原文 + 对话讲解区 -->
      <div class="explanation-panel">
        <div class="source-preview" v-if="selectedParagraph">
          <div class="source-preview-head">
            <h3>🧭 当前原文定位</h3>
            <div class="source-badges">
              <span class="source-section">{{ activeSection?.title || selectedParagraph.sectionTitle }}</span>
              <span class="source-order">第 {{ selectedParagraph.order }} 段</span>
            </div>
          </div>
          <div class="source-content">
            <div class="source-block">
              <div class="source-block-title">原文</div>
              <div class="source-text original-text" v-html="renderMarkdown(selectedParagraph.originalText)"></div>
            </div>
            <div class="source-block">
              <div class="source-block-title">译文</div>
              <div v-if="selectedTranslation" class="translated-block" v-html="renderMarkdown(selectedTranslation.content)"></div>
              <div v-else class="placeholder-text">先点击左侧“翻译”按钮生成这一段的机器翻译。</div>
            </div>
            <div class="source-block">
              <div class="source-block-title">讲解</div>
              <div v-if="selectedExplanation" class="translated-block" v-html="renderMarkdown(selectedExplanation.content)"></div>
              <div v-else class="placeholder-text">
                <div>先点击左侧“讲解”按钮生成这一段的讲解。</div>
                <button
                  v-if="selectedParagraph"
                  class="inline-action-btn"
                  :disabled="store.loading.explaining.has(selectedParagraph.id)"
                  @click="handleExplain(selectedParagraph.id)"
                >
                  {{ store.loading.explaining.has(selectedParagraph.id) ? '生成中...' : '立即生成讲解' }}
                </button>
              </div>
            </div>
            <div v-if="relatedFigures.length" class="source-block related-figures">
              <div class="source-block-title">相关附图（点击查看大图）</div>
              <div class="figure-grid">
                <a
                  v-for="figure in relatedFigures"
                  :key="figure.key"
                  :href="figure.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="figure-card"
                >
                  <img :src="figure.url" :alt="figure.alt || figure.caption || 'figure'" />
                  <div class="figure-meta">
                    <div class="figure-title">{{ figure.caption || figure.alt || 'Figure' }}</div>
                    <div v-if="figure.hint" class="figure-hint">{{ figure.hint }}</div>
                    <div v-if="figure.explanation" class="figure-explain">{{ figure.explanation }}</div>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-header">
          <h3>对话讲解</h3>
          <div v-if="studyProgress" class="progress-chip">
            {{ studyProgress.currentSectionTitle }} · {{ studyProgress.currentPart }}/{{ studyProgress.totalParts }}
          </div>
        </div>

        <div class="dialog-body" ref="chatContainerRef">
          <div v-if="!studySessionId" class="empty-state">
            <div class="empty-icon">📘</div>
            <p>点击下方按钮，按论文顺序开始讲解</p>
            <button class="action-btn primary" :disabled="isStartingSession || !store.paperId" @click="startReadingPaper">
              {{ isStartingSession ? '启动中...' : '开始看论文' }}
            </button>
          </div>

          <div v-else class="chat-messages">
            <div v-for="(item, idx) in studyMessages" :key="idx" :class="['chat-row', item.role]">
              <div class="chat-bubble" v-html="renderMarkdown(item.content)"></div>
            </div>
          </div>
        </div>

        <div v-if="studySessionId" class="dialog-actions">
          <button class="action-btn" @click="quickAction('下一部分')" :disabled="isSendingStudyMessage || studyFinished">下一部分</button>
          <button class="action-btn" @click="quickAction('下一章')" :disabled="isSendingStudyMessage || studyFinished">下一章</button>
        </div>

        <div v-if="studySessionId" class="dialog-input-wrap">
          <input
            v-model="studyInput"
            class="dialog-input"
            placeholder="输入问题，或输入 下一部分"
            :disabled="isSendingStudyMessage"
            @keyup.enter="sendStudyChat()"
          />
          <button class="action-btn primary" :disabled="isSendingStudyMessage || !studyInput.trim()" @click="sendStudyChat()">
            {{ isSendingStudyMessage ? '发送中...' : '发送' }}
          </button>
        </div>

        <div v-if="!studySessionId && selectedParagraph" class="selected-note">
          你也可以先从左侧选段，再点击“开始看论文”进入连续讲解。
        </div>
      </div>

      <aside class="media-rail">
        <div class="media-rail-head">🧩 非文字信息</div>
        <div class="media-rail-list">
          <component
            v-for="figure in mediaRailItems"
            :key="figure.key"
            :is="canPreviewMedia(figure) ? 'a' : 'div'"
            :href="canPreviewMedia(figure) ? figure.url : undefined"
            :target="canPreviewMedia(figure) ? '_blank' : undefined"
            :rel="canPreviewMedia(figure) ? 'noopener noreferrer' : undefined"
            :class="['media-card', { 'media-card-empty': !figure.url }]"
          >
            <div v-if="canPreviewMedia(figure)" class="media-image-wrap">
              <img
                :src="figure.url"
                :alt="figure.caption || 'figure'"
                loading="lazy"
                @error="handleMediaError(figure.key)"
              />
            </div>
            <div v-else class="media-placeholder">
              <div class="media-placeholder-icon">{{ figure.icon || '🧩' }}</div>
              <div class="media-placeholder-text">{{ figure.placeholderText || '暂无可预览内容' }}</div>
            </div>
            <div class="media-card-body">
              <div class="media-title">{{ figure.caption || figure.mineruName || '非文字内容' }}</div>
              <div v-if="figure.mineruType" class="media-type">{{ figure.mineruType }}</div>
              <div class="media-explain">{{ figure.explanation || '暂无说明' }}</div>
            </div>
          </component>
        </div>
      </aside>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { createMarkdownRenderer } from '../utils/markdown';
import { usePaperDetailStore } from '../stores/paperDetailStore';
import { getPaperDetail, getPaperNonTextItems, startStudySession, sendStudyMessage } from '../services/paperApiV2';

const router = useRouter();
const route = useRoute();
const store = usePaperDetailStore();
const apiBaseUrl = (process.env.VUE_APP_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const { md, render: renderMarkdown } = createMarkdownRenderer();

md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const srcIndex = token.attrIndex('src');
  if (srcIndex >= 0 && store.paperId) {
    const src = token.attrs[srcIndex][1] || '';
    if (src && !/^https?:\/\//i.test(src) && !src.startsWith('data:')) {
      if (src.startsWith('/mineru-results/')) {
        token.attrs[srcIndex][1] = `${apiBaseUrl}${src}`;
        return self.renderToken(tokens, index, options);
      }

      if (src.startsWith('/')) {
        token.attrs[srcIndex][1] = `${apiBaseUrl}${src}`;
        return self.renderToken(tokens, index, options);
      }

      if (/^mineru-results\//i.test(src)) {
        token.attrs[srcIndex][1] = `${apiBaseUrl}/${src}`;
        return self.renderToken(tokens, index, options);
      }

      const normalizedSrc = src.replace(/^\.\//, '').replace(/^\//, '');
      token.attrs[srcIndex][1] = `${apiBaseUrl}/mineru-results/${store.paperId}/${normalizedSrc}`;
    }
  }
  return self.renderToken(tokens, index, options);
};

// UI 状态
const isTranslatingAll = ref(false);
const isExplainingAll = ref(false);
const showFollowUp = ref(new Set());
const followUpInputs = ref({});
const followUps = ref({});
const localNonTextItems = ref([]);

const paper = computed(() => store.paper);
const totalParagraphCount = computed(() => {
  return store.sections.reduce((total, section) => total + (section.paragraphs?.length || 0), 0);
});

const activeSection = computed(() => {
  if (!store.activeParagraphId) {
    return null;
  }

  return store.sections.find((section) =>
    section.paragraphs.some((paragraph) => paragraph.id === store.activeParagraphId)
  ) || null;
});

const selectedParagraph = computed(() => {
  if (!store.activeParagraphId) {
    return null;
  }

  for (const section of store.sections) {
    const paragraph = section.paragraphs.find((item) => item.id === store.activeParagraphId);
    if (paragraph) {
      return {
        ...paragraph,
        originalText: paragraph.text || paragraph.originalText || '',
        sectionTitle: section.title,
        sectionId: section.id
      };
    }
  }

  return null;
});

const selectedTranslation = computed(() => {
  if (!store.activeParagraphId) {
    return null;
  }

  const translation = store.getTranslation(store.activeParagraphId);
  if (!translation) {
    return null;
  }

  if (typeof translation === 'string') {
    return { content: translation };
  }

  return {
    ...translation,
    content: translation.content || translation.text || String(translation || '')
  };
});

const selectedExplanation = computed(() => {
  if (!store.activeParagraphId) {
    return null;
  }

  const explanation = store.getExplanation(store.activeParagraphId);
  if (!explanation) {
    return null;
  }

  if (typeof explanation === 'string') {
    return { content: explanation };
  }

  return {
    ...explanation,
    content: explanation.content || explanation.text || String(explanation || '')
  };
});

const latestAssistantMessage = computed(() => {
  for (let index = studyMessages.value.length - 1; index >= 0; index -= 1) {
    const item = studyMessages.value[index];
    if (item?.role === 'assistant' && item?.content) {
      return String(item.content);
    }
  }

  return '';
});

const toAbsoluteMediaUrl = (src) => {
  const value = String(src || '').trim();
  if (!value) {
    return '';
  }

  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) {
    return value;
  }

  if (value.startsWith('/mineru-results/')) {
    return `${apiBaseUrl}${value}`;
  }

  if (value.startsWith('/')) {
    return `${apiBaseUrl}${value}`;
  }

  if (/^mineru-results\//i.test(value)) {
    return `${apiBaseUrl}/${value}`;
  }

  const normalizedSrc = value.replace(/^\.\//, '').replace(/^\//, '');
  return `${apiBaseUrl}/mineru-results/${store.paperId}/${normalizedSrc}`;
};

const extractImageEntries = (text) => {
  const content = String(text || '');
  const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(content)) !== null) {
    images.push({
      alt: String(match[1] || '').trim(),
      src: String(match[2] || '').trim()
    });
  }

  return images;
};

const extractFigureRefs = (text) => {
  const refs = new Set();
  const content = String(text || '');
  const regex = /(fig(?:ure)?\.?|图)\s*([0-9]{1,3})/ig;
  let match;

  while ((match = regex.exec(content)) !== null) {
    refs.add(Number(match[2]));
  }

  return Array.from(refs);
};

const extractTableRefs = (text) => {
  const refs = new Set();
  const content = String(text || '');
  const regex = /(table|tab\.?|表)\s*([0-9]{1,3})/ig;
  let match;

  while ((match = regex.exec(content)) !== null) {
    refs.add(Number(match[2]));
  }

  return Array.from(refs);
};

const hasMarkdownTable = (text) => {
  const content = String(text || '');
  return /\|.*\|/.test(content) && /\|\s*[-:]{2,}[-|\s:]*\|/.test(content);
};

const cleanMediaText = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const isTechnicalFilePathText = (value) => {
  const text = cleanMediaText(value, '');
  if (!text) {
    return false;
  }

  if (/^本地文件[:：]/.test(text)) {
    return true;
  }

  return /(?:^|\s)(?:images?|figures?|tables?)\/[\w\-./]+\.(?:png|jpe?g|gif|webp|bmp)(?:\s|$)/i.test(text);
};

const sanitizeMediaExplanation = (value) => {
  const text = cleanMediaText(value, '');
  if (!text || isTechnicalFilePathText(text)) {
    return '';
  }
  return text;
};

const extractFigureNoFromText = (value) => {
  const text = cleanMediaText(value, '');
  const match = text.match(/(?:fig(?:ure)?\.?|图)\s*([0-9]{1,3})/i);
  return match ? Number(match[1]) : null;
};

const allImagePool = computed(() => {
  const pool = [];

  for (const item of localNonTextItems.value || []) {
    const url = toAbsoluteMediaUrl(item.url || item.relativePath || item.fileName || '');
    if (!url) {
      continue;
    }

    const caption = cleanMediaText(item.caption, item.fileName || '图片');
    const explanation = cleanMediaText(item.explanation, '');
    const figureNo = extractFigureNoFromText(`${caption} ${explanation}`);
    const orderValue = Number(item.orderHint);

    pool.push({
      key: String(item.key || item.relativePath || item.fileName || `local-${pool.length}`),
      sectionId: '',
      sectionTitle: '',
      paragraphId: '',
      order: Number.isFinite(orderValue) ? orderValue : Number.MAX_SAFE_INTEGER,
      alt: caption,
      caption,
      figureNo,
      url
    });
  }

  if (pool.length > 0) {
    return pool;
  }

  for (const section of store.sections || []) {
    for (const para of section.paragraphs || []) {
      const images = extractImageEntries(para.text || para.originalText || '');
      for (const image of images) {
        const url = toAbsoluteMediaUrl(image.src);
        if (!url) {
          continue;
        }

        const label = String(image.alt || '').trim();
        const figureNoMatch = label.match(/(?:fig(?:ure)?\.?|图)\s*([0-9]{1,3})/i);

        pool.push({
          key: `${section.id}-${para.id}-${image.src}`,
          sectionId: section.id,
          sectionTitle: section.title,
          paragraphId: para.id,
          order: Number(para.order || 0),
          alt: image.alt,
          caption: image.alt,
          figureNo: figureNoMatch ? Number(figureNoMatch[1]) : null,
          url
        });
      }
    }
  }

  return pool;
});

const allNonTextPool = computed(() => {
  const fromLocal = [];

  for (const item of localNonTextItems.value || []) {
    const caption = cleanMediaText(item.caption, item.fileName || '图片');
    const explanation = sanitizeMediaExplanation(item.explanation) || '来源：论文中的非文字元素';
    const orderValue = Number(item.orderHint);
    const figureNo = extractFigureNoFromText(`${caption} ${item.explanation || ''}`);

    fromLocal.push({
      key: String(item.key || item.relativePath || item.fileName || `local-${fromLocal.length}`),
      icon: item.icon || '🖼',
      mineruType: cleanMediaText(item.mineruType || item.type || '', ''),
      mineruName: cleanMediaText(item.mineruName || caption, caption),
      caption,
      figureNo,
      order: Number.isFinite(orderValue) ? orderValue : Number.MAX_SAFE_INTEGER,
      url: toAbsoluteMediaUrl(item.url || item.relativePath || item.fileName || ''),
      placeholderText: item.placeholderText || '本地图片预览不可用',
      explanation
    });
  }

  if (fromLocal.length > 0) {
    return fromLocal;
  }

  const output = [];
  const seen = new Set();
  const seenImageSrc = new Set();
  const seenTableNo = new Set();

  const pushUnique = (item) => {
    if (!item || seen.has(item.key)) {
      return;
    }
    seen.add(item.key);
    output.push(item);
  };

  for (const section of store.sections || []) {
    for (const para of section.paragraphs || []) {
      const content = String(para.text || para.originalText || '');
      const sourceLabel = `${section.title || '未知章节'} · 第 ${para.order || '-'} 段`;

      const images = extractImageEntries(content);
      for (const image of images) {
        const normalizedSrc = String(image.src || '').trim().replace(/^\.\//, '').replace(/^\//, '');
        if (!normalizedSrc || seenImageSrc.has(normalizedSrc)) {
          continue;
        }

        const figureNoMatch = String(image.alt || '').match(/(?:fig(?:ure)?\.?|图)\s*([0-9]{1,3})/i);
        const figureNo = figureNoMatch ? Number(figureNoMatch[1]) : null;
        const url = toAbsoluteMediaUrl(image.src);

        seenImageSrc.add(normalizedSrc);
        pushUnique({
          key: `image-${normalizedSrc}`,
          icon: '🖼',
          caption: image.alt || (figureNo ? `Figure ${figureNo}` : '图片'),
          figureNo,
          order: Number(para.order || 0),
          url,
          placeholderText: '未找到真实图片',
          explanation: `来源：${sourceLabel}`
        });
      }

      const tableRefs = extractTableRefs(content);
      for (const tableNo of tableRefs) {
        if (seenTableNo.has(tableNo)) {
          continue;
        }

        seenTableNo.add(tableNo);
        pushUnique({
          key: `table-ref-${tableNo}`,
          icon: '📊',
          caption: `Table ${tableNo}`,
          order: Number(para.order || 0),
          url: '',
          placeholderText: '已识别表号，暂无单独预览图',
          explanation: `来源：${sourceLabel}`
        });
      }

      if (hasMarkdownTable(content)) {
        pushUnique({
          key: `table-markdown-${para.id}`,
          icon: '📊',
          caption: '表格（Markdown）',
          order: Number(para.order || 0),
          url: '',
          placeholderText: '当前为文本表格，暂无单独预览图',
          explanation: `来源：${sourceLabel}`
        });
      }
    }
  }

  if (!output.length) {
    output.push({
      key: 'non-text-empty',
      icon: '🧩',
      caption: '暂无非文字信息',
      order: Number.MAX_SAFE_INTEGER,
      url: '',
      placeholderText: '解析结果里暂时没有图表',
      explanation: '检测到图、表或图号后会自动展示在这里。'
    });
  }

  return output;
});

const figureExplanationText = (figure, refNumbers) => {
  const title = String(figure.caption || figure.alt || '').trim();
  const targetRef = (refNumbers || []).find((n) => n === figure.figureNo);

  if (targetRef) {
    return `回答中提到 Figure ${targetRef}，这张图可用于对应理解该结论。`;
  }

  if (title) {
    return `图示内容：${title}`;
  }

  return '该图与当前回答上下文相关，建议结合本段原文与译文一起查看。';
};

const relatedFigures = computed(() => {
  if (!selectedParagraph.value) {
    return [];
  }

  const output = [];
  const seen = new Set();
  const seenUrls = new Set();
  const pushUnique = (item) => {
    const url = String(item?.url || '').trim();
    if (!item || seen.has(item.key) || (url && seenUrls.has(url))) {
      return;
    }
    seen.add(item.key);
    if (url) {
      seenUrls.add(url);
    }
    output.push(item);
  };

  const directImages = extractImageEntries(selectedParagraph.value.originalText).map((image, index) => ({
    key: `direct-${selectedParagraph.value.id}-${index}`,
    alt: image.alt,
    caption: image.alt,
    order: Number(selectedParagraph.value.order || 0),
    url: toAbsoluteMediaUrl(image.src),
    hint: '当前段落中的附图'
  })).filter((item) => item.url);

  for (const image of directImages) {
    pushUnique(image);
  }

  const referenceText = [
    selectedParagraph.value.originalText,
    selectedTranslation.value?.content || '',
    selectedExplanation.value?.content || '',
    latestAssistantMessage.value
  ].join('\n');

  const refs = extractFigureRefs(referenceText);
  for (const refNumber of refs) {
    const byFigureNo = allImagePool.value.find((item) => item.figureNo === refNumber);
    if (byFigureNo) {
      pushUnique({ ...byFigureNo, hint: `匹配 Figure ${refNumber}` });
      continue;
    }

    const byCaption = allImagePool.value.find((item) => {
      const label = `${item.alt || ''} ${item.caption || ''}`;
      return new RegExp(`(?:fig(?:ure)?\\.?|图)\\s*${refNumber}`, 'i').test(label);
    });

    if (byCaption) {
      pushUnique({ ...byCaption, hint: `匹配 Figure ${refNumber}` });
      continue;
    }

    pushUnique({
      key: `placeholder-${selectedParagraph.value.id}-${refNumber}`,
      caption: `Figure ${refNumber}`,
      figureNo: refNumber,
      order: Number.MAX_SAFE_INTEGER,
      url: '',
      hint: '当前只有图号，没有匹配到真实图片'
    });
  }

  if (!output.length) {
    output.push({
      key: `empty-${selectedParagraph.value.id}`,
      caption: '图片区域',
      figureNo: null,
      order: Number.MAX_SAFE_INTEGER,
      url: '',
      explanation: '这里会显示当前段落或当前回答中提到的图片与图注。'
    });
  }

  return output.map((item) => ({
    ...item,
    explanation: figureExplanationText(item, refs)
  }));
});

const mediaRailItems = computed(() => allNonTextPool.value);

// 加载状态
const isPolling = ref(false);
const pollStatus = ref(''); // 'loading', 'processing', 'done', 'failed'
const pollError = ref('');

// 学习会话状态
const studySessionId = ref('');
const studyMessages = ref([]);
const studyInput = ref('');
const studyProgress = ref(null);
const studyFinished = ref(false);
const isStartingSession = ref(false);
const isSendingStudyMessage = ref(false);
const chatContainerRef = ref(null);
const failedMediaKeys = ref(new Set());

const canPreviewMedia = (figure) => {
  return Boolean(figure?.url) && !failedMediaKeys.value.has(figure.key);
};

const handleMediaError = (key) => {
  if (!key) {
    return;
  }
  failedMediaKeys.value.add(key);
};

// 轮询检查论文解析状态
const pollPaperStatus = async (paperId, maxAttempts = 60) => {
  isPolling.value = true;
  pollStatus.value = 'loading';
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await getPaperDetail(paperId);
      const rawContent = JSON.parse(response.paper.rawContent || '{}');
      
      if (rawContent.status === 'completed') {
        pollStatus.value = 'done';
        // 加载完整数据
        await store.loadPaper(paperId);
        return true;
      } else if (rawContent.status === 'failed') {
        pollStatus.value = 'failed';
        pollError.value = rawContent.error || '解析失败';
        return false;
      }
      
      // 还在处理中
      pollStatus.value = 'processing';
      console.log(`[ResultPageV2] 解析中... 尝试 ${attempt + 1}/${maxAttempts}`);
      
      // 等待 5 秒后再次检查
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('[ResultPageV2] 轮询失败:', error);
      // 如果是 404 错误，说明论文还没创建完成
      if (error.response?.status === 404) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }
  }
  
  pollStatus.value = 'failed';
  pollError.value = '解析超时，请稍后刷新页面';
  return false;
};

const loadLocalNonTextItems = async (paperId) => {
  if (!paperId) {
    localNonTextItems.value = [];
    return;
  }

  try {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let items = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await getPaperNonTextItems(paperId);
      items = Array.isArray(response?.items) ? response.items : [];

      if (response?.orderMeta) {
        console.log('[ResultPageV2] 非文字排序元信息:', response.orderMeta);
      }

      if (items.length > 0 || attempt === 2) {
        break;
      }

      await wait(1000);
    }

    localNonTextItems.value = items;
    console.log(`[ResultPageV2] 本地非文字内容: ${items.length} 条`);
  } catch (error) {
    console.warn('[ResultPageV2] 获取本地非文字内容失败:', error);
    localNonTextItems.value = [];
  }
};

const sectionsWithContent = computed(() => {
  return store.sections.filter(section => 
    section.paragraphs.some(para => hasContent(para.id))
  );
});

const hasAnyContent = computed(() => {
  return store.sections.some(section =>
    section.paragraphs.some(para => hasContent(para.id))
  );
});

const hasContent = (paragraphId) => {
  if (store.displayMode === 'translation') {
    return !!store.getTranslation(paragraphId);
  } else {
    return !!store.getExplanation(paragraphId);
  }
};

const getTranslationContent = (paragraphId) => {
  const trans = store.getTranslation(paragraphId);
  return trans?.content || '';
};

const getExplanationContent = (paragraphId) => {
  const exp = store.getExplanation(paragraphId);
  return exp?.content || '';
};

const previewText = (text, limit = 72) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
};

const hasFigureHint = (text) => /\b(fig\.?|figure|图\s*\d|图表)\b/i.test(String(text || ''));

const hasTableHint = (text) => /\b(table|tab\.?|表\s*\d|表格)\b/i.test(String(text || ''));

const isLoadingContent = (paragraphId) => {
  if (store.displayMode === 'translation') {
    return store.loading.translating.has(paragraphId);
  } else {
    return store.loading.explaining.has(paragraphId);
  }
};

const getFollowUpCount = (paragraphId) => {
  return followUps.value[paragraphId]?.length || 0;
};

const toggleFollowUp = (paragraphId) => {
  if (showFollowUp.value.has(paragraphId)) {
    showFollowUp.value.delete(paragraphId);
  } else {
    showFollowUp.value.add(paragraphId);
  }
};

const scrollChatToBottom = async () => {
  await nextTick();
  if (!chatContainerRef.value) {
    return;
  }
  chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight;
};

const applyStudyProgress = (progress) => {
  if (!progress) {
    return;
  }

  studyProgress.value = progress;

  if (progress.currentParagraphId) {
    store.setActiveParagraph(progress.currentParagraphId);
    const section = store.sections.find((item) => item.title === progress.currentSectionTitle);
    if (section) {
      store.expandedSections.add(section.id);
    }
  }
};

const startReadingPaper = async () => {
  if (!store.paperId) {
    return;
  }

  isStartingSession.value = true;
  try {
    const data = await startStudySession(store.paperId);
    studySessionId.value = data.sessionId;
    studyMessages.value = [
      { role: 'user', content: '开始看论文' },
      { role: 'assistant', content: data.message }
    ];
    studyFinished.value = false;
    applyStudyProgress(data.progress);
    await scrollChatToBottom();
  } catch (error) {
    store.errorMessage = error?.response?.data?.message || error?.message || '启动会话失败';
  } finally {
    isStartingSession.value = false;
  }
};

const sendStudyChat = async (preset) => {
  const content = String(preset || studyInput.value || '').trim();
  if (!content || !studySessionId.value) {
    return;
  }

  isSendingStudyMessage.value = true;
  studyMessages.value.push({ role: 'user', content });
  studyInput.value = '';

  try {
    const data = await sendStudyMessage(studySessionId.value, content);
    studyMessages.value.push({ role: 'assistant', content: data.message });
    studyFinished.value = Boolean(data.finished);
    applyStudyProgress(data.progress);
    await scrollChatToBottom();
  } catch (error) {
    store.errorMessage = error?.response?.data?.message || error?.message || '发送消息失败';
  } finally {
    isSendingStudyMessage.value = false;
  }
};

const quickAction = async (text) => {
  await sendStudyChat(text);
};

// 选择段落（高亮）
const selectParagraph = (paragraphId) => {
  store.setActiveParagraph(paragraphId);
};

// 翻译单个段落
const handleTranslate = async (paragraphId) => {
  await store.translateParagraph(paragraphId);
  store.setDisplayMode('translation');
};

// 讲解单个段落
const handleExplain = async (paragraphId) => {
  // 讲解前先确保存在译文，保证“原文 -> 译文 -> 讲解”链路完整
  if (!store.getTranslation(paragraphId)) {
    await store.translateParagraph(paragraphId);
  }
  await store.explainParagraph(paragraphId);
  store.setDisplayMode('explanation');
};

// 翻译全部
const translateAll = async () => {
  isTranslatingAll.value = true;
  try {
    for (const section of store.sections) {
      for (const para of section.paragraphs) {
        if (!store.getTranslation(para.id)) {
          await handleTranslate(para.id);
        }
      }
    }
  } catch (error) {
    console.error('Failed to translate all:', error);
  } finally {
    isTranslatingAll.value = false;
  }
};

// 讲解全部
const explainAll = async () => {
  isExplainingAll.value = true;
  try {
    for (const section of store.sections) {
      for (const para of section.paragraphs) {
        if (!store.getTranslation(para.id)) {
          await handleTranslate(para.id);
        }
        if (!store.getExplanation(para.id)) {
          await handleExplain(para.id);
        }
      }
    }
  } catch (error) {
    console.error('Failed to explain all:', error);
  } finally {
    isExplainingAll.value = false;
  }
};

// 追问
const submitFollowUp = async (paragraphId) => {
  const question = followUpInputs.value[paragraphId];
  if (!question) return;
  
  const parentId = store.displayMode === 'translation'
    ? store.getTranslation(paragraphId)?.id
    : store.getExplanation(paragraphId)?.id;
  
  if (!parentId) return;
  
  const parentType = store.displayMode === 'translation' ? 'TRANSLATION' : 'EXPLANATION';
  
  try {
    const followUp = await store.askQuestion(parentId, parentType, question);
    if (!followUps.value[paragraphId]) {
      followUps.value[paragraphId] = [];
    }
    followUps.value[paragraphId].push(followUp);
    followUpInputs.value[paragraphId] = '';
  } catch (error) {
    console.error('Failed to submit follow-up:', error);
  }
};

const goBack = () => {
  router.push('/');
};

onMounted(async () => {
  const paperId = route.params.id;
  
  if (paperId) {
    // 有 paperId，轮询等待解析完成
    console.log('[ResultPageV2] 开始轮询论文解析状态:', paperId);
    
    try {
      const success = await pollPaperStatus(paperId);
      
      if (!success) {
        console.error('[ResultPageV2] 论文解析失败:', pollError.value);
      }
    } catch (error) {
      console.error('[ResultPageV2] 轮询异常:', error);
      pollStatus.value = 'failed';
      pollError.value = error.message || '加载失败';
    }

    await loadLocalNonTextItems(paperId);
    
    // 解析失败时不兜底成模拟论文。pollPaperStatus 已经把 pollStatus 置为
    // 'failed' 并带上真实原因，顶部提示条会显示它；这里再塞一份硬编码的
    // 示例论文（"Attention is All You Need"）只会让人误以为解析成功了。
    // 章节树此时显示 "0 章 · 0 段"，如实反映状态。
  } else {
    // 没有 paperId：不是有效的进入路径，同样不用模拟数据填充。
    localNonTextItems.value = [];
    store.errorMessage = '缺少论文 ID，请返回首页重新上传';
  }
  
  // 默认展开第一个章节
  if (store.sections.length > 0) {
    store.expandedSections.add(store.sections[0].id);
  }
});
</script>

<style scoped>
.result-page-v2 {
  padding: 20px;
  min-height: 100vh;
  background: #f5f7fa;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: white;
  border-radius: 12px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.meta {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.back-btn:hover {
  background: #f0f0f0;
}

.meta h2 {
  margin: 0;
  font-size: 20px;
  color: #1a202c;
}

.top-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  padding: 10px 20px;
  border: 1px solid #4a5568;
  border-radius: 8px;
  background: white;
  color: #4a5568;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: #f7fafc;
  border-color: #2d3748;
}

.action-btn.primary {
  background: #3182ce;
  border-color: #3182ce;
  color: white;
}

.action-btn.primary:hover:not(:disabled) {
  background: #2c5282;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-banner {
  background: #fed7d7;
  color: #c53030;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #c53030;
}

.loading-banner {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px 24px;
  border-radius: 12px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  flex: 1;
}

.loading-text p {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.result-page-v2 .main-layout {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(280px, 320px);
  gap: 20px;
  align-items: start;
  min-height: calc(100vh - 200px);
}

.original-panel {
  grid-column: 1;
  min-width: 0;
}

.explanation-panel {
  grid-column: 2;
  min-width: 0;
}

.original-panel,
.explanation-panel {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow-y: auto;
  max-height: calc(100vh - 160px);
}

.panel-title {
  margin: 0 0 16px;
  font-size: 18px;
  color: #2d3748;
  padding-bottom: 12px;
  border-bottom: 2px solid #e2e8f0;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.tree-meta {
  color: #718096;
  font-size: 12px;
  white-space: nowrap;
}

.outline-tip {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f0f9ff;
  color: #2c5282;
  font-size: 13px;
}

.sections-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.outline-tree {
  gap: 12px;
}

.outline-node {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.section-header {
  font-size: 16px;
  font-weight: 600;
  color: #4a5568;
  padding: 8px 0;
  border-bottom: 1px solid #e2e8f0;
}

.outline-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: none;
  border-bottom: 1px solid #edf2f7;
  cursor: pointer;
}

.section-children {
  padding: 12px;
  background: #fff;
}

.outline-paragraph {
  margin: 0 0 10px;
}

.outline-paragraph:last-child {
  margin-bottom: 0;
}

.paragraph-item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.para-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  background: #ebf8ff;
  color: #2b6cb0;
  font-size: 12px;
  font-weight: 700;
}

.para-badges {
  display: flex;
  gap: 6px;
}

.hint-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.hint-badge.figure {
  background: #fff5f5;
  color: #c53030;
}

.hint-badge.table {
  background: #f0fff4;
  color: #2f855a;
}

.compact {
  font-size: 13px;
  line-height: 1.65;
}

.compact-actions {
  flex-wrap: wrap;
}

.paragraph-item {
  padding: 12px;
  margin: 8px 0;
  background: #f7fafc;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.paragraph-item:hover {
  background: #edf2f7;
}

.paragraph-item.active {
  border-color: #3182ce;
  background: #ebf8ff;
}

.para-text {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #4a5568;
}

.para-actions {
  display: flex;
  gap: 8px;
}

.para-btn {
  padding: 6px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  background: white;
  color: #4a5568;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.para-btn:hover:not(:disabled) {
  background: #f7fafc;
  border-color: #a0aec0;
}

.para-btn.primary {
  background: #ed8936;
  border-color: #ed8936;
  color: white;
}

.para-btn.primary:hover:not(:disabled) {
  background: #dd6b20;
}

.para-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.explanation-toolbar {
  margin-bottom: 16px;
}

.mode-toggle {
  display: flex;
  gap: 8px;
  background: #f7fafc;
  padding: 4px;
  border-radius: 8px;
}

.toggle-btn {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #4a5568;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.toggle-btn.active {
  background: white;
  color: #3182ce;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.explanation-content {
  min-height: 400px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #a0aec0;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.sections-accordion {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.accordion-item {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.accordion-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #f7fafc;
  cursor: pointer;
  transition: background 0.2s;
}

.accordion-header:hover {
  background: #edf2f7;
}

.expand-icon {
  font-size: 12px;
  color: #718096;
}

.section-title {
  flex: 1;
  font-weight: 600;
  color: #2d3748;
}

.count-badge {
  background: #edf2f7;
  color: #718096;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
}

.accordion-body {
  padding: 16px;
  background: white;
}

.result-paragraph {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.result-paragraph:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.para-label {
  font-weight: 600;
  color: #4a5568;
  font-size: 14px;
}

.loading-indicator {
  color: #ed8936;
  font-size: 13px;
}

.result-content {
  background: #f7fafc;
  padding: 12px;
  border-radius: 6px;
  margin-top: 8px;
}

.translation-text,
.explanation-text {
  font-size: 14px;
  line-height: 1.8;
  color: #2d3748;
  white-space: pre-wrap;
}

.placeholder-text {
  color: #a0aec0;
  font-style: italic;
  text-align: center;
  padding: 20px;
}

.followup-section {
  margin-top: 12px;
}

.followup-toggle {
  color: #3182ce;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  padding: 8px;
  border-radius: 6px;
  transition: background 0.2s;
}

.followup-toggle:hover {
  background: #ebf8ff;
}

.followup-chat {
  margin-top: 8px;
  padding: 12px;
  background: #f7fafc;
  border-radius: 8px;
}

.followup-messages {
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
}

.message.question {
  background: #ebf8ff;
  color: #2c5282;
}

.message.answer {
  background: white;
  border: 1px solid #e2e8f0;
  color: #2d3748;
}

.followup-input {
  display: flex;
  gap: 8px;
}

.followup-input-field {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.followup-input-field:focus {
  border-color: #3182ce;
}

.followup-send-btn {
  padding: 10px 20px;
  background: #3182ce;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.followup-send-btn:hover:not(:disabled) {
  background: #2c5282;
}

.followup-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  color: #2d3748;
}

.source-preview {
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #fafcff 100%);
}

.source-preview-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.source-preview-head h3 {
  margin: 0;
  font-size: 16px;
  color: #2d3748;
}

.source-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.source-section,
.source-order {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #edf2f7;
  color: #4a5568;
  font-size: 12px;
}

.source-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.source-block {
  padding: 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.source-block-title {
  margin-bottom: 8px;
  color: #718096;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.source-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
  color: #1a202c;
  font-size: 14px;
}

.source-text :deep(p) {
  margin: 0 0 10px;
}

.source-text :deep(p:last-child) {
  margin-bottom: 0;
}

.source-text :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 12px auto;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.source-text :deep(blockquote) {
  margin: 12px 0;
  padding: 10px 12px;
  border-left: 4px solid #90cdf4;
  background: #f8fbff;
  color: #4a5568;
}

.source-text :deep(code) {
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  background: #edf2f7;
}

.original-text {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #edf2f7;
}

.translated-block {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #edf2f7;
}

.inline-action-btn {
  margin-top: 10px;
  border: 1px solid #3182ce;
  background: #ebf8ff;
  color: #2b6cb0;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.inline-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.related-figures {
  background: #f9fafb;
}

.figure-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.figure-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
}

.figure-card img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  background: #edf2f7;
}

.figure-meta {
  padding: 8px 10px;
}

.figure-title {
  font-size: 12px;
  color: #2d3748;
  font-weight: 600;
  line-height: 1.4;
}

.figure-hint {
  margin-top: 4px;
  color: #718096;
  font-size: 11px;
}

.figure-explain {
  margin-top: 6px;
  color: #2d3748;
  font-size: 12px;
  line-height: 1.5;
}

.selected-note {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fffaf0;
  color: #975a16;
  font-size: 13px;
}

.media-rail {
  grid-column: 3;
  align-self: start;
  position: sticky;
  top: 0;
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow-y: auto;
  max-height: calc(100vh - 160px);
}

.media-rail-head {
  font-size: 16px;
  font-weight: 700;
  color: #2d3748;
  padding-bottom: 12px;
  border-bottom: 2px solid #e2e8f0;
  margin-bottom: 12px;
}

.media-rail-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.media-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  text-decoration: none;
  color: #2d3748;
  background: #fff;
}

.media-card-empty {
  display: block;
}

.media-image-wrap {
  width: 100%;
  height: 150px;
  overflow: hidden;
}

.media-card img {
  display: block;
  width: 100%;
  height: 150px;
  object-fit: cover;
  background: #f7fafc;
}

.media-placeholder {
  width: 100%;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #edf2f7 0%, #f8fafc 100%);
  color: #718096;
}

.media-placeholder-icon {
  font-size: 28px;
  line-height: 1;
}

.media-placeholder-text {
  margin-top: 8px;
  font-size: 12px;
}

.media-card-body {
  display: block;
  border-top: 1px solid #edf2f7;
  background: #fff;
  padding: 10px 12px;
}

.media-title {
  font-size: 13px;
  font-weight: 700;
  color: #2d3748;
  line-height: 1.4;
}

.media-explain {
  margin-top: 6px;
  color: #4a5568;
  font-size: 12px;
  line-height: 1.5;
}

.progress-chip {
  background: #ebf8ff;
  color: #2b6cb0;
  border: 1px solid #bee3f8;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}

.dialog-body {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  min-height: 400px;
  max-height: calc(100vh - 360px);
  overflow-y: auto;
  padding: 12px;
  background: #f8fafc;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-row {
  display: flex;
}

.chat-row.user {
  justify-content: flex-end;
}

.chat-row.assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 90%;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.7;
}

.chat-row.user .chat-bubble {
  background: #3182ce;
  color: #fff;
}

.chat-row.assistant .chat-bubble {
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #1a202c;
}

.dialog-actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}

.dialog-input-wrap {
  margin-top: 10px;
  display: flex;
  gap: 10px;
}

.dialog-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  font-size: 14px;
}

@media (max-width: 1024px) {
  .main-layout {
    grid-template-columns: 1fr;
  }

  .original-panel,
  .explanation-panel,
  .media-rail {
    grid-column: auto;
  }

  .media-rail {
    position: static;
    max-height: none;
  }
  
  .original-panel,
  .explanation-panel {
    max-height: none;
  }
}
</style>

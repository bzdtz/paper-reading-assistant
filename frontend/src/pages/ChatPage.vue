<template>
  <div class="chat-page">
    <header class="chat-header">
      <div class="header-left">
        <button class="back-btn" @click="goBack">← 返回</button>
        <h1 class="paper-title">{{ paper?.fileName || '论文对话' }}</h1>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="toggleSidebar">
          {{ showSidebar ? '📚 隐藏目录' : '📚 显示目录' }}
        </button>
        <button class="action-btn" @click="openMindMap">🧠 打开导图</button>
        <button class="action-btn" @click="goSettings">⚙ API 设置</button>
        <button class="action-btn" @click="handleTranslateAll" :disabled="translatingAll">
          {{ translatingAll ? '翻译中...' : '📝 翻译全文' }}
        </button>
        <button class="action-btn" @click="startNewSession">💬 新对话</button>
      </div>
    </header>

    <div class="main-content">
      <aside v-if="showSidebar" class="sidebar">
        <div class="sidebar-header">
          <h3>📖 论文结构</h3>
          <span class="section-count">{{ sections.length }} 章</span>
        </div>
        <div class="sidebar-tree">
          <div v-for="section in sections" :key="section.id" class="sidebar-section">
            <div class="section-title-row" @click="toggleSection(section.id)">
              <span class="expand-icon">{{ expandedSections.has(section.id) ? '▼' : '▶' }}</span>
              <span class="section-name">{{ section.title }}</span>
              <span class="para-count">{{ section.paragraphs?.length || 0 }} 段</span>
            </div>
            <div v-show="expandedSections.has(section.id)" class="section-paragraphs">
              <div v-for="para in section.paragraphs" :key="para.id" class="sidebar-para">
                <span class="para-num">#{{ para.order }}</span>
                <span class="para-preview">{{ previewText(para.originalText || para.text, 30) }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="messages-container" ref="messagesContainer">
        <div v-if="messages.length === 0" class="welcome-screen">
          <div class="welcome-icon">💬</div>
          <h2>与论文对话</h2>
          <p>输入你的问题，AI 会结合论文内容为你解答</p>
          <div class="suggested-questions">
            <button
              v-for="q in suggestedQuestions"
              :key="q"
              class="question-chip"
              @click="inputMessage = q"
            >
              {{ q }}
            </button>
          </div>
        </div>

        <div v-else class="messages-list">
          <div v-for="(msg, index) in messages" :key="index" class="message-wrapper" :class="msg.role">
            <div v-if="msg.role === 'user'" class="message-bubble user-bubble">
              {{ msg.content }}
            </div>
            <div v-else class="message-bubble assistant-bubble">
              <div class="message-content markdown-body" v-html="renderMarkdown(msg.content)"></div>
            </div>
          </div>

          <div v-if="loading" class="message-wrapper assistant">
            <div class="message-bubble assistant-bubble loading-bubble">
              <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="media-rail">
        <div class="media-rail-head">🧩 非文字信息（{{ relatedFigures.length }}）</div>

        <div v-if="activeMediaItem" class="media-viewer">
          <button class="media-nav-btn" :disabled="relatedFigures.length <= 1" @click="showPrevMedia">◀</button>

          <div class="media-stage-wrap">
            <transition name="media-fade" mode="out-in">
              <div
                :key="`stage-${activeMediaItem.key}-${canPreviewMedia(activeMediaItem) ? 'ok' : 'empty'}`"
                class="media-stage"
                :class="{ clickable: canPreviewMedia(activeMediaItem) }"
                @click="openMediaPreview(activeMediaItem)"
              >
                <img
                  v-if="canPreviewMedia(activeMediaItem)"
                  :src="activeMediaItem.url"
                  :alt="activeMediaItem.caption || '非文字内容'"
                  loading="lazy"
                  @error="handleMediaError(activeMediaItem.key)"
                />
                <div v-else class="media-stage-empty">
                  <div class="media-stage-empty-icon">{{ activeMediaItem.icon || '🧩' }}</div>
                  <div class="media-stage-empty-text">{{ activeMediaItem.placeholderText || '暂无可预览内容' }}</div>
                </div>
              </div>
            </transition>

            <button
              v-if="canPreviewMedia(activeMediaItem)"
              class="media-zoom-btn"
              @click="openMediaPreview(activeMediaItem)"
            >
              点击放大查看
            </button>

            <transition name="media-fade" mode="out-in">
              <div class="media-stage-meta" :key="`meta-${activeMediaItem.key}`">
                <div class="media-stage-title">{{ activeMediaTypeLabel }}</div>
                <div v-if="activeMediaDisplayDesc" class="media-stage-desc">{{ activeMediaDisplayDesc }}</div>
              </div>
            </transition>
          </div>

          <button class="media-nav-btn" :disabled="relatedFigures.length <= 1" @click="showNextMedia">▶</button>
        </div>

        <div v-else class="media-viewer-empty">暂无可展示的非文字内容</div>

        <div class="media-chat-panel">
          <div class="media-chat-head">🗣 非文字内容讲解</div>
          <div class="media-chat-body" ref="mediaChatContainerRef">
            <div
              v-for="(item, index) in mediaChatMessages"
              :key="index"
              :class="['media-chat-row', item.role]"
            >
              <div class="media-chat-bubble markdown-body" v-html="renderMarkdown(item.content)"></div>
            </div>
          </div>
          <div class="media-chat-input-wrap">
            <input
              v-model="mediaChatInput"
              class="media-chat-input"
              placeholder="问图表：例如 这张图要说明什么？"
              :disabled="isSendingMediaChat"
              @keyup.enter="sendMediaChat"
            />
            <button
              class="media-chat-send-btn"
              :disabled="isSendingMediaChat || !mediaChatInput.trim()"
              @click="sendMediaChat"
            >
              {{ isSendingMediaChat ? '发送中...' : '发送' }}
            </button>
          </div>
        </div>
      </aside>
    </div>

    <div
      v-if="isMediaModalOpen && previewMediaItem && canPreviewMedia(previewMediaItem)"
      class="media-modal"
      @click.self="closeMediaPreview"
    >
      <button class="media-modal-close" @click="closeMediaPreview">×</button>
      <img class="media-modal-image" :src="previewMediaItem.url" :alt="previewMediaItem.caption || '非文字内容大图'" />
      <div class="media-modal-meta">
        <div class="media-modal-title">{{ activeMediaTypeLabel }}</div>
        <div v-if="activeMediaDisplayDesc" class="media-modal-desc">{{ activeMediaDisplayDesc }}</div>
      </div>
    </div>

    <div class="input-area">
      <div class="input-container">
        <textarea
          v-model="inputMessage"
          class="message-input"
          placeholder="输入你的问题..."
          @keydown.enter.exact.prevent="sendMessage"
          :disabled="loading"
          rows="1"
        ></textarea>
        <button class="send-btn" @click="sendMessage" :disabled="!inputMessage.trim() || loading">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
          </svg>
        </button>
      </div>
      <div class="input-hint">Enter 发送，Shift + Enter 换行</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createMarkdownRenderer } from '../utils/markdown';
import {
  createChatSession,
  getSessionMessages,
  sendMessage as apiSendMessage,
  translateAllParagraphs,
  getPaperDetail,
  getPaperNonTextItems
} from '../services/chatApi';

const route = useRoute();
const router = useRouter();
const { md, render: renderMarkdown } = createMarkdownRenderer();
const apiBaseUrl = (process.env.VUE_APP_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const paperId = ref(route.params.id);
const paper = ref(null);
const sessionId = ref('');
const mediaSessionId = ref('');
const messages = ref([]);
const inputMessage = ref('');
const loading = ref(false);
const translatingAll = ref(false);
const messagesContainer = ref(null);
const failedMediaKeys = ref(new Set());
const localNonTextItems = ref([]);
const activeMediaIndex = ref(0);
const isMediaModalOpen = ref(false);
const previewMediaItem = ref(null);

const mediaChatMessages = ref([]);
const mediaChatInput = ref('');
const isSendingMediaChat = ref(false);
const mediaChatContainerRef = ref(null);

const showSidebar = ref(true);
const expandedSections = ref(new Set());
const sections = ref([]);

const suggestedQuestions = [
  '这篇论文的主要贡献是什么？',
  '论文使用了什么方法？',
  '实验结果如何？',
  '这篇论文的创新点在哪里？'
];

const createInitialMediaChatMessages = () => ([
  {
    role: 'assistant',
    content: '你可以针对右侧当前非文字内容提问，例如：这张图想说明什么？'
  }
]);

mediaChatMessages.value = createInitialMediaChatMessages();

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
  return `${apiBaseUrl}/mineru-results/${paperId.value}/${normalizedSrc}`;
};

md.renderer.rules.image = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const srcIndex = token.attrIndex('src');
  if (srcIndex >= 0) {
    token.attrs[srcIndex][1] = toAbsoluteMediaUrl(token.attrs[srcIndex][1] || '');
  }
  return self.renderToken(tokens, index, options);
};

const extractImageEntries = (text) => {
  const content = String(text || '');
  const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
  const images = [];
  let match;

  while ((match = imageRegex.exec(content)) !== null) {
    images.push({
      caption: String(match[1] || '').trim(),
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

const relatedFigures = computed(() => {
  const output = [];
  const seen = new Set();
  const seenImageSrc = new Set();
  const seenFigureNo = new Set();
  const mentionedFigureNos = new Set();
  const mentionedTableNos = new Set();

  const pushUnique = (item) => {
    if (!item || seen.has(item.key)) {
      return;
    }
    seen.add(item.key);
    output.push(item);
  };

  for (const item of localNonTextItems.value || []) {
    const normalizedUrl = toAbsoluteMediaUrl(item.url || item.relativePath || item.fileName || '');
    if (normalizedUrl) {
      seenImageSrc.add(normalizedUrl);
    }

    pushUnique({
      key: String(item.key || item.relativePath || item.fileName || `local-${output.length}`),
      mineruName: String(item.mineruName || item.caption || item.fileName || '').trim(),
      mineruType: String(item.mineruType || item.type || '').trim(),
      fileName: String(item.fileName || '').trim(),
      relativePath: String(item.relativePath || '').trim(),
      icon: item.icon || '🖼',
      caption: item.caption || item.fileName || '图片',
      url: normalizedUrl,
      placeholderText: item.placeholderText || '本地图片预览不可用',
      explanation: sanitizeMediaExplanation(item.explanation) || '来源：论文非文字内容'
    });
  }

  // 优先使用后端提供的本地非文字顺序，避免再拼接占位引用导致顺序和编号混乱。
  if (output.length > 0) {
    return output;
  }

  for (const section of sections.value || []) {
    for (const para of section.paragraphs || []) {
      const content = String(para.originalText || para.text || '');
      const sectionLabel = `${section.title || '未知章节'} · 第 ${para.order || '-'} 段`;

      extractImageEntries(content).forEach((img) => {
        const figureNoMatch = String(img.caption || '').match(/(?:fig(?:ure)?\.?|图)\s*([0-9]{1,3})/i);
        const figureNo = figureNoMatch ? Number(figureNoMatch[1]) : null;
        const normalizedSrc = String(img.src || '').trim().replace(/^\.\//, '').replace(/^\//, '');
        const absoluteUrl = toAbsoluteMediaUrl(img.src);

        if (!absoluteUrl || seenImageSrc.has(absoluteUrl)) {
          return;
        }

        seenImageSrc.add(absoluteUrl);
        if (figureNo) {
          seenFigureNo.add(figureNo);
        }

        pushUnique({
          key: `image-${normalizedSrc || absoluteUrl}`,
          mineruName: img.caption || `image-${output.length + 1}`,
          mineruType: 'image',
          icon: '🖼',
          caption: img.caption || (figureNo ? `Figure ${figureNo}` : '图片'),
          url: absoluteUrl,
          placeholderText: '未找到真实图片',
          explanation: `来源：${sectionLabel}`
        });
      });

      extractFigureRefs(content).forEach((number) => {
        mentionedFigureNos.add(number);
      });

      extractTableRefs(content).forEach((number) => {
        mentionedTableNos.add(number);
      });

      if (hasMarkdownTable(content)) {
        pushUnique({
          key: `table-markdown-${para.id}`,
          mineruName: 'table',
          mineruType: 'table',
          icon: '📊',
          caption: '表格（Markdown）',
          url: '',
          placeholderText: '当前为文本表格，暂无单独预览图',
          explanation: `来源：${sectionLabel}`
        });
      }
    }
  }

  Array.from(mentionedFigureNos)
    .sort((a, b) => a - b)
    .forEach((figureNo) => {
      if (seenFigureNo.has(figureNo)) {
        return;
      }
      pushUnique({
        key: `figure-ref-${figureNo}`,
        mineruName: `figure-${figureNo}`,
        mineruType: 'figure',
        icon: '🖼',
        caption: `Figure ${figureNo}`,
        url: '',
        placeholderText: '只识别到图号，暂无真实图片',
        explanation: `论文中提到 Figure ${figureNo}。`
      });
    });

  Array.from(mentionedTableNos)
    .sort((a, b) => a - b)
    .forEach((tableNo) => {
      pushUnique({
        key: `table-ref-${tableNo}`,
        mineruName: `table-${tableNo}`,
        mineruType: 'table',
        icon: '📊',
        caption: `Table ${tableNo}`,
        url: '',
        placeholderText: '已识别表号，暂无单独预览图',
        explanation: `论文中提到 Table ${tableNo}。`
      });
    });

  return output;
});

const activeMediaItem = computed(() => {
  const items = relatedFigures.value || [];
  if (!items.length) {
    return null;
  }
  const safeIndex = Math.min(Math.max(activeMediaIndex.value, 0), items.length - 1);
  return items[safeIndex] || null;
});

const cleanMediaText = (value, fallback) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const detectMediaTypeLabel = (item, fallbackIndex) => {
  const combinedText = [
    cleanMediaText(item?.caption, ''),
    cleanMediaText(item?.explanation, ''),
    cleanMediaText(item?.url, '')
  ].join(' ');

  const tableMatch = combinedText.match(/(?:table|tab\.?|表)\s*([0-9]{1,3})/i);
  if (tableMatch) {
    return `表格 ${tableMatch[1]}`;
  }

  const figureMatch = combinedText.match(/(?:fig(?:ure)?\.?|图|image)\s*([0-9]{1,3})/i);
  if (figureMatch) {
    return `图片 ${figureMatch[1]}`;
  }

  const order = Math.max(Number(fallbackIndex) + 1, 1);
  return item?.icon === '📊' ? `表格 ${order}` : `图片 ${order}`;
};

const activeMediaTypeLabel = computed(() => {
  const current = activeMediaItem.value;
  if (!current) {
    return '非文字内容';
  }

  const mineruName = cleanMediaText(current.mineruName, '');
  if (mineruName) {
    return mineruName;
  }

  const caption = cleanMediaText(current.caption, '');
  if (caption) {
    return caption;
  }

  const items = relatedFigures.value || [];
  const safeIndex = Math.min(Math.max(activeMediaIndex.value, 0), Math.max(items.length - 1, 0));
  return detectMediaTypeLabel(current, safeIndex);
});

const activeMediaDisplayDesc = computed(() => {
  return sanitizeMediaExplanation(activeMediaItem.value?.explanation);
});

const canPreviewMedia = (figure) => {
  return Boolean(String(figure?.url || '').trim()) && !failedMediaKeys.value.has(figure.key);
};

const handleMediaError = (key) => {
  if (!key) {
    return;
  }
  if (failedMediaKeys.value.has(key)) {
    return;
  }
  failedMediaKeys.value = new Set([...failedMediaKeys.value, key]);
};

const showPrevMedia = () => {
  const total = relatedFigures.value.length;
  if (!total) {
    return;
  }
  activeMediaIndex.value = (activeMediaIndex.value - 1 + total) % total;
};

const showNextMedia = () => {
  const total = relatedFigures.value.length;
  if (!total) {
    return;
  }
  activeMediaIndex.value = (activeMediaIndex.value + 1) % total;
};

const openMediaPreview = (item) => {
  if (!canPreviewMedia(item)) {
    return;
  }
  previewMediaItem.value = item;
  isMediaModalOpen.value = true;
};

const closeMediaPreview = () => {
  isMediaModalOpen.value = false;
  previewMediaItem.value = null;
};

const shouldIgnoreArrowNavigation = (event) => {
  const target = event?.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = String(target.tagName || '').toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
};

const handleGlobalKeydown = (event) => {
  if (event.key === 'Escape' && isMediaModalOpen.value) {
    event.preventDefault();
    closeMediaPreview();
    return;
  }

  if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || shouldIgnoreArrowNavigation(event)) {
    return;
  }

  if (relatedFigures.value.length <= 1) {
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showPrevMedia();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    showNextMedia();
  }
};

const scrollToBottom = async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
};

const scrollMediaChatBottom = async () => {
  await nextTick();
  if (mediaChatContainerRef.value) {
    mediaChatContainerRef.value.scrollTop = mediaChatContainerRef.value.scrollHeight;
  }
};

const toggleSidebar = () => {
  showSidebar.value = !showSidebar.value;
};

const toggleSection = (sectionId) => {
  if (expandedSections.value.has(sectionId)) {
    expandedSections.value.delete(sectionId);
  } else {
    expandedSections.value.add(sectionId);
  }
};

const previewText = (text, limit = 30) => {
  if (!text) return '';
  const clean = String(text).replace(/\n/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const goBack = () => {
  router.push('/upload-v2');
};

const openMindMap = () => {
  const paperIdValue = String(route.params.id || paperId.value || '').trim();
  if (!paperIdValue) {
    return;
  }

  const resolved = router.resolve({ name: 'mindmap', params: { id: paperIdValue } });
  window.open(resolved.href, '_blank', 'noopener,noreferrer');
};

const goSettings = () => {
  router.push('/settings');
};

const startNewSession = async () => {
  try {
    const response = await createChatSession(paperId.value);
    sessionId.value = response.sessionId;

    try {
      const mediaResponse = await createChatSession(paperId.value);
      mediaSessionId.value = mediaResponse.sessionId;
    } catch (mediaError) {
      console.warn('[ChatPage] 创建非文字会话失败，回退主会话:', mediaError);
      mediaSessionId.value = sessionId.value;
    }

    messages.value = [];
    inputMessage.value = '';
    mediaChatMessages.value = createInitialMediaChatMessages();
    mediaChatInput.value = '';
    activeMediaIndex.value = 0;
    closeMediaPreview();
    await scrollMediaChatBottom();
  } catch (error) {
    console.error('创建会话失败:', error);
  }
};

const extractAssistantContent = (response, fallbackText) => {
  let aiContent = '';

  if (typeof response === 'string') {
    aiContent = response;
  } else if (response && typeof response === 'object') {
    if (response.message) {
      aiContent = typeof response.message === 'string'
        ? response.message
        : (response.message.content || '');
    } else if (response.content) {
      aiContent = response.content;
    }
  }

  return String(aiContent || fallbackText);
};

const ensureMainSession = async () => {
  if (sessionId.value) {
    return true;
  }

  try {
    const response = await createChatSession(paperId.value);
    sessionId.value = response.sessionId;
    return true;
  } catch (error) {
    console.error('[ChatPage] 初始化主会话失败:', error);
    return false;
  }
};

const ensureMediaSession = async () => {
  if (mediaSessionId.value) {
    return true;
  }

  try {
    const response = await createChatSession(paperId.value);
    mediaSessionId.value = response.sessionId;
    return true;
  } catch (error) {
    console.error('[ChatPage] 初始化非文字会话失败:', error);
    return false;
  }
};

const sendMessage = async () => {
  const content = inputMessage.value.trim();
  if (!content || loading.value) return;

  const hasSession = await ensureMainSession();
  if (!hasSession) {
    messages.value.push({
      role: 'assistant',
      content: '抱歉，会话初始化失败，请稍后再试。'
    });
    await scrollToBottom();
    return;
  }

  messages.value.push({ role: 'user', content });
  inputMessage.value = '';
  loading.value = true;
  await scrollToBottom();

  try {
    const response = await apiSendMessage(paperId.value, sessionId.value, content);

    messages.value.push({
      role: 'assistant',
      content: extractAssistantContent(response, '抱歉，我没有理解你的问题。')
    });

    await scrollToBottom();
  } catch (error) {
    console.error('发送消息失败:', error);
    messages.value.push({
      role: 'assistant',
      content: '抱歉，出现了一些问题，请稍后再试。'
    });
  } finally {
    loading.value = false;
  }
};

const sendMediaChat = async () => {
  const question = mediaChatInput.value.trim();
  if (!question || isSendingMediaChat.value) {
    return;
  }

  const hasMediaSession = await ensureMediaSession();
  if (!hasMediaSession) {
    mediaChatMessages.value.push({
      role: 'assistant',
      content: '抱歉，非文字讲解会话初始化失败，请稍后再试。'
    });
    await scrollMediaChatBottom();
    return;
  }

  mediaChatMessages.value.push({ role: 'user', content: question });
  mediaChatInput.value = '';
  isSendingMediaChat.value = true;
  await scrollMediaChatBottom();

  try {
    const currentMedia = activeMediaItem.value;
    const currentMediaLabel = currentMedia ? activeMediaTypeLabel.value : '当前对象';
    const mediaDesc = sanitizeMediaExplanation(currentMedia?.explanation);

    const contextKeywords = [
      String(currentMedia?.mineruName || '').trim(),
      String(currentMedia?.caption || '').trim(),
      String(currentMedia?.fileName || '').trim(),
      String(currentMedia?.relativePath || '').trim()
    ].filter(Boolean);

    const relatedParagraphs = [];
    for (const section of sections.value || []) {
      for (const para of section.paragraphs || []) {
        const text = String(para.originalText || para.text || '').replace(/\s+/g, ' ').trim();
        if (!text) {
          continue;
        }

        const matched = contextKeywords.some((keyword) => {
          if (!keyword) {
            return false;
          }
          return text.toLowerCase().includes(keyword.toLowerCase());
        });

        if (matched) {
          relatedParagraphs.push(`- ${section.title} / 段落${para.order}: ${previewText(text, 180)}`);
        }

        if (relatedParagraphs.length >= 4) {
          break;
        }
      }

      if (relatedParagraphs.length >= 4) {
        break;
      }
    }

    const mediaContext = currentMedia
      ? [
        `当前锁定对象：${currentMediaLabel}`,
        `对象标识：${cleanMediaText(currentMedia.key, 'unknown')}`,
        `MinerU 名称：${cleanMediaText(currentMedia.mineruName, 'unknown')}`,
        `MinerU 类型：${cleanMediaText(currentMedia.mineruType, 'unknown')}`,
        `标题/文件名：${cleanMediaText(currentMedia.caption, '未命名内容')}`,
        `对象说明：${mediaDesc || '暂无对象说明'}`,
        `资源链接：${cleanMediaText(currentMedia.url, '无')}`
      ].join('\n')
      : '当前没有可展示的非文字内容。';

    const mediaPrompt = [
      '你是论文非文字内容讲解助手。',
      mediaContext,
      relatedParagraphs.length > 0 ? `相关上下文段落:\n${relatedParagraphs.join('\n')}` : '相关上下文段落：未检索到明确引用，请基于标题与说明谨慎回答。',
      '硬性要求：',
      '1) 只能解释当前锁定对象，禁止切换到其他图片或表格。',
      `2) 回答第一句必须是“当前解释对象：${currentMediaLabel}”。`,
      '3) 若信息不足，请明确说“当前信息不足以完整解释该对象”。',
      '4) 若是图表，必须说明：横轴、纵轴、关键曲线/柱形/颜色分别代表什么。',
      '5) 必须解释作者为什么选择这个非文字元素来展示结果，并指出它支撑了论文哪一条结论。',
      `用户问题：${question}`,
      '回答结构：先一句总体作用，再给关键细节，最后给与问题直接相关的结论。'
    ].join('\n\n');

    const response = await apiSendMessage(paperId.value, mediaSessionId.value, mediaPrompt);
    mediaChatMessages.value.push({
      role: 'assistant',
      content: extractAssistantContent(response, '抱歉，暂时无法完成该非文字内容讲解。')
    });
  } catch (error) {
    console.error('[ChatPage] 非文字问答失败:', error);
    mediaChatMessages.value.push({
      role: 'assistant',
      content: '抱歉，非文字内容讲解暂时不可用，请稍后重试。'
    });
  } finally {
    isSendingMediaChat.value = false;
    await scrollMediaChatBottom();
  }
};

const handleTranslateAll = async () => {
  translatingAll.value = true;
  try {
    const result = await translateAllParagraphs(paperId.value);
    console.log(`翻译完成: ${result.translated}/${result.total}`);

    if (sessionId.value) {
      const response = await getSessionMessages(paperId.value, sessionId.value);
      messages.value = response.messages.map((msg) => ({
        role: msg.role,
        content: String(msg.content || '')
      }));
    }
  } catch (error) {
    console.error('翻译失败:', error);
  } finally {
    translatingAll.value = false;
  }
};

const pollUntilReady = async (maxAttempts = 30) => {
  for (let i = 0; i < maxAttempts; i += 1) {
    const paperData = await getPaperDetail(paperId.value);
    const rawContent = JSON.parse(paperData.paper.rawContent || '{}');

    if (rawContent.status === 'completed') {
      paper.value = paperData.paper;
      sections.value = paperData.paper.sections || [];
      if (sections.value.length > 0) {
        expandedSections.value.add(sections.value[0].id);
      }
      return true;
    }

    if (rawContent.status === 'failed') {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return false;
};

const loadLocalNonTextItems = async () => {
  if (!paperId.value) {
    localNonTextItems.value = [];
    return;
  }

  try {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let items = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await getPaperNonTextItems(paperId.value);
      items = Array.isArray(response?.items) ? response.items : [];

      if (response?.orderMeta) {
        console.log('[ChatPage] 非文字排序元信息:', response.orderMeta);
      }

      if (items.length > 0 || attempt === 2) {
        break;
      }

      await wait(1000);
    }

    localNonTextItems.value = items;
    console.log(`[ChatPage] 本地非文字内容: ${localNonTextItems.value.length} 条`);
  } catch (error) {
    console.warn('[ChatPage] 获取本地非文字内容失败:', error);
    localNonTextItems.value = [];
  }
};

watch(
  relatedFigures,
  (items) => {
    if (!Array.isArray(items) || !items.length) {
      activeMediaIndex.value = 0;
      return;
    }

    if (activeMediaIndex.value >= items.length) {
      activeMediaIndex.value = 0;
    }
  },
  { immediate: true }
);

watch(activeMediaItem, (item) => {
  if (isMediaModalOpen.value && item) {
    previewMediaItem.value = item;
  }
  void scrollMediaChatBottom();
});

onMounted(async () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeydown);
  }

  try {
    const ready = await pollUntilReady();
    if (!ready) {
      const paperData = await getPaperDetail(paperId.value);
      paper.value = paperData.paper;
      sections.value = paperData.paper.sections || [];
    }

    await loadLocalNonTextItems();

    await startNewSession();
  } catch (error) {
    console.error('[ChatPage] 加载失败:', error);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown);
  }
});
</script>

<style scoped>
.chat-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

/* 顶部导航 */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  background: none;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.back-btn:hover {
  background: #f7fafc;
}

.paper-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #2d3748;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  padding: 8px 16px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: #f7fafc;
  border-color: #a0aec0;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 主内容区：左侧目录 + 右侧聊天 */
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.media-rail {
  width: 300px;
  min-width: 300px;
  border-left: 1px solid #e2e8f0;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.media-rail-head {
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 14px;
  font-weight: 700;
  color: #2d3748;
}

.media-viewer {
  flex: 1;
  min-height: 0;
  padding: 12px 10px 8px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.media-nav-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #cbd5e0;
  border-radius: 999px;
  background: #ffffff;
  color: #2d3748;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  transition: all 0.2s;
  flex-shrink: 0;
  align-self: center;
}

.media-nav-btn:hover:not(:disabled) {
  border-color: #3182ce;
  color: #2b6cb0;
  background: #ebf8ff;
}

.media-nav-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.media-stage-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.media-fade-enter-active,
.media-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.media-fade-enter-from,
.media-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.media-stage {
  display: block;
  width: 100%;
  min-height: clamp(150px, 24vh, 220px);
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  text-decoration: none;
  background: linear-gradient(160deg, #f8fafc 0%, #edf2f7 100%);
}

.media-stage.clickable {
  cursor: zoom-in;
}

.media-stage.clickable:hover {
  border-color: #90cdf4;
  box-shadow: 0 2px 10px rgba(49, 130, 206, 0.12);
}

.media-stage img {
  display: block;
  width: 100%;
  height: clamp(150px, 24vh, 220px);
  object-fit: contain;
  background: #f8fafc;
}

.media-stage-empty {
  width: 100%;
  min-height: clamp(150px, 24vh, 220px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #4a5568;
  padding: 16px;
}

.media-stage-empty-icon {
  font-size: 34px;
  line-height: 1;
}

.media-stage-empty-text {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
}

.media-stage-meta {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  padding: 10px;
}

.media-zoom-btn {
  border: 1px solid #90cdf4;
  border-radius: 8px;
  background: #ebf8ff;
  color: #2b6cb0;
  font-size: 12px;
  padding: 6px 10px;
  align-self: flex-start;
  cursor: pointer;
  transition: all 0.2s;
}

.media-zoom-btn:hover {
  background: #bee3f8;
  border-color: #63b3ed;
}

.media-stage-title {
  font-size: 13px;
  font-weight: 700;
  color: #2d3748;
}

.media-stage-desc {
  margin-top: 6px;
  font-size: 12px;
  color: #4a5568;
  line-height: 1.6;
  word-break: break-word;
}

.media-viewer-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #718096;
  font-size: 13px;
  padding: 18px 12px;
}

.media-chat-panel {
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 10px;
  display: flex;
  flex-direction: column;
  flex: 0 0 260px;
  min-height: 230px;
  max-height: 44%;
}

.media-chat-head {
  font-size: 13px;
  font-weight: 700;
  color: #2d3748;
  margin-bottom: 8px;
}

.media-chat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.media-chat-row {
  display: flex;
}

.media-chat-row.user {
  justify-content: flex-end;
}

.media-chat-row.assistant {
  justify-content: flex-start;
}

.media-chat-bubble {
  max-width: 88%;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
}

.media-chat-row.user .media-chat-bubble {
  background: #3182ce;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.media-chat-row.assistant .media-chat-bubble {
  background: #edf2f7;
  color: #2d3748;
  border-bottom-left-radius: 4px;
}

.media-chat-bubble :deep(p) {
  margin: 0 0 6px;
}

.media-chat-bubble :deep(p:last-child) {
  margin-bottom: 0;
}

.media-chat-input-wrap {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.media-chat-input {
  flex: 1;
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  transition: border-color 0.2s;
}

.media-chat-input:focus {
  outline: none;
  border-color: #3182ce;
}

.media-chat-input:disabled {
  background: #edf2f7;
}

.media-chat-send-btn {
  border: none;
  border-radius: 8px;
  background: #3182ce;
  color: #ffffff;
  padding: 0 14px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.media-chat-send-btn:hover:not(:disabled) {
  background: #2c5282;
}

.media-chat-send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.media-modal {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(15, 23, 42, 0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.media-modal-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #1a202c;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.media-modal-image {
  max-width: min(92vw, 1100px);
  max-height: 76vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}

.media-modal-meta {
  margin-top: 12px;
  max-width: min(92vw, 1100px);
  width: 100%;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 10px;
  padding: 10px 12px;
}

.media-modal-title {
  font-size: 13px;
  font-weight: 700;
  color: #1a202c;
}

.media-modal-desc {
  margin-top: 6px;
  font-size: 12px;
  color: #2d3748;
  line-height: 1.6;
}

/* 左侧：论文章节框架 */
.sidebar {
  width: 320px;
  min-width: 320px;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
}

.sidebar-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #2d3748;
}

.section-count {
  font-size: 12px;
  color: #718096;
  background: #ffffff;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.outline-mode-btn {
  border: 1px solid #cbd5e0;
  background: #ffffff;
  color: #2d3748;
  border-radius: 999px;
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}

.outline-mode-btn:hover {
  border-color: #3182ce;
  color: #2b6cb0;
}

.sidebar-tree {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.mindmap-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mind-node {
  border: 1px solid #d7e2ee;
  border-radius: 10px;
  background: #ffffff;
  padding: 10px;
}

.mind-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.mind-node-title {
  font-size: 13px;
  font-weight: 700;
  color: #1e3a5f;
}

.mind-node-meta {
  font-size: 11px;
  color: #5a6f86;
  border: 1px solid #d5deea;
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.mind-node-branches {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mind-branch {
  border-left: 2px solid #9dc5eb;
  padding-left: 8px;
  font-size: 12px;
  color: #3f5771;
  line-height: 1.5;
}

.mind-more {
  font-size: 11px;
  color: #6a7f96;
  padding-left: 10px;
}

.sidebar-section {
  margin-bottom: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.section-title-row {
  padding: 10px 12px;
  background: #f7fafc;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s;
}

.section-title-row:hover {
  background: #edf2f7;
}

.expand-icon {
  font-size: 10px;
  color: #a0aec0;
  width: 12px;
}

.section-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #2d3748;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.para-count {
  font-size: 11px;
  color: #718096;
  white-space: nowrap;
}

.section-paragraphs {
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
  max-height: 300px;
  overflow-y: auto;
}

.sidebar-para {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 12px;
  transition: background 0.2s;
}

.sidebar-para:last-child {
  border-bottom: none;
}

.sidebar-para:hover {
  background: #f7fafc;
}

.sidebar-para.translated {
  background: #f0fff4;
}

.para-num {
  font-weight: 600;
  color: #3182ce;
  white-space: nowrap;
}

.para-preview {
  flex: 1;
  color: #4a5568;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.translated-icon {
  font-size: 12px;
  white-space: nowrap;
}

/* 消息列表 */
.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  min-width: 0; /* 防止 flex 子项溢出 */
}

/* 欢迎屏幕 */
.welcome-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #718096;
}

.welcome-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.welcome-screen h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #2d3748;
}

.welcome-screen p {
  margin: 0 0 24px;
  font-size: 16px;
}

.suggested-questions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  max-width: 600px;
}

.question-chip {
  padding: 8px 16px;
  border: 1px solid #cbd5e0;
  border-radius: 20px;
  background: white;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.question-chip:hover {
  background: #edf2f7;
  border-color: #a0aec0;
}

/* 消息列表 */
.messages-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 900px;
  margin: 0 auto;
}

.message-wrapper {
  display: flex;
}

.message-wrapper.user {
  justify-content: flex-end;
}

.message-wrapper.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 80%;
  padding: 16px 20px;
  border-radius: 12px;
  line-height: 1.6;
}

.user-bubble {
  background: #3182ce;
  color: white;
  border-bottom-right-radius: 4px;
}

.assistant-bubble {
  background: white;
  color: #2d3748;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.message-content {
  margin-bottom: 16px;
}

.message-content :deep(p) {
  margin: 0 0 8px;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

/* 加载动画 */
.loading-bubble {
  padding: 12px 20px;
}

.loading-dots {
  display: flex;
  gap: 4px;
}

.loading-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a0aec0;
  animation: bounce 1.4s infinite ease-in-out;
}

.loading-dots span:nth-child(1) {
  animation-delay: -0.32s;
}

.loading-dots span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

/* 原文引用区域容器 */
.paragraph-references {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 2px dashed #cbd5e0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 折叠卡片 */
.paragraph-card {
  border: 1px solid #cbd5e0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
  transition: all 0.2s;
}

.paragraph-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  border-color: #a0aec0;
}

/* 折叠标题栏 */
.card-summary {
  padding: 12px 16px;
  background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  list-style: none;
  user-select: none;
}

.card-summary::-webkit-details-marker {
  display: none;
}

.summary-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-title {
  font-weight: 700;
  color: #2d3748;
  font-size: 13px;
}

.para-index {
  font-size: 12px;
  color: #718096;
  background: #ffffff;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.toggle-icon {
  font-size: 12px;
  color: #a0aec0;
  transition: transform 0.2s ease;
}

.paragraph-card[open] .toggle-icon {
  transform: rotate(90deg);
}

/* 翻译按钮 */
.translate-btn {
  padding: 4px 12px;
  border: 1px solid #3182ce;
  border-radius: 16px;
  background: #ffffff;
  color: #3182ce;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s;
  white-space: nowrap;
}

.translate-btn:hover:not(:disabled) {
  background: #3182ce;
  color: #ffffff;
}

.translate-btn.has-translation {
  border-color: #38a169;
  color: #38a169;
}

.translate-btn.has-translation:hover {
  background: #38a169;
  color: #ffffff;
}

.translate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 翻译提示 */
.translate-hint {
  padding: 12px;
  text-align: center;
  color: #a0aec0;
  font-size: 13px;
  font-style: italic;
  background: #f7fafc;
  border-radius: 6px;
  margin-top: 8px;
}

/* 逐行对照内容区 */
.line-by-line {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.triad-block {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  background: #ffffff;
}

.triad-title {
  font-size: 12px;
  font-weight: 700;
  color: #718096;
  margin-bottom: 8px;
}

.line-group {
  border-bottom: 1px dashed #e2e8f0;
  padding-bottom: 10px;
}

.line-group:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.en-line {
  margin: 0 0 4px;
  color: #1a202c;
  font-size: 15px;
  line-height: 1.6;
  font-weight: 500;
}

.zh-line {
  margin: 0;
  color: #4a5568;
  font-size: 15px;
  line-height: 1.6;
}

/* 图片/表格自适应 */
.inline-img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 8px 0;
}

.line-group :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 14px;
}

.line-group :deep(th), .line-group :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  text-align: left;
}

.line-group :deep(th) {
  background: #f7fafc;
  font-weight: 600;
}

/* 输入区域 */
.input-area {
  padding: 16px 24px;
  background: white;
  border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.input-container {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  max-width: 900px;
  margin: 0 auto;
}

.message-input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  min-height: 44px;
  max-height: 120px;
  transition: border-color 0.2s;
}

.message-input:focus {
  outline: none;
  border-color: #3182ce;
}

.message-input:disabled {
  background: #f7fafc;
}

.send-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 8px;
  background: #3182ce;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: #2c5282;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-hint {
  text-align: center;
  margin-top: 8px;
  font-size: 12px;
  color: #a0aec0;
}

@media (max-width: 1200px) {
  .sidebar {
    width: 280px;
    min-width: 280px;
  }

  .media-rail {
    width: 280px;
    min-width: 280px;
  }
}

@media (max-width: 900px) {
  .chat-header {
    padding: 12px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .header-actions {
    width: 100%;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .main-content {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    min-width: 0;
    max-height: 220px;
    border-right: none;
    border-bottom: 1px solid #e2e8f0;
  }

  .media-rail {
    width: 100%;
    min-width: 0;
    max-height: 430px;
    border-left: none;
    border-top: 1px solid #e2e8f0;
  }

  .media-viewer {
    padding: 10px 6px;
  }

  .media-chat-panel {
    flex-basis: 200px;
    min-height: 180px;
    max-height: 52%;
  }

  .media-stage,
  .media-stage img,
  .media-stage-empty {
    min-height: 180px;
    height: 180px;
  }

  .input-area {
    padding: 12px;
  }
}
</style>

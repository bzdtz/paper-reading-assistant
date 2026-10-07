<template>
  <main class="mindmap-page">
    <header class="mindmap-header">
      <div class="header-left">
        <button class="back-btn" @click="goBack">← 返回对话</button>
        <h1>双语思维导图</h1>
        <p>中心是论文主题，分支是章节，叶子是段落要点（中文优先，英文保留）。</p>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="openChat">打开对话页</button>
        <button class="action-btn primary" @click="fillChineseMap" :disabled="isFillingChinese || !missingTranslationCount">
          {{ isFillingChinese ? `补全中 ${filledTranslationCount}/${missingTranslationCount}` : `一键补全中文（${missingTranslationCount}）` }}
        </button>
      </div>
    </header>

    <section class="mindmap-stage">
      <div class="mindmap-canvas">
        <div class="root-node">
          <div class="root-cn">{{ paperTitleZh }}</div>
          <div class="root-en">{{ paperTitleEn }}</div>
          <div class="root-meta">{{ sections.length }} 章 · {{ totalParagraphCount }} 段</div>
        </div>

        <div class="branches branches-left">
          <article
            v-for="branch in leftBranches"
            :key="branch.id"
            class="branch"
            :class="`c-${branch.colorIndex}`"
          >
            <button class="section-node" @click="toggleSectionExpand(branch.id)">
              <span class="section-cn">{{ branch.titleZh }}</span>
              <span class="section-en">{{ branch.titleEn }}</span>
            </button>

            <div class="leaf-list">
              <button
                v-for="leaf in branch.visibleLeaves"
                :key="leaf.id"
                class="leaf-node"
                @click="activeParagraphId = leaf.id"
              >
                <span class="leaf-cn">{{ leaf.zh }}</span>
                <span class="leaf-en">{{ leaf.en }}</span>
              </button>
              <button
                v-if="branch.hiddenLeafCount > 0"
                class="leaf-toggle"
                @click="toggleSectionExpand(branch.id)"
              >
                {{ expandedSectionIds.has(branch.id) ? '收起' : `查看更多 ${branch.hiddenLeafCount} 条` }}
              </button>
            </div>
          </article>
        </div>

        <div class="branches branches-right">
          <article
            v-for="branch in rightBranches"
            :key="branch.id"
            class="branch"
            :class="`c-${branch.colorIndex}`"
          >
            <button class="section-node" @click="toggleSectionExpand(branch.id)">
              <span class="section-cn">{{ branch.titleZh }}</span>
              <span class="section-en">{{ branch.titleEn }}</span>
            </button>

            <div class="leaf-list">
              <button
                v-for="leaf in branch.visibleLeaves"
                :key="leaf.id"
                class="leaf-node"
                @click="activeParagraphId = leaf.id"
              >
                <span class="leaf-cn">{{ leaf.zh }}</span>
                <span class="leaf-en">{{ leaf.en }}</span>
              </button>
              <button
                v-if="branch.hiddenLeafCount > 0"
                class="leaf-toggle"
                @click="toggleSectionExpand(branch.id)"
              >
                {{ expandedSectionIds.has(branch.id) ? '收起' : `查看更多 ${branch.hiddenLeafCount} 条` }}
              </button>
            </div>
          </article>
        </div>
      </div>

      <aside class="inspector" v-if="activeParagraph">
        <div class="inspector-head">当前节点</div>
        <div class="inspector-section">{{ activeSection?.title || '未分组章节' }}</div>
        <div class="inspector-block">
          <div class="inspector-title">中文</div>
          <div class="inspector-text">{{ activeParagraphZh || '暂无中文，点击上方“一键补全中文”。' }}</div>
        </div>
        <div class="inspector-block">
          <div class="inspector-title">English</div>
          <div class="inspector-text" v-html="renderMarkdown(activeParagraph.originalText || activeParagraph.text || '')"></div>
        </div>
      </aside>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { createMarkdownRenderer } from '../utils/markdown';
import { getPaperDetail, translateParagraph } from '../services/paperApiV2';

const route = useRoute();
const router = useRouter();
const { render: renderMarkdown } = createMarkdownRenderer();

const paper = ref(null);
const sections = ref([]);
const activeParagraphId = ref('');
const expandedSectionIds = ref(new Set());
const translatedMap = ref({});
const isFillingChinese = ref(false);
const filledTranslationCount = ref(0);

const colorCount = 6;
const previewLeafLimit = 3;

const totalParagraphCount = computed(() => sections.value.reduce((total, section) => total + (section.paragraphs?.length || 0), 0));

const paperTitleEn = computed(() => paper.value?.fileName || 'Paper');
const paperTitleZh = computed(() => `论文导图：${(paper.value?.fileName || '未命名论文').replace(/\.[^.]+$/, '')}`);

const allParagraphs = computed(() => sections.value.flatMap((section) => section.paragraphs || []));

const activeSection = computed(() => {
  return sections.value.find((section) => section.paragraphs?.some((paragraph) => paragraph.id === activeParagraphId.value)) || null;
});

const activeParagraph = computed(() => {
  if (!activeSection.value || !activeParagraphId.value) {
    return null;
  }
  return activeSection.value.paragraphs.find((paragraph) => paragraph.id === activeParagraphId.value) || null;
});

const activeParagraphZh = computed(() => {
  if (!activeParagraph.value) {
    return '';
  }
  return getParagraphChinese(activeParagraph.value);
});

const cleanText = (text) => String(text || '').replace(/\s+/g, ' ').replace(/^#+\s*/g, '').trim();

const previewText = (text, limit = 58) => {
  const clean = cleanText(text);
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const sectionTitleZh = (title, index) => {
  const clean = cleanText(title);
  if (!clean) {
    return `第 ${index + 1} 章`;
  }
  const known = [
    [/introduction/i, '引言'],
    [/related work/i, '相关工作'],
    [/method/i, '方法'],
    [/experiment/i, '实验'],
    [/result/i, '结果'],
    [/discussion/i, '讨论'],
    [/conclusion/i, '结论'],
    [/appendix/i, '附录']
  ];
  for (const [pattern, zh] of known) {
    if (pattern.test(clean)) {
      return `${zh}`;
    }
  }
  return `第 ${index + 1} 章`;
};

const getParagraphChinese = (paragraph) => {
  const pid = String(paragraph?.id || '');
  const fromMap = translatedMap.value[pid];
  if (fromMap) {
    return previewText(fromMap, 78);
  }
  const translation = paragraph?.translations?.[0]?.content;
  if (translation) {
    return previewText(translation, 78);
  }
  return '';
};

const buildBranch = (section, index) => {
  const leaves = (section.paragraphs || []).map((paragraph) => {
    const en = previewText(paragraph.originalText || paragraph.text || '', 66);
    const zh = getParagraphChinese(paragraph) || '点击“一键补全中文”生成';
    return {
      id: paragraph.id,
      zh,
      en
    };
  });

  const expanded = expandedSectionIds.value.has(section.id);
  const visibleLeaves = expanded ? leaves : leaves.slice(0, previewLeafLimit);
  const hiddenLeafCount = Math.max(0, leaves.length - visibleLeaves.length);

  return {
    id: section.id,
    colorIndex: index % colorCount,
    titleZh: sectionTitleZh(section.title, index),
    titleEn: cleanText(section.title) || `Section ${index + 1}`,
    visibleLeaves,
    hiddenLeafCount
  };
};

const branches = computed(() => sections.value.map((section, index) => buildBranch(section, index)));
const leftBranches = computed(() => branches.value.filter((_, index) => index % 2 === 0));
const rightBranches = computed(() => branches.value.filter((_, index) => index % 2 === 1));

const missingTranslationCount = computed(() => {
  let count = 0;
  for (const paragraph of allParagraphs.value) {
    const pid = String(paragraph.id || '');
    if (!translatedMap.value[pid] && !paragraph?.translations?.[0]?.content) {
      count += 1;
    }
  }
  return count;
});

const toggleSectionExpand = (sectionId) => {
  const next = new Set(expandedSectionIds.value);
  if (next.has(sectionId)) {
    next.delete(sectionId);
  } else {
    next.add(sectionId);
  }
  expandedSectionIds.value = next;
};

const goBack = () => {
  router.back();
};

const openChat = () => {
  const paperId = String(route.params.id || '');
  if (!paperId) {
    return;
  }
  router.push(`/chat/${paperId}`);
};

const runTranslateTask = async (queue, limit, worker) => {
  let cursor = 0;
  const runners = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (cursor < queue.length) {
      const task = queue[cursor];
      cursor += 1;
      await worker(task);
    }
  });
  await Promise.all(runners);
};

const fillChineseMap = async () => {
  if (isFillingChinese.value) {
    return;
  }
  const queue = allParagraphs.value
    .filter((paragraph) => {
      const pid = String(paragraph.id || '');
      return pid && !translatedMap.value[pid] && !paragraph?.translations?.[0]?.content;
    })
    .map((paragraph) => ({ id: String(paragraph.id) }));

  if (!queue.length) {
    return;
  }

  isFillingChinese.value = true;
  filledTranslationCount.value = 0;

  try {
    await runTranslateTask(queue, 2, async (task) => {
      try {
        const response = await translateParagraph(task.id);
        const text = cleanText(response?.translation?.content || '');
        if (text) {
          translatedMap.value = {
            ...translatedMap.value,
            [task.id]: text
          };
        }
      } catch (_error) {
        // 忽略单段失败，继续补全其他段落。
      } finally {
        filledTranslationCount.value += 1;
      }
    });
  } finally {
    isFillingChinese.value = false;
  }
};

onMounted(async () => {
  const paperId = String(route.params.id || '');
  if (!paperId) {
    return;
  }

  const response = await getPaperDetail(paperId);
  paper.value = response.paper || null;
  sections.value = response.paper?.sections || [];

  const firstParagraph = sections.value.find((section) => section.paragraphs?.length)?.paragraphs?.[0];
  if (firstParagraph) {
    activeParagraphId.value = firstParagraph.id;
  }
});
</script>

<style scoped>
.mindmap-page {
  min-height: 100vh;
  padding: 24px;
  color: var(--ink-1);
  background:
    radial-gradient(circle at 20% 15%, rgba(95, 173, 255, 0.13), transparent 36%),
    radial-gradient(circle at 80% 85%, rgba(255, 133, 97, 0.12), transparent 42%),
    repeating-radial-gradient(circle at center, rgba(104, 119, 142, 0.085) 0 1px, transparent 1px 26px),
    var(--surface-0, #f7f8fc);
}

.mindmap-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.header-left h1 {
  margin: 10px 0 4px;
  font-size: clamp(24px, 3.5vw, 36px);
  letter-spacing: 0.01em;
}

.header-left p {
  margin: 0;
  color: var(--ink-2);
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.back-btn,
.action-btn {
  border: 1px solid rgba(58, 81, 111, 0.25);
  background: rgba(255, 255, 255, 0.92);
  color: var(--ink-1);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  font-weight: 600;
}

.action-btn.primary {
  background: linear-gradient(120deg, #2b7fff, #38b2ac);
  color: #fff;
  border: 0;
}

.action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.mindmap-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;
}

.mindmap-canvas {
  position: relative;
  min-height: 620px;
  border: 1px solid rgba(45, 67, 96, 0.12);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(4px);
  box-shadow: 0 18px 44px rgba(27, 39, 58, 0.08);
  padding: 28px;
  display: grid;
  grid-template-columns: 1fr 280px 1fr;
  column-gap: 12px;
}

.root-node {
  grid-column: 2;
  justify-self: center;
  align-self: center;
  width: min(280px, 90%);
  border-radius: 999px;
  border: 2px solid #374c9b;
  background: linear-gradient(135deg, #293a8f, #4f2f8a);
  color: #fff;
  text-align: center;
  padding: 16px 20px;
  box-shadow: 0 14px 30px rgba(50, 57, 125, 0.22);
}

.root-cn {
  font-size: 18px;
  font-weight: 800;
  line-height: 1.3;
}

.root-en {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.92;
  line-height: 1.4;
  word-break: break-word;
}

.root-meta {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.86;
}

.branches {
  display: grid;
  gap: 14px;
  align-content: start;
}

.branches-left {
  grid-column: 1;
  padding-top: 8px;
}

.branches-right {
  grid-column: 3;
  padding-top: 40px;
}

.branch {
  position: relative;
  display: grid;
  gap: 8px;
}

.section-node {
  position: relative;
  border: 2px solid var(--branch-color, #2b7fff);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 999px;
  padding: 8px 14px;
  text-align: left;
  cursor: pointer;
  width: fit-content;
  max-width: min(330px, 100%);
}

.branches-left .section-node {
  justify-self: end;
}

.section-node::before {
  content: '';
  position: absolute;
  top: 50%;
  width: 52px;
  height: 38px;
  border-top: 3px solid var(--branch-color, #2b7fff);
  transform: translateY(-50%);
}

.branches-left .section-node::before {
  right: -52px;
  border-radius: 0 999px 0 0;
}

.branches-right .section-node::before {
  left: -52px;
  border-radius: 999px 0 0 0;
}

.section-cn {
  display: block;
  font-size: 15px;
  font-weight: 800;
  color: #182136;
}

.section-en {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #5f6e85;
}

.leaf-list {
  display: grid;
  gap: 8px;
}

.branches-left .leaf-list {
  justify-items: end;
}

.leaf-node,
.leaf-toggle {
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  width: min(340px, 100%);
}

.leaf-node {
  position: relative;
  padding: 2px 0;
}

.leaf-node::before {
  content: '';
  position: absolute;
  top: 50%;
  width: 24px;
  height: 16px;
  border-top: 2px solid color-mix(in srgb, var(--branch-color, #2b7fff) 65%, #fff);
  transform: translateY(-50%);
}

.branches-left .leaf-node::before {
  right: -24px;
  border-radius: 0 999px 0 0;
}

.branches-right .leaf-node::before {
  left: -24px;
  border-radius: 999px 0 0 0;
}

.leaf-cn {
  display: block;
  color: #1b2740;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.leaf-en {
  display: block;
  color: #66758c;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.35;
}

.leaf-toggle {
  color: #2f6fda;
  font-size: 12px;
  font-weight: 700;
}

.branch.c-0 { --branch-color: #2b7fff; }
.branch.c-1 { --branch-color: #8b5cf6; }
.branch.c-2 { --branch-color: #ff5a6b; }
.branch.c-3 { --branch-color: #00a988; }
.branch.c-4 { --branch-color: #f59e0b; }
.branch.c-5 { --branch-color: #16a3c7; }

.inspector {
  border: 1px solid rgba(45, 67, 96, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 26px rgba(26, 37, 59, 0.08);
  padding: 14px 16px;
  position: sticky;
  top: 16px;
}

.inspector-head {
  font-size: 12px;
  color: var(--ink-2);
  font-weight: 700;
}

.inspector-section {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 800;
  color: #182136;
}

.inspector-block {
  margin-top: 12px;
}

.inspector-title {
  font-size: 12px;
  font-weight: 700;
  color: #51627d;
}

.inspector-text {
  margin-top: 4px;
  color: #1d2a44;
  font-size: 13px;
  line-height: 1.65;
}

.inspector-text :deep(p) {
  margin: 0 0 8px;
}

@media (max-width: 1280px) {
  .mindmap-stage {
    grid-template-columns: minmax(0, 1fr);
  }

  .inspector {
    position: static;
  }
}

@media (max-width: 980px) {
  .mindmap-page {
    padding: 14px;
  }

  .mindmap-header {
    flex-direction: column;
  }

  .mindmap-canvas {
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
    row-gap: 12px;
    padding: 14px;
  }

  .root-node {
    grid-column: 1;
    width: 100%;
  }

  .branches-left,
  .branches-right {
    grid-column: 1;
    padding-top: 0;
  }

  .branches-left .section-node,
  .branches-left .leaf-list {
    justify-self: start;
    justify-items: start;
  }

  .section-node,
  .leaf-node,
  .leaf-toggle {
    width: 100%;
  }

  .section-node::before,
  .leaf-node::before {
    display: none;
  }
}
</style>

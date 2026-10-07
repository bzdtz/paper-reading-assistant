<template>
  <main class="result-page container">
    <header class="top-bar">
      <div class="meta">
        <h2>分析结果</h2>
        <p v-if="store.fileName">文件：{{ store.fileName }} · 提取 {{ store.extractedChars }} 字</p>
        <p v-else>文本分析 · 共 {{ store.sections.length }} 个章节</p>
      </div>

      <div class="actions">
        <button type="button" class="secondary-btn" @click="goBack">返回输入</button>
        <button type="button" class="primary-btn" :disabled="store.isLoading" @click="runReAnalyze">
          重新分析
        </button>
      </div>
    </header>

    <p v-if="errorText" class="error-text">{{ errorText }}</p>

    <section v-if="sections.length" class="reader-wrap">
      <div v-if="!isMobile" class="desktop-view">
        <aside class="left-pane" :style="{ width: `${leftWidth}%` }">
          <SectionList :sections="sections" :active-index="store.activeSection" @select="jumpToSection" />

          <article v-if="currentSection" class="original-card">
            <h3>{{ currentSection.title }}</h3>
            <div class="content">{{ currentSection.content }}</div>
          </article>
        </aside>

        <div class="splitter" @mousedown.prevent="startResize" />

        <section ref="rightPaneRef" class="right-pane" @scroll.passive="syncByScroll">
          <article
            v-for="(section, index) in sections"
            :key="`${section.title}-${index}`"
            :ref="(el) => setSectionRef(el, index)"
            class="explain-card"
          >
            <h3>{{ index + 1 }}. {{ section.title }}</h3>
            <div class="markdown-body" v-html="renderMarkdown(section.explanation)" />
          </article>
        </section>
      </div>

      <div v-else class="mobile-view">
        <SectionList :sections="sections" :active-index="store.activeSection" @select="setActiveSection" />

        <div class="mobile-tabs">
          <button type="button" :class="{ active: mobileTab === 'original' }" @click="mobileTab = 'original'">
            原文
          </button>
          <button
            type="button"
            :class="{ active: mobileTab === 'explanation' }"
            @click="mobileTab = 'explanation'"
          >
            讲解
          </button>
        </div>

        <article v-if="currentSection" class="mobile-card">
          <h3>{{ currentSection.title }}</h3>
          <div v-if="mobileTab === 'original'" class="content">{{ currentSection.content }}</div>
          <div v-else class="markdown-body" v-html="renderMarkdown(currentSection.explanation)" />
        </article>
      </div>
    </section>

    <section v-else class="empty">
      <h3>暂无分析结果</h3>
      <p>请返回输入页上传论文或粘贴文本后开始分析。</p>
      <button type="button" class="primary-btn" @click="goBack">去输入页</button>
    </section>

    <AnalyzeProgress :visible="store.isLoading" :step-index="stepIndex" :steps="steps" />
  </main>
</template>

<script setup>
import MarkdownIt from "markdown-it";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import AnalyzeProgress from "../components/AnalyzeProgress.vue";
import SectionList from "../components/SectionList.vue";
import { usePaperStore } from "../stores/paperStore";

const router = useRouter();
const store = usePaperStore();

const steps = ["读取文档", "分析结构", "生成讲解", "整理结果"];
const stepIndex = ref(0);
const errorText = ref("");
const isMobile = ref(window.innerWidth <= 960);
const mobileTab = ref("original");

const leftWidth = ref(40);
const isResizing = ref(false);
const rightPaneRef = ref(null);
const sectionRefs = ref([]);

const sections = computed(() => store.sections);
const currentSection = computed(() => sections.value[store.activeSection] || null);

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true
});

let progressTimer = null;
let frameId = 0;

const updateMobileFlag = () => {
  isMobile.value = window.innerWidth <= 960;
};

const startStepAnimation = () => {
  stepIndex.value = 0;

  if (progressTimer) {
    window.clearInterval(progressTimer);
  }

  progressTimer = window.setInterval(() => {
    if (stepIndex.value >= 3) {
      stepIndex.value = 1;
      return;
    }

    stepIndex.value += 1;
  }, 900);
};

const stopStepAnimation = () => {
  if (progressTimer) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }

  stepIndex.value = 3;
};

const renderMarkdown = (content) => markdown.render(content || "");

const setSectionRef = (element, index) => {
  if (element) {
    sectionRefs.value[index] = element;
  }
};

const setActiveSection = (index) => {
  store.setActiveSection(index);
};

const jumpToSection = (index) => {
  store.setActiveSection(index);

  const target = sectionRefs.value[index];
  if (!target) {
    return;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
};

const syncByScroll = () => {
  if (isMobile.value || !rightPaneRef.value) {
    return;
  }

  window.cancelAnimationFrame(frameId);
  frameId = window.requestAnimationFrame(() => {
    const scrollTop = rightPaneRef.value.scrollTop;
    let currentIndex = 0;

    sectionRefs.value.forEach((element, index) => {
      if (!element) {
        return;
      }

      if (element.offsetTop - 24 <= scrollTop) {
        currentIndex = index;
      }
    });

    store.setActiveSection(currentIndex);
  });
};

const onMouseMove = (event) => {
  if (!isResizing.value || isMobile.value) {
    return;
  }

  const nextPercent = (event.clientX / window.innerWidth) * 100;
  leftWidth.value = Math.max(28, Math.min(58, nextPercent));
};

const stopResize = () => {
  isResizing.value = false;
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", stopResize);
};

const startResize = () => {
  if (isMobile.value) {
    return;
  }

  isResizing.value = true;
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", stopResize);
};

const runReAnalyze = async () => {
  errorText.value = "";
  startStepAnimation();

  try {
    await store.reAnalyze();
    await nextTick();
    sectionRefs.value = [];
    store.setActiveSection(0);
  } catch (error) {
    errorText.value = error?.message || "重新分析失败，请稍后重试。";
  } finally {
    stopStepAnimation();
  }
};

const goBack = () => {
  router.push("/");
};

onMounted(() => {
  if (!store.hasResult) {
    router.replace("/");
    return;
  }

  window.addEventListener("resize", updateMobileFlag);
});

onBeforeUnmount(() => {
  stopResize();
  stopStepAnimation();
  window.removeEventListener("resize", updateMobileFlag);
  window.cancelAnimationFrame(frameId);
});
</script>

<style scoped>
.result-page {
  padding: 24px 0 36px;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.meta h2 {
  margin: 0;
  font-size: clamp(24px, 3vw, 34px);
  color: #16375f;
}

.meta p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #5e748d;
}

.actions {
  display: flex;
  gap: 10px;
}

.primary-btn,
.secondary-btn {
  border: none;
  border-radius: 10px;
  height: 38px;
  padding: 0 14px;
  cursor: pointer;
  font-size: 14px;
}

.primary-btn {
  background: #d67b18;
  color: #fff;
}

.secondary-btn {
  background: rgba(25, 71, 117, 0.14);
  color: #1d3d63;
}

.primary-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.error-text {
  margin: 0 0 12px;
  color: #912e1b;
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(214, 80, 52, 0.1);
}

.reader-wrap {
  border: 1px solid rgba(24, 68, 113, 0.2);
  border-radius: 16px;
  background: rgba(251, 249, 242, 0.95);
  box-shadow: 0 14px 30px rgba(13, 35, 57, 0.1);
  min-height: 70vh;
  overflow: hidden;
}

.desktop-view {
  display: flex;
  min-height: 70vh;
}

.left-pane {
  padding: 14px;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 14px;
  border-right: 1px solid rgba(27, 72, 118, 0.15);
  background: linear-gradient(180deg, rgba(248, 243, 228, 0.9), rgba(247, 250, 255, 0.9));
}

.original-card {
  border: 1px solid rgba(28, 77, 126, 0.15);
  border-radius: 12px;
  padding: 14px;
  overflow: auto;
  background: #fcfbf8;
}

.original-card h3 {
  margin: 0 0 8px;
  color: #173e66;
}

.content {
  white-space: pre-wrap;
  line-height: 1.75;
  color: #304962;
  font-size: 14px;
}

.splitter {
  width: 8px;
  cursor: col-resize;
  background: linear-gradient(180deg, rgba(20, 59, 99, 0.05), rgba(213, 127, 32, 0.24), rgba(20, 59, 99, 0.05));
}

.right-pane {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  gap: 14px;
  background: linear-gradient(180deg, rgba(255, 252, 244, 0.9), rgba(240, 248, 255, 0.8));
}

.explain-card {
  border: 1px solid rgba(21, 64, 108, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  padding: 14px;
}

.explain-card h3 {
  margin: 0 0 10px;
  color: #173c62;
}

.mobile-view {
  padding: 12px;
  display: grid;
  gap: 12px;
}

.mobile-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mobile-tabs button {
  border: 1px solid rgba(30, 74, 120, 0.2);
  border-radius: 10px;
  background: rgba(246, 250, 254, 0.9);
  color: #1f426c;
  height: 38px;
}

.mobile-tabs button.active {
  background: linear-gradient(120deg, rgba(216, 132, 31, 0.2), rgba(27, 81, 131, 0.18));
  border-color: rgba(216, 132, 31, 0.55);
  font-weight: 700;
}

.mobile-card {
  border: 1px solid rgba(24, 69, 114, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.85);
  padding: 14px;
}

.mobile-card h3 {
  margin: 0 0 8px;
  color: #173d66;
}

.empty {
  margin-top: 16px;
  text-align: center;
  border: 1px dashed rgba(27, 72, 118, 0.3);
  border-radius: 14px;
  padding: 28px 16px;
  background: rgba(252, 249, 238, 0.86);
}

.empty h3 {
  margin: 0;
}

.empty p {
  color: #5f7288;
  margin: 8px 0 16px;
}

@media (max-width: 960px) {
  .top-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .actions {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

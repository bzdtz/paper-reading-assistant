<template>
  <main class="input-page container">
    <section class="hero">
      <p class="badge">论文辅助器</p>
      <h1>把复杂论文拆成可理解的章节与中文讲解</h1>
      <p class="desc">
        支持上传文档或直接粘贴文本。系统会自动拆分 5-10 个逻辑章节，并生成详细中文 Markdown 讲解。
      </p>
    </section>

    <section class="input-card">
      <div class="tabs">
        <button
          type="button"
          :class="{ active: activeTab === 'upload' }"
          @click="switchTab('upload')"
        >
          上传文档
        </button>
        <button type="button" :class="{ active: activeTab === 'paste' }" @click="switchTab('paste')">
          粘贴文本
        </button>
      </div>

      <UploadTab
        v-if="activeTab === 'upload'"
        :selected-file="selectedFile"
        :disabled="store.isLoading"
        :upload-progress="uploadProgress"
        :is-uploading="isUploading"
        @select-file="onSelectFile"
        @remove-file="removeFile"
        @submit-upload="submitUpload"
      />

      <PasteTab
        v-else
        :text="pasteText"
        :disabled="store.isLoading"
        @update:text="updateText"
        @submit-text="submitText"
      />

      <p class="helper-text">粘贴模式支持 Ctrl/Cmd + Enter 快速提交。</p>
      <p v-if="errorText" class="error-text">{{ errorText }}</p>
    </section>

    <AnalyzeProgress :visible="store.isLoading && showAnalyzeProgress" :step-index="stepIndex" :steps="steps" />
  </main>
</template>

<script setup>
import { onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";

import AnalyzeProgress from "../components/AnalyzeProgress.vue";
import PasteTab from "../components/PasteTab.vue";
import UploadTab from "../components/UploadTab.vue";
import { usePaperStore } from "../stores/paperStore";

const router = useRouter();
const store = usePaperStore();

const steps = ["读取文档", "分析结构", "生成讲解", "整理结果"];
const stepIndex = ref(0);
const activeTab = ref("upload");
const selectedFile = ref(store.lastInputType === "file" ? store.lastFile : null);
const pasteText = ref(store.lastInputType === "text" ? store.lastText : "");
const errorText = ref("");
const uploadProgress = ref(0);
const isUploading = ref(false);
const showAnalyzeProgress = ref(false);

const allowedExtensions = ["pdf", "docx", "doc", "txt", "md"];
const maxBytes = 20 * 1024 * 1024;

let timerId = null;

const startStepAnimation = () => {
  stepIndex.value = 0;

  if (timerId) {
    window.clearInterval(timerId);
  }

  timerId = window.setInterval(() => {
    if (stepIndex.value >= 3) {
      stepIndex.value = 1;
      return;
    }
    stepIndex.value += 1;
  }, 900);
};

const stopStepAnimation = () => {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
  stepIndex.value = 3;
};

const switchTab = (tab) => {
  activeTab.value = tab;
  errorText.value = "";
};

const updateText = (value) => {
  pasteText.value = value;
  errorText.value = "";
};

const validateFile = (file) => {
  if (!file) {
    return "请先选择论文文件。";
  }

  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return "仅支持 PDF、DOCX、DOC、TXT、MD 格式文件。";
  }

  if (file.size > maxBytes) {
    return "文件大小不能超过 20MB。";
  }

  return "";
};

const onSelectFile = (file) => {
  const message = validateFile(file);
  if (message) {
    selectedFile.value = null;
    errorText.value = message;
    return;
  }

  selectedFile.value = file;
  errorText.value = "";
};

const removeFile = () => {
  selectedFile.value = null;
};

const submitUpload = async () => {
  const message = validateFile(selectedFile.value);
  if (message) {
    errorText.value = message;
    return;
  }

  errorText.value = "";
  uploadProgress.value = 0;
  isUploading.value = true;
  showAnalyzeProgress.value = false;

  let analysisStarted = false;

  const beginAnalyzePhase = () => {
    if (analysisStarted) {
      return;
    }

    analysisStarted = true;
    isUploading.value = false;
    showAnalyzeProgress.value = true;
    startStepAnimation();
  };

  try {
    await store.analyzeByFile(selectedFile.value, {
      onUploadProgress: ({ loaded, total, percent }) => {
        if (typeof percent === "number") {
          uploadProgress.value = Math.max(uploadProgress.value, percent);
        } else if (loaded > 0) {
          uploadProgress.value = Math.min(95, uploadProgress.value + 4);
        }

        if ((typeof percent === "number" && percent >= 100) || (total && loaded >= total)) {
          uploadProgress.value = 100;
          beginAnalyzePhase();
        }
      }
    });

    if (!analysisStarted) {
      uploadProgress.value = 100;
      beginAnalyzePhase();
    }

    router.push("/result");
  } catch (error) {
    errorText.value = error?.message || "分析失败，请稍后重试。";
  } finally {
    isUploading.value = false;
    uploadProgress.value = 0;
    if (analysisStarted) {
      stopStepAnimation();
    }
    showAnalyzeProgress.value = false;
  }
};

const submitText = async () => {
  const normalized = pasteText.value.trim();

  if (!normalized) {
    errorText.value = "请先粘贴论文文本。";
    return;
  }

  if (normalized.length < 120) {
    errorText.value = "文本过短，请粘贴更完整的论文内容。";
    return;
  }

  errorText.value = "";
  showAnalyzeProgress.value = true;
  startStepAnimation();

  try {
    await store.analyzeByText(normalized);
    router.push("/result");
  } catch (error) {
    errorText.value = error?.message || "分析失败，请稍后重试。";
  } finally {
    stopStepAnimation();
    showAnalyzeProgress.value = false;
  }
};

onBeforeUnmount(() => {
  isUploading.value = false;
  uploadProgress.value = 0;
  showAnalyzeProgress.value = false;
  stopStepAnimation();
});
</script>

<style scoped>
.input-page {
  padding: 36px 0 60px;
}

.hero {
  margin-bottom: 18px;
  animation: fade-up 0.55s ease;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(24, 75, 122, 0.14);
  color: #184a7a;
  font-size: 12px;
  letter-spacing: 1px;
  padding: 4px 12px;
  margin: 0;
}

.hero h1 {
  margin: 12px 0 10px;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1.2;
  color: #1b3656;
}

.desc {
  margin: 0;
  max-width: 760px;
  color: #4f647c;
  line-height: 1.8;
}

.input-card {
  border: 1px solid rgba(25, 64, 107, 0.18);
  border-radius: 18px;
  background: rgba(250, 247, 239, 0.92);
  box-shadow: 0 16px 34px rgba(11, 33, 55, 0.1);
  padding: 18px;
  animation: fade-up 0.7s ease;
}

.tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.tabs button {
  border: 1px solid rgba(24, 64, 108, 0.2);
  background: rgba(241, 248, 255, 0.7);
  color: #23486f;
  border-radius: 10px;
  height: 40px;
  font-size: 14px;
  cursor: pointer;
}

.tabs button.active {
  background: linear-gradient(120deg, rgba(216, 132, 31, 0.2), rgba(28, 88, 139, 0.2));
  border-color: rgba(216, 132, 31, 0.55);
  font-weight: 700;
}

.helper-text {
  margin: 10px 0 0;
  color: #607388;
  font-size: 12px;
}

.error-text {
  margin: 10px 0 0;
  color: #a0321f;
  background: rgba(216, 84, 57, 0.1);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

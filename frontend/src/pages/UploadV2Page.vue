<template>
  <main class="upload-v2-page container">
    <section class="hero">
      <p class="badge">论文辅助器 V2</p>
      <h1>上传论文进行智能解析</h1>
      <p class="desc">
        支持 PDF、DOCX、DOC、TXT、MD 格式文件。使用 MinerU 远程解析 + AI 智能讲解。
      </p>
      <button type="button" class="settings-entry" @click="goSettings">⚙ API 设置</button>
    </section>

    <section class="upload-card">
      <div class="upload-area">
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-input"
          accept=".pdf,.docx,.doc,.txt,.md"
          @change="onFileChange"
        />

        <div
          class="drop-zone"
          :class="{ 'is-dragging': isDragging }"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
          @click="openFilePicker"
        >
          <div v-if="!selectedFile" class="upload-prompt">
            <p class="title">📄 拖拽论文到这里，或点击选择文件</p>
            <p class="sub-title">支持 PDF、DOCX、DOC、TXT、MD，最大 20MB</p>
          </div>

          <div v-else class="file-info">
            <p class="file-name">{{ selectedFile.name }}</p>
            <p class="file-size">{{ fileSizeText }}</p>
          </div>
        </div>

        <div v-if="selectedFile" class="actions">
          <button type="button" class="secondary-btn" @click="removeFile">
            重新选择
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="isUploading"
            @click="submitUpload"
          >
            {{ isUploading ? '上传中...' : '开始解析' }}
          </button>
        </div>

        <div v-if="isUploading" class="progress-bar">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${uploadProgress}%` }" />
          </div>
          <p class="progress-text">{{ progressText }}</p>
        </div>

        <p v-if="errorText" class="error-text">{{ errorText }}</p>
      </div>
    </section>
  </main>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { uploadPaperV2, parseApiError } from '../services/paperApiV2';

const router = useRouter();
const fileInputRef = ref(null);
const selectedFile = ref(null);
const isDragging = ref(false);
const isUploading = ref(false);
const uploadProgress = ref(0);
const errorText = ref('');

const fileSizeText = computed(() => {
  if (!selectedFile.value) return '';
  return `${(selectedFile.value.size / 1024 / 1024).toFixed(2)} MB`;
});

const progressText = computed(() => {
  if (uploadProgress.value < 100) {
    return `上传中... ${Math.round(uploadProgress.value)}%`;
  }
  return '上传完成，正在跳转到结果页...';
});

const openFilePicker = () => {
  fileInputRef.value?.click();
};

const goSettings = () => {
  router.push('/settings');
};

const onFileChange = (event) => {
  const file = event.target.files?.[0];
  if (file) {
    selectedFile.value = file;
    errorText.value = '';
  }
  event.target.value = '';
};

const onDragOver = () => {
  isDragging.value = true;
};

const onDragLeave = () => {
  isDragging.value = false;
};

const onDrop = (event) => {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    selectedFile.value = file;
    errorText.value = '';
  }
};

const removeFile = () => {
  selectedFile.value = null;
  uploadProgress.value = 0;
  errorText.value = '';
};

const validateFile = (file) => {
  if (!file) return '请先选择文件';
  
  const allowedTypes = ['pdf', 'docx', 'doc', 'txt', 'md'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowedTypes.includes(ext)) {
    return `仅支持 ${allowedTypes.join(', ').toUpperCase()} 格式`;
  }
  
  if (file.size > 20 * 1024 * 1024) {
    return '文件大小不能超过 20MB';
  }
  
  return '';
};

const submitUpload = async () => {
  const error = validateFile(selectedFile.value);
  if (error) {
    errorText.value = error;
    return;
  }

  isUploading.value = true;
  uploadProgress.value = 0;
  errorText.value = '';

  try {
    const response = await uploadPaperV2(selectedFile.value, ({ percent }) => {
      if (typeof percent === 'number') {
        uploadProgress.value = Math.max(uploadProgress.value, percent);
      }
    });

    uploadProgress.value = 100;

    // 获取 paperId 并跳转到结果页
    const paperId = response.paperId;
    if (paperId) {
      console.log('[UploadV2] 上传成功，paperId:', paperId);
      // 等待一下让用户看到上传完成的提示
      setTimeout(() => {
        // 跳转到聊天页面
        router.push(`/chat/${paperId}`);
      }, 500);
    } else {
      errorText.value = '上传成功但未返回 paperId';
      isUploading.value = false;
    }
  } catch (error) {
    errorText.value = parseApiError(error);
    isUploading.value = false;
    uploadProgress.value = 0;
  }
};
</script>

<style scoped>
.upload-v2-page {
  padding: 36px 0 60px;
}

.hero {
  margin-bottom: 24px;
  text-align: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: rgba(49, 130, 206, 0.1);
  color: #3182ce;
  font-size: 12px;
  letter-spacing: 1px;
  padding: 4px 12px;
  margin: 0;
  font-weight: 600;
}

.hero h1 {
  margin: 12px 0 10px;
  font-size: clamp(28px, 4vw, 36px);
  line-height: 1.2;
  color: #1a202c;
}

.desc {
  margin: 0;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
  color: #718096;
  line-height: 1.7;
}

.settings-entry {
  margin-top: 12px;
  border: 1px solid #c7d4e3;
  background: #ffffff;
  color: #2f4e6d;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.settings-entry:hover {
  border-color: #3182ce;
  color: #2b6cb0;
}

.upload-card {
  max-width: 600px;
  margin: 0 auto;
  background: white;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.hidden-input {
  display: none;
}

.drop-zone {
  border: 2px dashed #cbd5e0;
  border-radius: 12px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #f7fafc;
}

.drop-zone:hover {
  border-color: #3182ce;
  background: #ebf8ff;
}

.drop-zone.is-dragging {
  border-color: #3182ce;
  background: #bee3f8;
}

.upload-prompt .title {
  margin: 0 0 8px;
  font-size: 16px;
  color: #2d3748;
  font-weight: 600;
}

.upload-prompt .sub-title {
  margin: 0;
  color: #718096;
  font-size: 13px;
}

.file-info .file-name {
  margin: 0 0 4px;
  color: #2d3748;
  font-weight: 600;
  word-break: break-all;
}

.file-info .file-size {
  margin: 0;
  color: #718096;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.primary-btn,
.secondary-btn {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn {
  background: #3182ce;
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background: #2c5282;
}

.secondary-btn {
  background: #edf2f7;
  color: #4a5568;
}

.secondary-btn:hover {
  background: #e2e8f0;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-bar {
  margin-top: 16px;
}

.progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3182ce, #63b3ed);
  transition: width 0.3s ease;
}

.progress-text {
  margin: 8px 0 0;
  color: #718096;
  font-size: 13px;
  text-align: center;
}

.error-text {
  margin: 12px 0 0;
  color: #c53030;
  background: #fed7d7;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
</style>

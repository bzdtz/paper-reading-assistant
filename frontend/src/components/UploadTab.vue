<template>
  <div class="upload-tab">
    <input
      ref="fileInputRef"
      type="file"
      class="hidden-input"
      accept=".pdf,.docx,.doc,.txt,.md"
      :disabled="disabled"
      @change="onFileChange"
    />

    <div
      class="drop-zone"
      :class="{ 'is-dragging': isDragging, 'is-disabled': disabled }"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
      @click="openFilePicker"
    >
      <p class="title">拖拽论文到这里，或点击选择文件</p>
      <p class="sub-title">支持 PDF、DOCX、DOC、TXT、MD，最大 20MB</p>
    </div>

    <div v-if="selectedFile" class="file-card">
      <div>
        <p class="file-name">{{ selectedFile.name }}</p>
        <p class="file-size">{{ fileSizeText }}</p>
      </div>
      <button type="button" class="danger-btn" :disabled="disabled" @click="$emit('remove-file')">
        删除重选
      </button>
    </div>

    <div class="actions">
      <button type="button" class="secondary-btn" :disabled="disabled" @click="openFilePicker">
        重新选择
      </button>
      <button
        type="button"
        class="primary-btn"
        :disabled="disabled || !selectedFile"
        @click="$emit('submit-upload')"
      >
        开始分析
      </button>
    </div>

    <div v-if="isUploading" class="progress-card">
      <div class="progress-head">
        <span>上传进度</span>
        <span>{{ progressLabel }}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: `${progressWidth}%` }" />
      </div>
      <p class="progress-tip" v-if="uploadProgress >= 100">上传完成，正在开始分析...</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  selectedFile: {
    type: Object,
    default: null
  },
  disabled: {
    type: Boolean,
    default: false
  },
  uploadProgress: {
    type: Number,
    default: 0
  },
  isUploading: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["select-file", "remove-file", "submit-upload"]);

const fileInputRef = ref(null);
const isDragging = ref(false);

const fileSizeText = computed(() => {
  if (!props.selectedFile) {
    return "";
  }

  return `${(props.selectedFile.size / 1024 / 1024).toFixed(2)} MB`;
});

const progressWidth = computed(() => {
  const numeric = Number(props.uploadProgress || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 6;
  }
  return Math.max(6, Math.min(100, numeric));
});

const progressLabel = computed(() => {
  const numeric = Number(props.uploadProgress || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "准备上传";
  }
  if (numeric >= 100) {
    return "100%";
  }
  return `${Math.round(numeric)}%`;
});

const openFilePicker = () => {
  if (props.disabled) {
    return;
  }

  fileInputRef.value?.click();
};

const emitFile = (file) => {
  if (!file) {
    return;
  }
  emit("select-file", file);
};

const onFileChange = (event) => {
  const file = event.target.files?.[0];
  emitFile(file);
  event.target.value = "";
};

const onDragOver = () => {
  if (props.disabled) {
    return;
  }
  isDragging.value = true;
};

const onDragLeave = () => {
  isDragging.value = false;
};

const onDrop = (event) => {
  if (props.disabled) {
    return;
  }

  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  emitFile(file);
};
</script>

<style scoped>
.upload-tab {
  display: grid;
  gap: 16px;
}

.hidden-input {
  display: none;
}

.drop-zone {
  border: 2px dashed #5783b8;
  border-radius: 16px;
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  background: linear-gradient(145deg, rgba(214, 233, 249, 0.48), rgba(248, 236, 209, 0.4));
  transition: all 0.2s ease;
}

.drop-zone:hover {
  border-color: #d57f20;
  transform: translateY(-2px);
}

.drop-zone.is-dragging {
  border-color: #d57f20;
  background: linear-gradient(145deg, rgba(247, 223, 180, 0.6), rgba(199, 226, 245, 0.45));
}

.drop-zone.is-disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.title {
  margin: 0;
  font-size: 17px;
  color: #1e3d66;
  font-weight: 700;
}

.sub-title {
  margin: 8px 0 0;
  color: #5a6f86;
  font-size: 13px;
}

.file-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(30, 61, 102, 0.2);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(244, 250, 255, 0.85);
}

.file-name {
  margin: 0;
  color: #1f395a;
  font-weight: 700;
  word-break: break-all;
}

.file-size {
  margin: 4px 0 0;
  color: #607386;
  font-size: 13px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.progress-card {
  border: 1px solid rgba(28, 77, 126, 0.16);
  border-radius: 12px;
  background: rgba(255, 252, 244, 0.92);
  padding: 12px;
}

.progress-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #2b4c72;
  font-size: 13px;
  margin-bottom: 8px;
}

.progress-track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(29, 77, 125, 0.12);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #de9a3a, #2f7abb);
  transition: width 0.2s ease;
}

.progress-tip {
  margin: 8px 0 0;
  color: #496885;
  font-size: 12px;
}

.primary-btn,
.secondary-btn,
.danger-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  cursor: pointer;
}

.primary-btn {
  background: #d67b18;
  color: #fff;
}

.secondary-btn {
  background: rgba(24, 66, 112, 0.1);
  color: #1f3f67;
}

.danger-btn {
  background: rgba(211, 74, 49, 0.12);
  color: #8f2e1a;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .actions {
    flex-direction: column;
  }

  .primary-btn,
  .secondary-btn,
  .danger-btn {
    width: 100%;
  }

  .file-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

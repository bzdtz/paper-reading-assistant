<template>
  <div class="paste-tab">
    <textarea
      :value="text"
      :disabled="disabled"
      placeholder="请粘贴论文全文，建议包含摘要、引言、方法、实验、结论等完整内容"
      @input="onInput"
      @keydown="onKeydown"
    />

    <div class="footer">
      <p>字符数：{{ text.length }}</p>
      <button type="button" class="primary-btn" :disabled="disabled" @click="$emit('submit-text')">
        开始分析
      </button>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  text: {
    type: String,
    default: ""
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["update:text", "submit-text"]);

const onInput = (event) => {
  emit("update:text", event.target.value);
};

const onKeydown = (event) => {
  const enterPressed = event.key === "Enter";
  const commandPressed = event.metaKey || event.ctrlKey;

  if (enterPressed && commandPressed) {
    event.preventDefault();
    emit("submit-text");
  }
};
</script>

<style scoped>
.paste-tab {
  display: grid;
  gap: 12px;
}

textarea {
  width: 100%;
  min-height: 300px;
  border: 1px solid rgba(18, 46, 80, 0.24);
  border-radius: 14px;
  padding: 14px;
  line-height: 1.75;
  font-size: 14px;
  resize: vertical;
  background: rgba(250, 248, 240, 0.9);
  color: #1d3657;
}

textarea:focus {
  outline: 2px solid rgba(213, 127, 32, 0.4);
  border-color: #d57f20;
}

.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.footer p {
  margin: 0;
  color: #5f738b;
  font-size: 13px;
}

.primary-btn {
  border: none;
  border-radius: 10px;
  background: #d67b18;
  color: #fff;
  padding: 10px 15px;
  font-size: 14px;
  cursor: pointer;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .footer {
    flex-direction: column;
    align-items: stretch;
  }

  .primary-btn {
    width: 100%;
  }
}
</style>

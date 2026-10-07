<template>
  <transition name="fade">
    <div v-if="visible" class="progress-mask">
      <div class="progress-card">
        <h3>正在分析论文</h3>
        <p>请稍候，系统正在完成结构拆分与中文讲解生成。</p>

        <ul>
          <li v-for="(step, index) in mergedSteps" :key="step" :class="stepState(index)">
            <span class="dot" />
            <span>{{ step }}</span>
          </li>
        </ul>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  stepIndex: {
    type: Number,
    default: 0
  },
  steps: {
    type: Array,
    default: () => ["读取文档", "分析结构", "生成讲解", "整理结果"]
  }
});

const mergedSteps = computed(() => props.steps.slice(0, 4));

const stepState = (index) => {
  if (index < props.stepIndex) {
    return "done";
  }

  if (index === props.stepIndex) {
    return "active";
  }

  return "pending";
};
</script>

<style scoped>
.progress-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(12, 24, 38, 0.62);
  display: grid;
  place-items: center;
  padding: 20px;
}

.progress-card {
  width: min(460px, 100%);
  background: #f8f6ef;
  border-radius: 18px;
  border: 1px solid rgba(17, 42, 79, 0.15);
  padding: 24px 24px 18px;
  box-shadow: 0 22px 40px rgba(10, 25, 42, 0.25);
}

.progress-card h3 {
  margin: 0;
  font-size: 20px;
  color: #17365f;
}

.progress-card p {
  margin: 10px 0 18px;
  color: #40566f;
  font-size: 14px;
}

.progress-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}

.progress-card li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #6a778a;
  font-size: 14px;
}

.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #c9d3de;
}

li.done {
  color: #3c566d;
}

li.done .dot {
  background: #2f8f83;
}

li.active {
  color: #15385f;
  font-weight: 700;
}

li.active .dot {
  background: #d4821f;
  box-shadow: 0 0 0 5px rgba(212, 130, 31, 0.18);
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

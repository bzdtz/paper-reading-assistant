<template>
  <div class="section-list">
    <p class="title">章节导航</p>

    <button
      v-for="(section, index) in sections"
      :key="`${section.title}-${index}`"
      type="button"
      class="section-btn"
      :class="{ active: index === activeIndex }"
      @click="$emit('select', index)"
    >
      <span class="num">{{ index + 1 }}</span>
      <span class="text">{{ section.title }}</span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  sections: {
    type: Array,
    default: () => []
  },
  activeIndex: {
    type: Number,
    default: 0
  }
});

defineEmits(["select"]);
</script>

<style scoped>
.section-list {
  display: grid;
  gap: 8px;
}

.title {
  margin: 0 0 6px;
  font-size: 13px;
  color: #6d7f94;
  letter-spacing: 1px;
}

.section-btn {
  border: 1px solid rgba(24, 65, 111, 0.2);
  border-radius: 10px;
  background: #f8f7f1;
  color: #1d3f68;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
}

.section-btn.active {
  background: linear-gradient(120deg, rgba(213, 127, 32, 0.16), rgba(20, 74, 120, 0.14));
  border-color: rgba(213, 127, 32, 0.6);
}

.num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(21, 73, 119, 0.11);
  font-size: 12px;
  font-weight: 700;
}

.text {
  flex: 1;
  line-height: 1.4;
}
</style>

<template>
  <div class="app-shell">
    <router-view />
    <button
      class="theme-switch"
      type="button"
      :aria-label="isDarkTheme ? '切换到白天模式' : '切换到黑夜模式'"
      :title="isDarkTheme ? '切换到白天模式' : '切换到黑夜模式'"
      @click="toggleTheme"
    >
      <span class="theme-switch-icon" aria-hidden="true">{{ isDarkTheme ? '☀' : '🌙' }}</span>
      <span class="theme-switch-text">{{ isDarkTheme ? '白天' : '黑夜' }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const THEME_STORAGE_KEY = 'paper-helper-theme';
const theme = ref('light');

const isDarkTheme = computed(() => theme.value === 'dark');

const getPreferredTheme = () => {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = (value) => {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.setAttribute('data-theme', value);
  document.body.setAttribute('data-theme', value);
};

const toggleTheme = () => {
  theme.value = isDarkTheme.value ? 'light' : 'dark';
};

watch(theme, (value) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  }
  applyTheme(value);
});

onMounted(() => {
  theme.value = getPreferredTheme();
  applyTheme(theme.value);
});
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.theme-switch {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 3000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line-1);
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--surface-1);
  backdrop-filter: blur(8px);
  color: var(--ink-1);
  font-weight: 600;
  letter-spacing: 0.2px;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.theme-switch:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22);
}

.theme-switch-icon {
  font-size: 16px;
  line-height: 1;
}

.theme-switch-text {
  font-size: 13px;
}

@media (max-width: 768px) {
  .theme-switch {
    right: 12px;
    bottom: 12px;
    padding: 7px 12px;
  }
}
</style>

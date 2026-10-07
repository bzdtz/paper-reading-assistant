<template>
  <main class="settings-page container">
    <section class="settings-hero">
      <button class="back-btn" @click="goBack">← 返回</button>
      <h1>AI API 设置</h1>
      <p>在这里配置对话 AI、非文字排序 AI 与 MinerU，并可直接测试连通性。</p>
    </section>

    <section class="settings-card">
      <h2>对话 AI（主问答）</h2>
      <div class="grid">
        <label>
          <span>Base URL</span>
          <input v-model="form.zai.baseUrl" placeholder="https://your-ai-gateway" />
        </label>
        <label>
          <span>API Key</span>
          <input v-model="form.zai.apiKey" type="password" placeholder="sk-..." />
        </label>
        <label>
          <span>Model</span>
          <input v-model="form.zai.model" placeholder="glm-4.5-air" />
        </label>
        <label>
          <span>Timeout(ms)</span>
          <input v-model.number="form.zai.requestTimeoutMs" type="number" min="1000" />
        </label>
        <label>
          <span>Max Retries</span>
          <input v-model.number="form.zai.maxRetries" type="number" min="0" max="5" />
        </label>
        <label>
          <span>Retry Delay(ms)</span>
          <input v-model.number="form.zai.retryDelayMs" type="number" min="0" />
        </label>
      </div>

      <div class="actions">
        <button class="primary" :disabled="saving" @click="saveSettings">{{ saving ? '保存中...' : '保存设置' }}</button>
        <button :disabled="testingChat" @click="runChatTest">{{ testingChat ? '测试中...' : '测试对话 AI' }}</button>
      </div>
      <p v-if="chatTestText" class="result-text">{{ chatTestText }}</p>
    </section>

    <section class="settings-card">
      <h2>非文字排序 AI（图表顺序）</h2>
      <div class="grid">
        <label>
          <span>Base URL</span>
          <input v-model="form.nonTextOrderAi.url" placeholder="https://your-order-ai" />
        </label>
        <label>
          <span>API Key</span>
          <input v-model="form.nonTextOrderAi.apiKey" type="password" placeholder="key-..." />
        </label>
        <label>
          <span>Model</span>
          <input v-model="form.nonTextOrderAi.model" placeholder="可选" />
        </label>
        <label>
          <span>Timeout(ms)</span>
          <input v-model.number="form.nonTextOrderAi.timeoutMs" type="number" min="1000" />
        </label>
      </div>

      <div class="actions">
        <button :disabled="testingNonText" @click="runNonTextTest">{{ testingNonText ? '测试中...' : '测试非文字排序 AI' }}</button>
      </div>
      <p v-if="nonTextTestText" class="result-text">{{ nonTextTestText }}</p>
    </section>

    <section class="settings-card">
      <h2>MinerU（解析服务）</h2>
      <div class="grid">
        <label>
          <span>Base URL</span>
          <input v-model="form.mineru.baseUrl" placeholder="https://mineru.net/api/v4" />
        </label>
        <label>
          <span>Token</span>
          <input v-model="form.mineru.token" type="password" placeholder="mineru-token" />
        </label>
        <label>
          <span>Model Version</span>
          <select v-model="form.mineru.modelVersion">
            <option value="vlm">vlm</option>
            <option value="pipeline">pipeline</option>
            <option value="MinerU-HTML">MinerU-HTML</option>
          </select>
        </label>
        <label>
          <span>Poll Interval(ms)</span>
          <input v-model.number="form.mineru.pollIntervalMs" type="number" min="1000" />
        </label>
        <label>
          <span>Poll Timeout(ms)</span>
          <input v-model.number="form.mineru.pollTimeoutMs" type="number" min="10000" />
        </label>
      </div>

      <div class="actions">
        <button :disabled="testingMineru" @click="runMineruTest">{{ testingMineru ? '测试中...' : '测试 MinerU' }}</button>
      </div>
      <p v-if="mineruTestText" class="result-text">{{ mineruTestText }}</p>
    </section>

    <section class="settings-card">
      <h2>MinerU 产物检查</h2>
      <div class="artifact-form">
        <input v-model="paperIdToCheck" placeholder="输入 paperId（可在聊天页 URL 中复制）" />
        <button :disabled="checkingArtifact || !paperIdToCheck.trim()" @click="checkArtifact">
          {{ checkingArtifact ? '检查中...' : '检查保存状态' }}
        </button>
      </div>
      <pre v-if="artifactText" class="artifact-result">{{ artifactText }}</pre>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  getAISettings,
  saveAISettings,
  testChatAI,
  testNonTextOrderAI,
  testMineruAPI,
  getPaperArtifactStatus
} from '../services/settingsApi';

const router = useRouter();

const saving = ref(false);
const testingChat = ref(false);
const testingNonText = ref(false);
const testingMineru = ref(false);
const checkingArtifact = ref(false);

const chatTestText = ref('');
const nonTextTestText = ref('');
const mineruTestText = ref('');
const artifactText = ref('');
const paperIdToCheck = ref('');

const form = ref({
  zai: {
    baseUrl: '',
    apiKey: '',
    model: 'glm-4.5-air',
    requestTimeoutMs: 90000,
    maxRetries: 1,
    retryDelayMs: 1200
  },
  nonTextOrderAi: {
    url: '',
    apiKey: '',
    model: '',
    timeoutMs: 45000
  },
  mineru: {
    baseUrl: '',
    token: '',
    modelVersion: 'vlm',
    pollIntervalMs: 5000,
    pollTimeoutMs: 600000
  }
});

const goBack = () => {
  router.back();
};

const loadSettings = async () => {
  const response = await getAISettings();
  const settings = response?.settings || {};

  form.value.zai.baseUrl = settings?.zai?.baseUrl || '';
  form.value.zai.model = settings?.zai?.model || 'glm-4.5-air';
  form.value.zai.requestTimeoutMs = settings?.zai?.requestTimeoutMs || 90000;
  form.value.zai.maxRetries = settings?.zai?.maxRetries ?? 1;
  form.value.zai.retryDelayMs = settings?.zai?.retryDelayMs || 1200;

  form.value.nonTextOrderAi.url = settings?.nonTextOrderAi?.url || '';
  form.value.nonTextOrderAi.model = settings?.nonTextOrderAi?.model || '';
  form.value.nonTextOrderAi.timeoutMs = settings?.nonTextOrderAi?.timeoutMs || 45000;

  form.value.mineru.baseUrl = settings?.mineru?.baseUrl || '';
  form.value.mineru.modelVersion = settings?.mineru?.modelVersion || 'vlm';
  form.value.mineru.pollIntervalMs = settings?.mineru?.pollIntervalMs || 5000;
  form.value.mineru.pollTimeoutMs = settings?.mineru?.pollTimeoutMs || 600000;
};

const saveSettings = async () => {
  saving.value = true;
  try {
    await saveAISettings(form.value);
    chatTestText.value = '设置已保存。';
  } catch (error) {
    chatTestText.value = `保存失败：${error?.response?.data?.message || error?.message || '未知错误'}`;
  } finally {
    saving.value = false;
  }
};

const runChatTest = async () => {
  testingChat.value = true;
  chatTestText.value = '';
  try {
    const response = await testChatAI();
    chatTestText.value = response?.available
      ? `连通成功，模型返回：${response.preview || 'OK'}`
      : `连通失败，返回：${response?.preview || '无响应'}`;
  } catch (error) {
    chatTestText.value = `测试失败：${error?.response?.data?.message || error?.message || '未知错误'}`;
  } finally {
    testingChat.value = false;
  }
};

const runNonTextTest = async () => {
  testingNonText.value = true;
  nonTextTestText.value = '';
  try {
    const response = await testNonTextOrderAI();
    nonTextTestText.value = response?.available
      ? '非文字排序 AI 可用。'
      : `不可用：${response?.meta?.aiReason || response?.recommendation || '未返回原因'}`;
  } catch (error) {
    nonTextTestText.value = `测试失败：${error?.response?.data?.message || error?.message || '未知错误'}`;
  } finally {
    testingNonText.value = false;
  }
};

const runMineruTest = async () => {
  testingMineru.value = true;
  mineruTestText.value = '';
  try {
    const response = await testMineruAPI();
    mineruTestText.value = response?.available
      ? `MinerU 可用（code=${response.probeCode}，${response.probeMessage}）`
      : `MinerU 不可用（code=${response?.probeCode ?? '-'}，${response?.probeMessage || '未知错误'}）`;
  } catch (error) {
    mineruTestText.value = `测试失败：${error?.response?.data?.message || error?.message || '未知错误'}`;
  } finally {
    testingMineru.value = false;
  }
};

const checkArtifact = async () => {
  checkingArtifact.value = true;
  artifactText.value = '';
  try {
    const response = await getPaperArtifactStatus(paperIdToCheck.value.trim());
    artifactText.value = JSON.stringify(response, null, 2);
  } catch (error) {
    artifactText.value = JSON.stringify({
      success: false,
      message: error?.response?.data?.message || error?.message || '未知错误'
    }, null, 2);
  } finally {
    checkingArtifact.value = false;
  }
};

onMounted(async () => {
  try {
    await loadSettings();
  } catch (error) {
    chatTestText.value = `加载设置失败：${error?.response?.data?.message || error?.message || '未知错误'}`;
  }
});
</script>

<style scoped>
.settings-page {
  padding: 30px 0 60px;
}

.settings-hero h1 {
  margin: 12px 0 6px;
}

.settings-hero p {
  margin: 0;
  color: #607389;
}

.back-btn {
  border: 1px solid #cbd5e0;
  background: #fff;
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
}

.settings-card {
  margin-top: 16px;
  border: 1px solid #dde5ee;
  border-radius: 14px;
  background: #fff;
  padding: 16px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

label span {
  font-size: 12px;
  color: #5e7288;
}

input {
  border: 1px solid #cdd7e3;
  border-radius: 8px;
  padding: 8px 10px;
}

select {
  border: 1px solid #cdd7e3;
  border-radius: 8px;
  padding: 8px 10px;
}

.actions {
  margin-top: 12px;
  display: flex;
  gap: 10px;
}

button {
  border: 1px solid #cbd5e0;
  background: #fff;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

button.primary {
  background: #2b6cb0;
  border-color: transparent;
  color: #fff;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.result-text {
  margin: 10px 0 0;
  color: #425a73;
  font-size: 13px;
}

.artifact-form {
  display: flex;
  gap: 10px;
}

.artifact-form input {
  flex: 1;
}

.artifact-result {
  margin: 10px 0 0;
  background: #f5f8fc;
  border: 1px solid #dce5ef;
  border-radius: 10px;
  padding: 10px;
  font-size: 12px;
  max-height: 300px;
  overflow: auto;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .artifact-form {
    flex-direction: column;
  }
}
</style>

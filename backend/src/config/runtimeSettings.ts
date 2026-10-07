import fs from 'node:fs';
import path from 'node:path';

export type RuntimeSettings = {
  zai?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    chatId?: string;
    userId?: string;
    token?: string;
    requestTimeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  };
  nonTextOrderAi?: {
    url?: string;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
  };
  mineru?: {
    baseUrl?: string;
    token?: string;
    modelVersion?: 'vlm' | 'pipeline' | 'MinerU-HTML';
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    requestTimeoutMs?: number;
    requestMaxRetries?: number;
    requestRetryDelayMs?: number;
    uploadTimeoutMs?: number;
    uploadMaxRetries?: number;
    uploadRetryDelayMs?: number;
  };
};

const SETTINGS_PATH = path.resolve(process.cwd(), '.runtime-settings.json');

const isObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const deepMerge = <T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T => {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = deepMerge(output[key] as Record<string, unknown>, value);
      continue;
    }
    output[key] = value;
  }

  return output as T;
};

export const readRuntimeSettings = (): RuntimeSettings => {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8').trim();
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? (parsed as RuntimeSettings) : {};
  } catch {
    return {};
  }
};

export const writeRuntimeSettings = (settings: RuntimeSettings): RuntimeSettings => {
  const normalized = isObject(settings) ? settings : {};
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
};

export const updateRuntimeSettings = (patch: RuntimeSettings): RuntimeSettings => {
  const current = readRuntimeSettings();
  const merged = deepMerge(current as Record<string, unknown>, (patch || {}) as Record<string, unknown>) as RuntimeSettings;
  return writeRuntimeSettings(merged);
};

export const getRuntimeSettingsPath = (): string => SETTINGS_PATH;

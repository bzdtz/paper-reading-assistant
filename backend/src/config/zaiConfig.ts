import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { HttpError } from "../utils/errors.js";
import { readRuntimeSettings } from "./runtimeSettings.js";

export interface ZAIConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

let cache: ZAIConfig | null = null;

export const resetZAIConfigCache = (): void => {
  cache = null;
};

const parseKeyValueConfig = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, splitIndex).trim();
    const value = trimmed.slice(splitIndex + 1).trim().replace(/^"|"$/g, "");
    result[key] = value;
  }

  return result;
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizePositiveInt = (
  rawValue: unknown,
  defaultValue: number,
  min: number,
  max: number
): number => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const normalized = Math.floor(parsed);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }

  return normalized;
};

const validateConfig = (rawConfig: Record<string, unknown>): ZAIConfig => {
  const baseUrl = String(rawConfig.baseUrl ?? "").trim();
  const apiKey = String(rawConfig.apiKey ?? "").trim();
  const model = String(rawConfig.model ?? "glm-4.5-air").trim();

  if (!baseUrl || !isValidHttpUrl(baseUrl)) {
    throw new HttpError(500, ".z-ai-config 的 baseUrl 必须是合法的 http/https 地址。");
  }

  if (!apiKey) {
    throw new HttpError(500, ".z-ai-config 的 apiKey 不能为空。");
  }

  if (/your-z-ai-endpoint|example\.com/i.test(baseUrl)) {
    throw new HttpError(500, ".z-ai-config 的 baseUrl 仍是示例值，请替换为真实 AI 网关地址。");
  }

  if (/replace_with_real_api_key|your_api_key|sk-xxxx/i.test(apiKey)) {
    throw new HttpError(500, ".z-ai-config 的 apiKey 仍是示例值，请替换为真实密钥。");
  }

  const config: ZAIConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    requestTimeoutMs: normalizePositiveInt(rawConfig.requestTimeoutMs, 90000, 10000, 300000),
    maxRetries: normalizePositiveInt(rawConfig.maxRetries, 1, 0, 5),
    retryDelayMs: normalizePositiveInt(rawConfig.retryDelayMs, 1200, 0, 15000)
  };

  const chatId = String(rawConfig.chatId ?? "").trim();
  const userId = String(rawConfig.userId ?? "").trim();

  if (chatId) {
    config.chatId = chatId;
  }

  if (userId) {
    config.userId = userId;
  }

  const token = String(rawConfig.token ?? "").trim();
  if (token) {
    config.token = token;
  }

  return config;
};

export const loadZAIConfig = (): ZAIConfig => {
  if (cache) {
    return cache;
  }

  const configPath = path.resolve(process.cwd(), ".z-ai-config");
  if (!existsSync(configPath)) {
    throw new HttpError(500, "未找到 .z-ai-config 文件，请先按示例创建配置。");
  }

  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) {
    throw new HttpError(500, ".z-ai-config 为空，请填写 baseUrl 与 apiKey。");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = parseKeyValueConfig(raw);
  }

  const runtimeSettings = readRuntimeSettings();
  const runtimeZai = runtimeSettings.zai || {};

  const mergedConfig: Record<string, unknown> = {
    ...parsed,
    ...runtimeZai
  };

  cache = validateConfig(mergedConfig);
  return cache;
};

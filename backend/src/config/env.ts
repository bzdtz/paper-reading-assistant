import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

dotenv.config();

const parsePort = (input: string | undefined): number => {
  const parsed = Number(input ?? 3000);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 3000;
  }
  return parsed;
};

const parseTimeout = (input: string | undefined, fallback: number): number => {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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

const loadEnvExampleFallback = (): Record<string, string> => {
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  if (!existsSync(envExamplePath)) {
    return {};
  }

  try {
    const raw = readFileSync(envExamplePath, "utf8");
    return parseKeyValueConfig(raw);
  } catch {
    return {};
  }
};

const envExampleFallback = loadEnvExampleFallback();

const looksLikePlaceholder = (value: string): boolean => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return true;
  }

  return /your_|example|replace|xxx/.test(text);
};

const getEnvValueWithExampleFallback = (key: string): string => {
  const direct = String(process.env[key] ?? "").trim();
  if (direct) {
    return direct;
  }

  const fallback = String(envExampleFallback[key] ?? "").trim();
  if (!fallback || looksLikePlaceholder(fallback)) {
    return "";
  }

  return fallback;
};

const normalizeOptionalHttpUrl = (input: string | undefined): string => {
  const value = String(input ?? "").trim();
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return value.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const normalizeModelName = (input: string): string => {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }

  const parts = value.split("/").map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }

  return value;
};

export const env = {
  port: parsePort(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  nonTextOrderAiUrl: normalizeOptionalHttpUrl(getEnvValueWithExampleFallback("NON_TEXT_ORDER_AI_URL")),
  nonTextOrderAiApiKey: getEnvValueWithExampleFallback("NON_TEXT_ORDER_AI_API_KEY"),
  nonTextOrderAiModel: normalizeModelName(getEnvValueWithExampleFallback("NON_TEXT_ORDER_AI_MODEL")),
  nonTextOrderAiTimeoutMs: parseTimeout(getEnvValueWithExampleFallback("NON_TEXT_ORDER_AI_TIMEOUT_MS"), 45000)
};

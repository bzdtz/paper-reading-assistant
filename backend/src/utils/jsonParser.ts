import { HttpError } from "./errors.js";

const stripCodeFence = (text: string): string => {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return text.trim();
};

const extractJsonSegment = (text: string): string => {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");

  let startIndex = -1;
  if (firstObject === -1) {
    startIndex = firstArray;
  } else if (firstArray === -1) {
    startIndex = firstObject;
  } else {
    startIndex = Math.min(firstObject, firstArray);
  }

  if (startIndex === -1) {
    return text;
  }

  const lastObject = text.lastIndexOf("}");
  const lastArray = text.lastIndexOf("]");
  const endIndex = Math.max(lastObject, lastArray);

  if (endIndex <= startIndex) {
    return text;
  }

  return text.slice(startIndex, endIndex + 1).trim();
};

export const parseStrictJson = <T>(raw: string): T => {
  if (!raw || !raw.trim()) {
    throw new HttpError(502, "AI 未返回有效内容，请稍后重试。");
  }

  const trimmed = raw.trim();
  const withoutFence = stripCodeFence(trimmed);
  const extracted = extractJsonSegment(withoutFence);

  const candidates = [trimmed, withoutFence, extracted];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Ignore current candidate and continue trying.
    }
  }

  throw new HttpError(502, "AI 返回内容无法解析为 JSON，请稍后重试。");
};

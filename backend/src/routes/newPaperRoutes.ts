/**
 * 论文处理路由 - 集成 MinerU 解析和翻译/讲解功能
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

import { prisma } from '../lib/prisma.js';
import { mineruClient } from '../services/mineruClient.js';
import { parseMarkdownContent, flattenParsedContent, restructureWithAI, parseMineruJson } from '../services/contentParser.js';
import { studySessionManager } from '../services/studySessionManager.js';
import { ZAIClient } from '../services/aiClient.js';
import { HttpError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { readRuntimeSettings, updateRuntimeSettings } from '../config/runtimeSettings.js';
import { loadZAIConfig, resetZAIConfigCache } from '../config/zaiConfig.js';
import { paperSummaryGenerator } from '../services/paperSummaryGenerator.js';

// 创建主路由器
const router = express.Router();

// 创建子路由器用于论文相关操作
const paperRouter = express.Router();

// 配置文件上传
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.doc', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型：${ext}，支持 ${allowedTypes.join(', ')}`));
    }
  }
});

const looksLikeSectionHeading = (text: string): boolean => {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return false;
  }

  return (
    /^\d+(\.\d+)*[.)\s]/.test(normalized) ||
    /^[IVXLC]+\.\s+/i.test(normalized) ||
    /^第[一二三四五六七八九十百千]+[章节部分篇]/.test(normalized) ||
    /^(appendix|supplementary\s+material|supplementary|附录|补充材料)\b/i.test(normalized) ||
    (/^[A-Z][A-Z\s-]{3,}$/.test(normalized) && normalized.length <= 120)
  );
};

const safeJsonParse = (value: string | null | undefined): any => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const maskSecret = (value: string): string => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.length <= 8) {
    return `${text.slice(0, 2)}***`;
  }

  return `${text.slice(0, 4)}***${text.slice(-3)}`;
};

const parsePositiveNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getNonTextOrderAiConfig = () => {
  const runtime = readRuntimeSettings().nonTextOrderAi || {};
  return {
    url: String(runtime.url || env.nonTextOrderAiUrl || '').trim(),
    apiKey: String(runtime.apiKey || env.nonTextOrderAiApiKey || '').trim(),
    model: String(runtime.model || env.nonTextOrderAiModel || '').trim(),
    timeoutMs: parsePositiveNumber(runtime.timeoutMs, env.nonTextOrderAiTimeoutMs)
  };
};

const resolvePaperArtifactDir = (paperId: string, rawContent: any): string | null => {
  const candidates = [
    typeof rawContent?.mineruPath === 'string' ? rawContent.mineruPath : '',
    path.resolve(process.cwd(), 'uploads', 'mineru-results-2', paperId),
    path.resolve(process.cwd(), '..', 'uploads', 'mineru-results-2', paperId),
    path.resolve(process.cwd(), 'uploads', 'mineru-results', paperId),
    path.resolve(process.cwd(), '..', 'uploads', 'mineru-results', paperId)
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
};

const walkFilesRecursively = async (rootDir: string): Promise<string[]> => {
  const output: string[] = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFilesRecursively(fullPath);
      output.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      output.push(fullPath);
    }
  }

  return output;
};

const getMineruBlockSortKey = (block: any, index: number) => {
  const pageValue = Number(
    block?.page_idx ??
    block?.page_num ??
    block?.pageNo ??
    block?.page ??
    block?.page_number ??
    Number.MAX_SAFE_INTEGER
  );
  const bbox = Array.isArray(block?.bbox) ? block.bbox : [];
  const topValue = Number(bbox[1] ?? Number.MAX_SAFE_INTEGER);
  const leftValue = Number(bbox[0] ?? Number.MAX_SAFE_INTEGER);

  return {
    page: Number.isFinite(pageValue) ? pageValue : Number.MAX_SAFE_INTEGER,
    top: Number.isFinite(topValue) ? topValue : Number.MAX_SAFE_INTEGER,
    left: Number.isFinite(leftValue) ? leftValue : Number.MAX_SAFE_INTEGER,
    index
  };
};

const compareMineruBlocks = (left: { page: number; top: number; left: number; index: number }, right: { page: number; top: number; left: number; index: number }): number => {
  if (left.page !== right.page) {
    return left.page - right.page;
  }

  if (left.top !== right.top) {
    return left.top - right.top;
  }

  if (left.left !== right.left) {
    return left.left - right.left;
  }

  return left.index - right.index;
};

const toDisplayCaptionFromFileName = (fileName: string): string => {
  const clean = String(fileName || '').trim();
  if (!clean) {
    return '图片';
  }

  const base = clean.replace(/\.[^.]+$/, '');
  const figureMatch = base.match(/(?:fig(?:ure)?|图)[\s_-]*([0-9]{1,3})/i);
  if (figureMatch) {
    return `Figure ${figureMatch[1]}`;
  }

   if (/^[a-f0-9]{24,}$/i.test(base)) {
    return '图片';
  }

  return base;
};

type NonTextItem = {
  key: string;
  type: 'image' | 'table' | 'equation' | 'other';
  mineruType: string;
  mineruName: string;
  icon: '🖼' | '📊' | '∑' | '🧩';
  caption: string;
  fileName: string;
  relativePath: string;
  url: string;
  placeholderText: string;
  explanation: string;
  orderHint?: number;
};

type NonTextOrderMeta = {
  aiConfigured: boolean;
  aiInvoked: boolean;
  aiApplied: boolean;
  aiReason: string;
  aiOrderedKeysCount: number;
};

type MarkdownImageMention = {
  order: number;
  normalizedPath: string;
  normalizedFileName: string;
  alt: string;
  labelHint: string;
};

const normalizeMediaPath = (input: string): string => {
  let value = String(input || '').trim().replace(/\\/g, '/');
  if (!value) {
    return '';
  }

  value = value.replace(/^<|>$/g, '');
  value = value.split('#')[0].split('?')[0];

  while (value.startsWith('./')) {
    value = value.slice(2);
  }
  while (value.startsWith('/')) {
    value = value.slice(1);
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    // ignore decode failure and keep raw value
  }

  return value.toLowerCase();
};

const normalizeMediaFileName = (input: string): string => {
  return String(input || '').trim().toLowerCase();
};

const parseMarkdownImageSrcToken = (rawSrc: string): string => {
  const token = String(rawSrc || '').trim();
  if (!token) {
    return '';
  }

  const splitBySpace = token.split(/\s+/)[0];
  return splitBySpace.replace(/^<|>$/g, '');
};

const extractFigureOrTableLabelFromNearbyText = (text: string): string => {
  const content = String(text || '');
  if (!content) {
    return '';
  }

  const figureMatch = content.match(/(?:fig(?:ure)?|图)\.?\s*([0-9]{1,3})/i);
  if (figureMatch) {
    return `Figure ${figureMatch[1]}`;
  }

  const tableMatch = content.match(/(?:table|tab\.?|表)\.?\s*([0-9]{1,3})/i);
  if (tableMatch) {
    return `Table ${tableMatch[1]}`;
  }

  return '';
};

const extractMarkdownImageMentions = (markdown: string): MarkdownImageMention[] => {
  const content = String(markdown || '');
  if (!content) {
    return [];
  }

  const mentions: MarkdownImageMention[] = [];

  const markdownImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownImgRegex.exec(content)) !== null) {
    const alt = String(markdownMatch[1] || '').trim();
    const src = parseMarkdownImageSrcToken(markdownMatch[2] || '');
    const normalizedPath = normalizeMediaPath(src);
    if (!normalizedPath) {
      continue;
    }

    const nearbyText = content.slice(markdownMatch.index + markdownMatch[0].length, markdownMatch.index + markdownMatch[0].length + 280);
    const labelHint = extractFigureOrTableLabelFromNearbyText(nearbyText);

    mentions.push({
      order: mentions.length,
      normalizedPath,
      normalizedFileName: normalizeMediaFileName(path.basename(normalizedPath)),
      alt,
      labelHint
    });
  }

  const htmlImgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlImgRegex.exec(content)) !== null) {
    const normalizedPath = normalizeMediaPath(htmlMatch[1] || '');
    if (!normalizedPath) {
      continue;
    }

    mentions.push({
      order: mentions.length,
      normalizedPath,
      normalizedFileName: normalizeMediaFileName(path.basename(normalizedPath)),
      alt: '',
      labelHint: ''
    });
  }

  return mentions;
};

const buildMentionIndexes = (mentions: MarkdownImageMention[]): {
  orderByPath: Map<string, number>;
  orderByFileName: Map<string, number>;
  altByPath: Map<string, string>;
  altByFileName: Map<string, string>;
  labelByPath: Map<string, string>;
  labelByFileName: Map<string, string>;
} => {
  const orderByPath = new Map<string, number>();
  const orderByFileName = new Map<string, number>();
  const altByPath = new Map<string, string>();
  const altByFileName = new Map<string, string>();
  const labelByPath = new Map<string, string>();
  const labelByFileName = new Map<string, string>();

  for (const mention of mentions) {
    if (!orderByPath.has(mention.normalizedPath)) {
      orderByPath.set(mention.normalizedPath, mention.order);
    }

    if (mention.normalizedFileName && !orderByFileName.has(mention.normalizedFileName)) {
      orderByFileName.set(mention.normalizedFileName, mention.order);
    }

    const cleanAlt = String(mention.alt || '').trim();
    if (cleanAlt) {
      if (!altByPath.has(mention.normalizedPath)) {
        altByPath.set(mention.normalizedPath, cleanAlt);
      }
      if (mention.normalizedFileName && !altByFileName.has(mention.normalizedFileName)) {
        altByFileName.set(mention.normalizedFileName, cleanAlt);
      }
    }

    const cleanLabel = String(mention.labelHint || '').trim();
    if (cleanLabel) {
      if (!labelByPath.has(mention.normalizedPath)) {
        labelByPath.set(mention.normalizedPath, cleanLabel);
      }
      if (mention.normalizedFileName && !labelByFileName.has(mention.normalizedFileName)) {
        labelByFileName.set(mention.normalizedFileName, cleanLabel);
      }
    }
  }

  return { orderByPath, orderByFileName, altByPath, altByFileName, labelByPath, labelByFileName };
};

const extractContentListFromPayload = (payload: any): any[] => {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = [
    payload?.contentList,
    payload?.content_list,
    payload?.data?.contentList,
    payload?.data?.content_list
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
};

const resolveArtifactContentList = async (artifactDir: string): Promise<{ contentList: any[]; source: string }> => {
  const candidates = [
    { filePath: path.join(artifactDir, 'result.json'), source: 'result.json' },
    { filePath: path.join(artifactDir, 'content_list.json'), source: 'content_list.json' }
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.filePath)) {
      continue;
    }

    try {
      const raw = await fs.promises.readFile(candidate.filePath, 'utf8');
      const data = JSON.parse(raw);
      const contentList = extractContentListFromPayload(data);
      if (contentList.length > 0) {
        return { contentList, source: candidate.source };
      }
    } catch (error) {
      console.warn(`[NonTextItems] 读取 ${candidate.source} 失败:`, error);
    }
  }

  return { contentList: [], source: 'none' };
};

const isNonTextBlockType = (type: string): boolean => {
  return ['image', 'figure', 'table', 'equation'].includes(type);
};

const pickFirstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
};

const summarizeTableBody = (value: unknown): string => {
  const text = pickFirstNonEmpty(value);
  if (!text) {
    return '';
  }

  const firstRowMatch = text.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!firstRowMatch) {
    return text.slice(0, 120);
  }

  const rowText = firstRowMatch[1].replace(/<[^>]+>/g, ' ');
  return rowText.replace(/\s+/g, ' ').trim().slice(0, 120);
};

const normalizeBlockType = (block: any): string => {
  return String(block?.type || block?.category || block?.sub_type || '').trim().toLowerCase();
};

const extractBlockCaption = (block: any, blockType: string): string => {
  const imageCaption = Array.isArray(block?.image_caption)
    ? block.image_caption.join(' ')
    : block?.image_caption;
  const tableCaption = Array.isArray(block?.table_caption)
    ? block.table_caption.join(' ')
    : block?.table_caption;

  const equationText = pickFirstNonEmpty(block?.text, block?.latex);
  const equationTagMatch = equationText.match(/\\tag\s*\{([^}]+)\}/i);
  const equationCaption = equationTagMatch ? `公式 ${equationTagMatch[1]}` : (equationText ? equationText.slice(0, 80) : '公式');

  const fallbackByType = blockType === 'table'
    ? pickFirstNonEmpty(summarizeTableBody(block?.table_body), '表格')
    : (blockType === 'equation' ? equationCaption : '图片');

  return pickFirstNonEmpty(block?.caption, imageCaption, tableCaption, fallbackByType);
};

const extractBlockMediaPath = (block: any): string => {
  return pickFirstNonEmpty(
    block?.img_path,
    block?.image_path,
    block?.image,
    block?.table_path,
    block?.path
  );
};

const extractOrderedKeysFromAiResponse = (payload: unknown): string[] => {
  const normalizeKeys = (input: unknown): string[] => {
    if (!Array.isArray(input)) {
      return [];
    }
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  };

  const parseContentText = (raw: unknown): string[] => {
    const text = String(raw || '').trim();
    if (!text) {
      return [];
    }

    const direct = safeJsonParse(text);
    const fromDirect = normalizeKeys(direct?.orderedKeys);
    if (fromDirect.length > 0) {
      return fromDirect;
    }

    const objectJson = text.match(/\{[\s\S]*\}/)?.[0] || '';
    if (objectJson) {
      const parsedObject = safeJsonParse(objectJson);
      const fromObject = normalizeKeys(parsedObject?.orderedKeys);
      if (fromObject.length > 0) {
        return fromObject;
      }
    }

    const listJson = text.match(/\[[\s\S]*\]/)?.[0] || '';
    if (listJson) {
      const parsedList = safeJsonParse(listJson);
      const fromList = normalizeKeys(parsedList);
      if (fromList.length > 0) {
        return fromList;
      }
    }

    return [];
  };

  const data = payload as any;

  const directKeys = normalizeKeys(data?.orderedKeys);
  if (directKeys.length > 0) {
    return directKeys;
  }

  const nestedKeys = normalizeKeys(data?.data?.orderedKeys);
  if (nestedKeys.length > 0) {
    return nestedKeys;
  }

  const candidates = [
    data?.content,
    Array.isArray(data?.content) ? data.content.map((item: any) => item?.text || '').join('\n') : undefined,
    data?.output_text,
    data?.data?.content,
    data?.data?.text,
    data?.message?.content,
    data?.choices?.[0]?.message?.content,
    data?.result?.content,
    data?.output?.[0]?.content?.[0]?.text,
    data?.response?.content
  ];

  for (const candidate of candidates) {
    const keys = parseContentText(candidate);
    if (keys.length > 0) {
      return keys;
    }
  }

  return [];
};

const reorderItemsWithExternalAI = async (
  paperId: string,
  markdownContent: string,
  items: NonTextItem[]
): Promise<{ items: NonTextItem[]; meta: NonTextOrderMeta }> => {
  const nonTextAiConfig = getNonTextOrderAiConfig();
  const aiConfigured = Boolean(nonTextAiConfig.url && nonTextAiConfig.apiKey);

  if (!aiConfigured) {
    return {
      items,
      meta: {
        aiConfigured: false,
        aiInvoked: false,
        aiApplied: false,
        aiReason: '未配置 NON_TEXT_ORDER_AI_URL 或 NON_TEXT_ORDER_AI_API_KEY',
        aiOrderedKeysCount: 0
      }
    };
  }

  if (items.length <= 1) {
    return {
      items,
      meta: {
        aiConfigured: true,
        aiInvoked: false,
        aiApplied: false,
        aiReason: '可排序项不足',
        aiOrderedKeysCount: 0
      }
    };
  }

  try {
    const payload = {
      task: 'reorder_non_text_items',
      model: nonTextAiConfig.model || undefined,
      paperId,
      instructions: [
        '请根据论文中的出现顺序，对非文字元素重新排序。',
        '返回严格 JSON：{"orderedKeys": ["key1", "key2", ...]}。',
        'orderedKeys 只能使用提供的 key，不能新增或修改 key。'
      ].join(' '),
      markdown: String(markdownContent || '').slice(0, 200000),
      items: items.map((item) => ({
        key: item.key,
        caption: item.caption,
        fileName: item.fileName,
        relativePath: item.relativePath,
        orderHint: item.orderHint
      }))
    };

    const promptText = [
      '请根据论文中的出现顺序，对非文字元素重新排序。',
      '返回严格 JSON：{"orderedKeys": ["key1", "key2", ...]}。',
      'orderedKeys 只能使用提供的 key，不能新增或修改 key。',
      JSON.stringify({
        paperId,
        items: payload.items,
        markdown: payload.markdown
      })
    ].join('\n\n');

    const baseUrl = nonTextAiConfig.url.replace(/\/+$/, '');
    const openAiUrl = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    const anthropicUrl = /\/messages$/i.test(baseUrl) ? baseUrl : `${baseUrl}/messages`;

    const attempts: Array<{
      name: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    }> = [
      {
        name: 'generic-json',
        url: baseUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonTextAiConfig.apiKey}`,
          'X-API-Key': nonTextAiConfig.apiKey
        },
        body: payload
      },
      {
        name: 'openai-chat',
        url: openAiUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${nonTextAiConfig.apiKey}`
        },
        body: {
          model: nonTextAiConfig.model || undefined,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: '你是论文图表排序助手。只输出 JSON，不要输出额外文字。'
            },
            {
              role: 'user',
              content: promptText
            }
          ]
        }
      },
      {
        name: 'anthropic-messages',
        url: anthropicUrl,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': nonTextAiConfig.apiKey,
          'anthropic-version': '2023-06-01',
          Authorization: `Bearer ${nonTextAiConfig.apiKey}`
        },
        body: {
          model: nonTextAiConfig.model || undefined,
          temperature: 0,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: promptText
            }
          ]
        }
      }
    ];

    let orderedKeys: string[] = [];
    let successAttemptName = '';
    let lastErrorMessage = '';
    const diagnostics: string[] = [];

    for (const attempt of attempts) {
      try {
        const response = await axios.post(attempt.url, attempt.body, {
          timeout: nonTextAiConfig.timeoutMs,
          headers: attempt.headers
        });

        orderedKeys = extractOrderedKeysFromAiResponse(response.data);
        if (orderedKeys.length > 0) {
          successAttemptName = attempt.name;
          break;
        }

        lastErrorMessage = `${attempt.name} 未返回可解析 orderedKeys`;
        diagnostics.push(lastErrorMessage);
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const responseData = error.response?.data;
          let responseText = '';

          if (typeof responseData === 'string') {
            responseText = responseData;
          } else if (responseData && typeof responseData === 'object') {
            try {
              responseText = JSON.stringify(responseData);
            } catch {
              responseText = '';
            }
          }

          if (status) {
            message = `HTTP ${status}${responseText ? ` ${responseText}` : ''}`;
          }
        }

        const diagnostic = `${attempt.name} 调用失败: ${String(message).slice(0, 260)}`;
        lastErrorMessage = diagnostic;
        diagnostics.push(diagnostic);
      }
    }

    if (!orderedKeys.length) {
      const combinedReason = diagnostics.length > 0
        ? diagnostics.join(' | ').slice(0, 1200)
        : (lastErrorMessage || 'AI 返回中未解析到 orderedKeys');

      return {
        items,
        meta: {
          aiConfigured: true,
          aiInvoked: true,
          aiApplied: false,
          aiReason: combinedReason,
          aiOrderedKeysCount: 0
        }
      };
    }

    const rankMap = new Map<string, number>();
    orderedKeys.forEach((key, index) => {
      if (!rankMap.has(key)) {
        rankMap.set(key, index);
      }
    });

    const defaultRankBase = orderedKeys.length + 1000;
    const sorted = [...items].sort((a, b) => {
      const sourceRankA = Number.isFinite(Number(a.orderHint)) ? Number(a.orderHint) : defaultRankBase;
      const sourceRankB = Number.isFinite(Number(b.orderHint)) ? Number(b.orderHint) : defaultRankBase;

      if (sourceRankA !== sourceRankB) {
        return sourceRankA - sourceRankB;
      }

      const rankA = rankMap.has(a.key) ? Number(rankMap.get(a.key)) : defaultRankBase;
      const rankB = rankMap.has(b.key) ? Number(rankMap.get(b.key)) : defaultRankBase;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.relativePath.localeCompare(b.relativePath, 'en', { numeric: true, sensitivity: 'base' });
    });

    return {
      items: sorted,
      meta: {
        aiConfigured: true,
        aiInvoked: true,
        aiApplied: true,
        aiReason: `AI 排序已应用（${successAttemptName || 'unknown'}）`,
        aiOrderedKeysCount: orderedKeys.length
      }
    };
  } catch (error) {
    console.warn(`[NonTextOrderAI] paper=${paperId} 排序失败，回退本地顺序:`, error);

    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      items,
      meta: {
        aiConfigured: true,
        aiInvoked: true,
        aiApplied: false,
        aiReason: `AI 排序失败，已回退本地顺序: ${message}`,
        aiOrderedKeysCount: 0
      }
    };
  }
};

const restorePaperSectionsFromArtifact = async (paperId: string, artifactDir: string): Promise<boolean> => {
  const candidates = [
    path.join(artifactDir, 'content_list.json'),
    path.join(artifactDir, 'result.json'),
    path.join(artifactDir, 'result.md')
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const ext = path.extname(candidate).toLowerCase();
      let parsed = { sections: [] as Array<{ title: string; order: number; paragraphs: string[] }> };

      if (ext === '.json') {
        const raw = await fs.promises.readFile(candidate, 'utf-8');
        const data = JSON.parse(raw);
        const contentList = data?.contentList || data?.content_list || data?.data?.contentList || data?.data?.content_list;

        if (Array.isArray(contentList) && contentList.length > 0) {
          parsed = parseMineruJson(contentList);
        }
      } else if (ext === '.md') {
        const markdown = await fs.promises.readFile(candidate, 'utf-8');
        if (markdown.trim()) {
          parsed = parseMarkdownContent(markdown);
        }
      }

      if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        for (const sectionData of parsed.sections) {
          const section = await tx.section.create({
            data: {
              paperId,
              title: sectionData.title,
              order: sectionData.order
            }
          });

          for (let index = 0; index < sectionData.paragraphs.length; index += 1) {
            const paragraphText = String(sectionData.paragraphs[index] || '').trim();
            if (!paragraphText) {
              continue;
            }

            await tx.paragraph.create({
              data: {
                sectionId: section.id,
                originalText: paragraphText,
                order: index + 1
              }
            });
          }
        }
      });

      console.log(`[MinerUParse] 论文 ${paperId} 缺失章节已从产物回填成功`);
      return true;
    } catch (error) {
      console.error(`[MinerUParse] 回填章节失败: ${candidate}`, error);
    }
  }

  return false;
};

/**
 * 上传论文并解析
 * POST /api/v2/papers/upload
 */
paperRouter.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      throw new HttpError(400, '请上传文件');
    }

    console.log(`[PaperUpload] 开始处理文件: ${file.originalname}`);

    const filePath = file.path;
    const fileType = path.extname(file.originalname).toLowerCase().replace('.', '');

    // 创建论文记录
    const paper = await prisma.paper.create({
      data: {
        fileName: file.originalname,
        fileType,
        rawContent: JSON.stringify({ status: 'processing', mineruTaskId: 'pending' })
      }
    });

    console.log(`[PaperUpload] 创建论文记录: ${paper.id}`);

    // 异步调用 MinerU 解析（上传本地文件并等待完成）
    parsePaperWithMinerU(paper.id, filePath).catch(err => {
      console.error(`[PaperUpload] MinerU 解析失败 (paper: ${paper.id}):`, err);
    });

    res.json({
      success: true,
      paperId: paper.id,
      message: '文件已上传，正在通过 MinerU 解析中...'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 测试非文字排序 AI 是否可用
 * GET /api/v2/papers/non-text-order-ai/test
 */
paperRouter.get('/non-text-order-ai/test', async (_req, res, next) => {
  try {
    const probeItems: NonTextItem[] = [
      {
        key: 'probe-item-1',
        type: 'image',
        mineruType: 'figure',
        mineruName: 'figure',
        icon: '🖼',
        caption: 'Figure 1',
        fileName: 'fig1.png',
        relativePath: 'images/fig1.png',
        url: '/probe/fig1.png',
        placeholderText: 'probe',
        explanation: 'probe'
      },
      {
        key: 'probe-item-2',
        type: 'image',
        mineruType: 'figure',
        mineruName: 'figure',
        icon: '🖼',
        caption: 'Figure 2',
        fileName: 'fig2.png',
        relativePath: 'images/fig2.png',
        url: '/probe/fig2.png',
        placeholderText: 'probe',
        explanation: 'probe'
      },
      {
        key: 'probe-item-3',
        type: 'image',
        mineruType: 'figure',
        mineruName: 'figure',
        icon: '🖼',
        caption: 'Figure 3',
        fileName: 'fig3.png',
        relativePath: 'images/fig3.png',
        url: '/probe/fig3.png',
        placeholderText: 'probe',
        explanation: 'probe'
      }
    ];

    const probeMarkdown = [
      '# probe',
      '![](images/fig1.png)',
      'Fig. 1 Probe Image',
      '![](images/fig2.png)',
      'Fig. 2 Probe Image',
      '![](images/fig3.png)',
      'Fig. 3 Probe Image'
    ].join('\n');

    const result = await reorderItemsWithExternalAI('__probe__', probeMarkdown, probeItems);
    const available = Boolean(result.meta.aiConfigured && result.meta.aiInvoked && result.meta.aiApplied);

    res.json({
      success: true,
      available,
      service: 'non-text-order-ai',
      checkedAt: new Date().toISOString(),
      meta: result.meta,
      recommendation: available
        ? '排序 AI 可用。'
        : '排序 AI 当前不可用，请根据 meta.aiReason 排查配置、限流或接口路径。'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 读取 AI 设置
 * GET /api/v2/papers/settings/ai
 */
paperRouter.get('/settings/ai', async (_req, res, next) => {
  try {
    let zaiConfig: ReturnType<typeof loadZAIConfig> | null = null;
    let zaiError = '';

    try {
      zaiConfig = loadZAIConfig();
    } catch (error) {
      zaiError = error instanceof Error ? error.message : '读取 ZAI 配置失败';
    }

    const nonTextAi = getNonTextOrderAiConfig();
    const mineruConfig = mineruClient.getPublicConfig();

    res.json({
      success: true,
      settings: {
        zai: {
          configured: Boolean(zaiConfig),
          baseUrl: zaiConfig?.baseUrl || '',
          model: zaiConfig?.model || '',
          chatId: zaiConfig?.chatId || '',
          userId: zaiConfig?.userId || '',
          requestTimeoutMs: zaiConfig?.requestTimeoutMs || 90000,
          maxRetries: zaiConfig?.maxRetries ?? 1,
          retryDelayMs: zaiConfig?.retryDelayMs || 1200,
          apiKeyMasked: maskSecret(zaiConfig?.apiKey || ''),
          tokenMasked: maskSecret(zaiConfig?.token || ''),
          readError: zaiError
        },
        nonTextOrderAi: {
          configured: Boolean(nonTextAi.url && nonTextAi.apiKey),
          url: nonTextAi.url,
          model: nonTextAi.model,
          timeoutMs: nonTextAi.timeoutMs,
          apiKeyMasked: maskSecret(nonTextAi.apiKey)
        },
        mineru: {
          configured: Boolean(String(mineruConfig.tokenMasked || '').trim()),
          baseUrl: mineruConfig.baseUrl,
          modelVersion: mineruConfig.modelVersion,
          pollIntervalMs: mineruConfig.pollIntervalMs,
          pollTimeoutMs: mineruConfig.pollTimeoutMs,
          requestTimeoutMs: mineruConfig.requestTimeoutMs,
          requestMaxRetries: mineruConfig.requestMaxRetries,
          requestRetryDelayMs: mineruConfig.requestRetryDelayMs,
          uploadTimeoutMs: mineruConfig.uploadTimeoutMs,
          uploadMaxRetries: mineruConfig.uploadMaxRetries,
          uploadRetryDelayMs: mineruConfig.uploadRetryDelayMs,
          tokenMasked: mineruConfig.tokenMasked
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 更新 AI 设置（持久化到 .runtime-settings.json）
 * PUT /api/v2/papers/settings/ai
 */
paperRouter.put('/settings/ai', async (req, res, next) => {
  try {
    const zai = req.body?.zai || {};
    const nonTextOrderAi = req.body?.nonTextOrderAi || {};
    const mineru = req.body?.mineru || {};
    const zaiApiKey = String(zai.apiKey || '').trim();
    const zaiToken = String(zai.token || '').trim();
    const nonTextApiKey = String(nonTextOrderAi.apiKey || '').trim();
    const mineruToken = String(mineru.token || '').trim();
    const mineruModelRaw = String(mineru.modelVersion || '').trim();
    const mineruModelVersion: 'vlm' | 'pipeline' | 'MinerU-HTML' =
      mineruModelRaw === 'pipeline' || mineruModelRaw === 'MinerU-HTML'
        ? mineruModelRaw
        : 'vlm';

    const runtimePatch = {
      zai: {
        baseUrl: String(zai.baseUrl || '').trim(),
        model: String(zai.model || '').trim(),
        chatId: String(zai.chatId || '').trim(),
        userId: String(zai.userId || '').trim(),
        requestTimeoutMs: parsePositiveNumber(zai.requestTimeoutMs, 90000),
        maxRetries: Math.max(0, Math.min(5, parsePositiveNumber(zai.maxRetries, 1))),
        retryDelayMs: parsePositiveNumber(zai.retryDelayMs, 1200),
        ...(zaiApiKey ? { apiKey: zaiApiKey } : {}),
        ...(zaiToken ? { token: zaiToken } : {})
      },
      nonTextOrderAi: {
        url: String(nonTextOrderAi.url || '').trim(),
        model: String(nonTextOrderAi.model || '').trim(),
        timeoutMs: parsePositiveNumber(nonTextOrderAi.timeoutMs, 45000),
        ...(nonTextApiKey ? { apiKey: nonTextApiKey } : {})
      },
      mineru: {
        baseUrl: String(mineru.baseUrl || '').trim(),
        modelVersion: mineruModelVersion,
        pollIntervalMs: parsePositiveNumber(mineru.pollIntervalMs, 5000),
        pollTimeoutMs: parsePositiveNumber(mineru.pollTimeoutMs, 600000),
        requestTimeoutMs: parsePositiveNumber(mineru.requestTimeoutMs, 20000),
        requestMaxRetries: Math.max(0, Math.min(10, parsePositiveNumber(mineru.requestMaxRetries, 3))),
        requestRetryDelayMs: parsePositiveNumber(mineru.requestRetryDelayMs, 1200),
        uploadTimeoutMs: parsePositiveNumber(mineru.uploadTimeoutMs, 300000),
        uploadMaxRetries: Math.max(0, Math.min(10, parsePositiveNumber(mineru.uploadMaxRetries, 3))),
        uploadRetryDelayMs: parsePositiveNumber(mineru.uploadRetryDelayMs, 2500),
        ...(mineruToken ? { token: mineruToken } : {})
      }
    };

    updateRuntimeSettings(runtimePatch);
    resetZAIConfigCache();

    res.json({
      success: true,
      message: 'AI 设置已保存',
      savedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 测试 MinerU 配置
 * POST /api/v2/papers/settings/mineru/test
 */
paperRouter.post('/settings/mineru/test', async (_req, res, next) => {
  try {
    const probe = await mineruClient.testConnection();

    res.json({
      success: true,
      available: probe.available,
      service: 'mineru',
      checkedAt: new Date().toISOString(),
      probeCode: probe.probeCode,
      probeMessage: probe.probeMessage,
      recommendation: probe.available
        ? 'MinerU 可用。'
        : 'MinerU 当前不可用，请检查 baseUrl、token 与网络连通性。'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 测试主对话 AI 配置
 * POST /api/v2/papers/settings/ai/test-chat
 */
paperRouter.post('/settings/ai/test-chat', async (_req, res, next) => {
  try {
    resetZAIConfigCache();
    const client = new ZAIClient();
    const reply = await client.chat([
      {
        role: 'system',
        content: '你是连通性测试助手。'
      },
      {
        role: 'user',
        content: '请仅回复：OK'
      }
    ]);

    res.json({
      success: true,
      available: /ok/i.test(String(reply || '')),
      preview: String(reply || '').slice(0, 120),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 查询 MinerU 产物持久化状态
 * GET /api/v2/papers/:id/artifact-status
 */
paperRouter.get('/:id/artifact-status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const paper = await prisma.paper.findUnique({
      where: { id },
      select: { id: true, rawContent: true }
    });

    if (!paper) {
      throw new HttpError(404, '论文不存在');
    }

    const rawContent = safeJsonParse(paper.rawContent);
    const artifactDir = resolvePaperArtifactDir(id, rawContent);
    if (!artifactDir) {
      res.json({ success: true, exists: false, reason: '未找到产物目录' });
      return;
    }

    const mdPath = path.join(artifactDir, 'result.md');
    const jsonPath = path.join(artifactDir, 'result.json');
    const contentListPath = path.join(artifactDir, 'content_list.json');
    const mdContent = fs.existsSync(mdPath) ? await fs.promises.readFile(mdPath, 'utf8') : '';
    const appendixHint = /(\n|^)(appendix|附录|supplementary)/i.test(mdContent);

    res.json({
      success: true,
      exists: true,
      artifactDir,
      files: {
        resultMd: fs.existsSync(mdPath),
        resultJson: fs.existsSync(jsonPath),
        contentListJson: fs.existsSync(contentListPath)
      },
      markdownLength: mdContent.length,
      appendixHint,
      status: rawContent?.status || 'unknown'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 获取论文详情
 * GET /api/v2/papers/:id
 */
paperRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    let paper = await prisma.paper.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: {
            paragraphs: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });

    if (!paper) {
      throw new HttpError(404, '论文不存在');
    }

    const rawContent = safeJsonParse(paper.rawContent);
    if (paper.sections.length === 0 && rawContent?.status === 'completed' && typeof rawContent?.mineruPath === 'string') {
      const recovered = await restorePaperSectionsFromArtifact(paper.id, rawContent.mineruPath);
      if (recovered) {
        paper = await prisma.paper.findUnique({
          where: { id },
          include: {
            sections: {
              orderBy: { order: 'asc' },
              include: {
                paragraphs: {
                  orderBy: { order: 'asc' }
                }
              }
            }
          }
        });

        if (!paper) {
          throw new HttpError(404, '论文不存在');
        }
      }
    }

    res.json({ success: true, paper });
  } catch (error) {
    next(error);
  }
});

/**
 * 获取论文的本地非文字内容（图片等）
 * GET /api/v2/papers/:id/non-text-items
 */
paperRouter.get('/:id/non-text-items', async (req, res, next) => {
  try {
    const { id } = req.params;

    const paper = await prisma.paper.findUnique({
      where: { id },
      select: {
        id: true,
        rawContent: true
      }
    });

    if (!paper) {
      throw new HttpError(404, '论文不存在');
    }

    const rawContent = safeJsonParse(paper.rawContent);
    const artifactDir = resolvePaperArtifactDir(id, rawContent);

    if (!artifactDir) {
      res.json({ success: true, items: [] });
      return;
    }

    const imageExtSet = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
    const allFiles = await walkFilesRecursively(artifactDir);
    const markdownPath = path.join(artifactDir, 'result.md');
    const markdownContent = fs.existsSync(markdownPath)
      ? await fs.promises.readFile(markdownPath, 'utf8')
      : '';

    const mentions = extractMarkdownImageMentions(markdownContent);
    const mentionIndexes = buildMentionIndexes(mentions);

    const { contentList, source: contentListSource } = await resolveArtifactContentList(artifactDir);

    const imageEntries = allFiles
      .filter((absPath) => imageExtSet.has(path.extname(absPath).toLowerCase()))
      .map((absPath) => {
        const relativePath = path.relative(artifactDir, absPath).replace(/\\/g, '/');
        const normalizedPath = normalizeMediaPath(relativePath);
        const fileName = path.basename(relativePath);
        const normalizedFileName = normalizeMediaFileName(fileName);

        const orderFromPath = mentionIndexes.orderByPath.get(normalizedPath);
        const orderFromFileName = mentionIndexes.orderByFileName.get(normalizedFileName);
        const orderHint = Number.isFinite(orderFromPath)
          ? Number(orderFromPath)
          : (Number.isFinite(orderFromFileName) ? Number(orderFromFileName) : Number.MAX_SAFE_INTEGER);

          const labelFromPath = mentionIndexes.labelByPath.get(normalizedPath);
          const labelFromFileName = mentionIndexes.labelByFileName.get(normalizedFileName);
        const captionFromPath = mentionIndexes.altByPath.get(normalizedPath);
        const captionFromFileName = mentionIndexes.altByFileName.get(normalizedFileName);
          const caption = String(
            labelFromPath ||
            labelFromFileName ||
            captionFromPath ||
            captionFromFileName ||
            ''
          ).trim() || fileName || toDisplayCaptionFromFileName(fileName);

        return {
          absPath,
          relativePath,
          normalizedPath,
          fileName,
          normalizedFileName,
          orderHint,
          caption
        };
      })
      .sort((a, b) => {
        if (a.orderHint !== b.orderHint) {
          return a.orderHint - b.orderHint;
        }

        return a.relativePath.localeCompare(b.relativePath, 'en', { numeric: true, sensitivity: 'base' });
      });

    const imageEntryByPath = new Map<string, (typeof imageEntries)[number]>();
    const imageEntryByFileName = new Map<string, (typeof imageEntries)[number]>();

    for (const entry of imageEntries) {
      if (entry.normalizedPath && !imageEntryByPath.has(entry.normalizedPath)) {
        imageEntryByPath.set(entry.normalizedPath, entry);
      }

      if (entry.normalizedFileName && !imageEntryByFileName.has(entry.normalizedFileName)) {
        imageEntryByFileName.set(entry.normalizedFileName, entry);
      }
    }

    let items: NonTextItem[] = [];
    let orderMeta: NonTextOrderMeta;
    let baseOrderSource = 'markdown-image-sequence';

    if (Array.isArray(contentList) && contentList.length > 0) {
      baseOrderSource = 'content-list-sequence';

      const referencedRelativePathSet = new Set<string>();
      const contentOrderedItems: NonTextItem[] = [];

      for (let blockIndex = 0; blockIndex < contentList.length; blockIndex += 1) {
        const block = contentList[blockIndex];
        const blockType = normalizeBlockType(block);
        if (!isNonTextBlockType(blockType)) {
          continue;
        }

        const mediaPath = normalizeMediaPath(extractBlockMediaPath(block));
        const mediaFileName = normalizeMediaFileName(path.basename(mediaPath || ''));
        const matchedEntry = (mediaPath ? imageEntryByPath.get(mediaPath) : undefined)
          || (mediaFileName ? imageEntryByFileName.get(mediaFileName) : undefined);

        const relativePath = matchedEntry?.relativePath || mediaPath;
        const fileName = matchedEntry?.fileName || path.basename(relativePath || '');
        const hasPreview = Boolean(relativePath);
        const url = hasPreview ? `/mineru-results/${id}/${relativePath}` : '';

        const normalizedType = blockType === 'figure' ? 'image' : blockType;
        const itemType: NonTextItem['type'] = normalizedType === 'image' || normalizedType === 'table' || normalizedType === 'equation'
          ? normalizedType
          : 'other';
        const icon: NonTextItem['icon'] = itemType === 'table'
          ? '📊'
          : (itemType === 'equation' ? '∑' : '🖼');

        const caption = pickFirstNonEmpty(
          extractBlockCaption(block, blockType),
          matchedEntry?.caption,
          fileName,
          itemType === 'table' ? '表格' : (itemType === 'equation' ? '公式' : '图片')
        );
        const mineruName = pickFirstNonEmpty(
          caption,
          block?.sub_type,
          block?.type,
          block?.category,
          fileName
        );

        const pageIdx = Number(block?.page_idx ?? block?.page_num ?? block?.page);
        const pageLabel = Number.isFinite(pageIdx) ? `第 ${pageIdx + 1} 页` : '未知页';
        const detail = blockType === 'table'
          ? summarizeTableBody(block?.table_body)
          : (blockType === 'equation' ? pickFirstNonEmpty(block?.text, block?.latex) : pickFirstNonEmpty(block?.image_footnote, block?.image_caption));
        const explanation = pickFirstNonEmpty(`来源：${pageLabel} · ${blockType}`, detail ? `说明：${detail}` : '');

        if (matchedEntry?.relativePath) {
          referencedRelativePathSet.add(matchedEntry.relativePath);
        }

        contentOrderedItems.push({
          key: `content-${blockType || 'non-text'}-${blockIndex}`,
          type: itemType,
          mineruType: String(blockType || 'unknown'),
          mineruName,
          icon,
          caption,
          fileName,
          relativePath,
          url,
          placeholderText: hasPreview ? '本地图片预览不可用' : '当前内容暂无可预览图片',
          explanation,
          orderHint: blockIndex
        });
      }

      let fallbackOrder = contentList.length + 1000;
      for (const entry of imageEntries) {
        if (referencedRelativePathSet.has(entry.relativePath)) {
          continue;
        }

        fallbackOrder += 1;
        contentOrderedItems.push({
          key: `local-image-fallback-${entry.relativePath}`,
          type: 'image',
          mineruType: 'image',
          mineruName: entry.fileName || entry.caption,
          icon: '🖼',
          caption: entry.caption,
          fileName: entry.fileName,
          relativePath: entry.relativePath,
          url: `/mineru-results/${id}/${entry.relativePath}`,
          placeholderText: '本地图片预览不可用',
          explanation: '来源：本地图片（未命中 contentList）',
          orderHint: fallbackOrder
        });
      }

      items = contentOrderedItems.sort((a, b) => {
        const orderA = Number.isFinite(Number(a.orderHint)) ? Number(a.orderHint) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b.orderHint)) ? Number(b.orderHint) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.key.localeCompare(b.key, 'en', { numeric: true, sensitivity: 'base' });
      });

      orderMeta = {
        aiConfigured: Boolean(getNonTextOrderAiConfig().url && getNonTextOrderAiConfig().apiKey),
        aiInvoked: false,
        aiApplied: false,
        aiReason: `已按 ${contentListSource} 的 contentList 顺序返回`,
        aiOrderedKeysCount: 0
      };
    } else {
      items = imageEntries.map((entry) => {
        return {
          key: `local-image-${entry.relativePath}`,
          type: 'image',
          mineruType: 'image',
          mineruName: entry.fileName || entry.caption,
          icon: '🖼',
          caption: entry.caption,
          fileName: entry.fileName,
          relativePath: entry.relativePath,
          url: `/mineru-results/${id}/${entry.relativePath}`,
          placeholderText: '本地图片预览不可用',
          explanation: '来源：论文中的非文字元素',
          orderHint: entry.orderHint
        };
      });

      const reorderResult = await reorderItemsWithExternalAI(id, markdownContent, items);
      items = reorderResult.items;
      orderMeta = reorderResult.meta;
    }

    res.json({
      success: true,
      count: items.length,
      items,
      orderMeta: {
        baseOrderSource,
        ...orderMeta
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 翻译单个段落
 * POST /api/v2/papers/paragraphs/:id/translate
 */
paperRouter.post('/paragraphs/:id/translate', async (req, res, next) => {
  try {
    const { id } = req.params;

    // 获取段落
    const paragraph = await prisma.paragraph.findUnique({
      where: { id },
      include: {
        translations: {
          orderBy: { id: 'desc' },
          take: 1
        }
      }
    });

    if (!paragraph) {
      throw new HttpError(404, '段落不存在');
    }

    // 如果已有缓存，直接返回
    if (paragraph.translations.length > 0) {
      res.json({ success: true, translation: paragraph.translations[0] });
      return;
    }

    // 调用 AI 翻译
    const aiClient = new ZAIClient();
    const translation = await aiClient.chat([
      {
        role: 'system',
        content: '你是一位专业的学术论文翻译助手。请将以下英文内容翻译为流畅、准确的中文。保持专业术语的准确性，并在必要时保留英文原文。'
      },
      {
        role: 'user',
        content: paragraph.originalText
      }
    ]);

    // 保存翻译
    const savedTranslation = await prisma.translation.create({
      data: {
        paragraphId: id,
        content: translation
      }
    });

    res.json({ success: true, translation: savedTranslation });
  } catch (error) {
    next(error);
  }
});

/**
 * 讲解单个段落
 * POST /api/v2/papers/paragraphs/:id/explain
 */
paperRouter.post('/paragraphs/:id/explain', async (req, res, next) => {
  try {
    const { id } = req.params;

    // 获取段落
    const paragraph = await prisma.paragraph.findUnique({
      where: { id },
      include: {
        explanations: {
          orderBy: { id: 'desc' },
          take: 1
        }
      }
    });

    if (!paragraph) {
      throw new HttpError(404, '段落不存在');
    }

    // 如果已有缓存，直接返回
    if (paragraph.explanations.length > 0) {
      res.json({ success: true, explanation: paragraph.explanations[0] });
      return;
    }

    // 调用 AI 讲解
    const aiClient = new ZAIClient();
    const explanation = await aiClient.chat([
      {
        role: 'system',
        content: `【角色设定】
你是一位顶级的"AI前沿论文拆解导师"。你的特长是将晦涩难懂、充满数学公式和学术黑话的AI顶会论文，转化为连非科班出身的读者都能听懂的"大白话"故事。你的讲解风格幽默犀利、一针见血，极其擅长使用生活中的比喻（如考试、下棋、花钱算账等）来降维打击复杂概念。

【铁律与执行规范（必须严格遵守）】

绝对逐段，绝不合并：
禁止将几段话总结成一大段。
必须以论文的自然段落为单位，一段一段地讲解。哪怕是一句过渡句，也要单独拿出来点明它的作用。

标准格式（每一段都必须长这样）：
"引用论文原文的一整段话…"
讲解： （换行）用接地气的大白话解释这段话。必须要回答几个问题：作者在这段想表达什么？为什么这么规定？有什么潜台词？如果可以，一定要用比喻（比如把模型比作学生，把验证器比作裁判，把算力比作预算）。

抓住"灵魂"与"反直觉点"：
不要做无情的翻译机器。如果某段话隐藏了一个"大坑"、一个"反直觉的惊人发现"（比如：越高级的搜索反而越差），必须用加粗、感叹号等方式重点强调，像说书人一样抖包袱。

语言风格：
拒绝生硬的学术腔调。
多用短句。
允许使用适度的情绪化词汇（如："太天真了"、"大跌眼镜"、"极其精妙"、"一记响亮的耳光"、"这就有点扯了"）。`
      },
      {
        role: 'user',
        content: `请讲解以下论文章节中的一段内容：\n\n${paragraph.originalText}`
      }
    ]);

    // 保存讲解
    const savedExplanation = await prisma.explanation.create({
      data: {
        paragraphId: id,
        content: explanation
      }
    });

    res.json({ success: true, explanation: savedExplanation });
  } catch (error) {
    next(error);
  }
});

/**
 * 追问功能
 * POST /api/v2/papers/follow-up
 */
paperRouter.post('/follow-up', async (req, res, next) => {
  try {
    const { parentId, parentType, question } = req.body;

    if (!parentId || !parentType || !question) {
      throw new HttpError(400, '缺少必要参数：parentId, parentType, question');
    }

    if (!['TRANSLATION', 'EXPLANATION'].includes(parentType)) {
      throw new HttpError(400, 'parentType 必须是 TRANSLATION 或 EXPLANATION');
    }

    // 获取父内容作为上下文
    let parentContent = '';
    if (parentType === 'TRANSLATION') {
      const translation = await prisma.translation.findUnique({
        where: { id: parentId },
        include: { paragraph: true }
      });
      if (translation) {
        parentContent = `原文：${translation.paragraph.originalText}\n\n翻译：${translation.content}`;
      }
    } else {
      const explanation = await prisma.explanation.findUnique({
        where: { id: parentId },
        include: { paragraph: true }
      });
      if (explanation) {
        parentContent = `原文：${explanation.paragraph.originalText}\n\n讲解：${explanation.content}`;
      }
    }

    if (!parentContent) {
      throw new HttpError(404, '找不到对应的内容');
    }

    // 调用 AI 回答追问
    const aiClient = new ZAIClient();
    const answer = await aiClient.chat([
      {
        role: 'system',
        content: '你是一位耐心的论文讲解助手。请根据用户的追问，结合上下文给出清晰、易懂的解答。可以使用比喻、举例等方式帮助用户理解。'
      },
      {
        role: 'user',
        content: `上下文：\n${parentContent}\n\n用户的问题：\n${question}`
      }
    ]);

    // 保存追问记录
    const followUp = await prisma.followUpQuestion.create({
      data: {
        parentId,
        parentType,
        question,
        answer
      }
    });

    res.json({ success: true, followUp });
  } catch (error) {
    next(error);
  }
});

/**
 * 开始论文对话式讲解会话
 * POST /api/v2/papers/:id/study-session/start
 */
paperRouter.post('/:id/study-session/start', async (req, res, next) => {
  try {
    const { id: paperId } = req.params;

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: {
            paragraphs: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });

    if (!paper) {
      throw new HttpError(404, '论文不存在');
    }

    const allParagraphs = paper.sections.flatMap((section) =>
      section.paragraphs.map((paragraph) => ({
        id: paragraph.id,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionOrder: section.order,
        order: paragraph.order,
        originalText: paragraph.originalText
      }))
    );

    if (allParagraphs.length === 0) {
      throw new HttpError(400, '论文尚未解析完成，暂时无法开始讲解');
    }

    const session = studySessionManager.createSession(paperId, allParagraphs);
    const currentPart = studySessionManager.getCurrentPart(session);

    const aiClient = new ZAIClient();
    const assistantMessage = await aiClient.chat([
      {
        role: 'system',
        content: '你是一位论文陪读助手。请以对话形式讲解当前部分，语言简洁、清晰，尽量使用短段落并保留换行。输出必须先原样保留当前段落的英文原文，再给中文译文和讲解；英文原文不得改写、不得省略。对公式请尽量保留原始 LaTeX 形式，不要把公式改成纯中文描述。先讲核心，再给一个易懂例子，最后给出一句“你可以回复：下一部分 / 下一章 / 提问”。如果当前内容提到图、表、公式或附图，请明确指出它们在这一段中的定位和作用。'
      },
      {
        role: 'user',
        content: `请开始讲解这篇论文的第一部分。\n章节：${currentPart.sectionTitle}\n内容：\n${currentPart.partText}\n\n输出格式要求：先原文，再译文，再讲解。`
      }
    ]);

    studySessionManager.appendTurn(session.id, 'user', '开始看论文');
    studySessionManager.appendTurn(session.id, 'assistant', assistantMessage);

    res.json({
      success: true,
      sessionId: session.id,
      message: assistantMessage,
      progress: studySessionManager.getProgress(session)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 会话内对话消息
 * POST /api/v2/papers/study-session/:sessionId/message
 */
paperRouter.post('/study-session/:sessionId/message', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const message = String(req.body?.message || '').trim();

    if (!message) {
      throw new HttpError(400, '消息不能为空');
    }

    const session = studySessionManager.getSession(sessionId);
    if (!session) {
      throw new HttpError(404, '会话不存在或已过期');
    }

    studySessionManager.appendTurn(session.id, 'user', message);

    const normalized = message.toLowerCase();
    const wantsNextPart = /下一部分|继续|next/.test(message) || normalized === 'next';
    const wantsNextSection = /下一章|下一节/.test(message);

    if (wantsNextSection) {
      const moved = studySessionManager.moveToNextSection(session);
      if (!moved) {
        const doneMessage = '已经到最后一章了。你可以继续提问，或者回复“回顾总结”让我总结全文。';
        studySessionManager.appendTurn(session.id, 'assistant', doneMessage);
        res.json({ success: true, message: doneMessage, progress: studySessionManager.getProgress(session), finished: true });
        return;
      }
    } else if (wantsNextPart) {
      const moved = studySessionManager.moveToNextPart(session);
      if (!moved) {
        const doneMessage = '已经讲到最后一部分了。你可以继续提问，或者回复“回顾总结”让我总结全文。';
        studySessionManager.appendTurn(session.id, 'assistant', doneMessage);
        res.json({ success: true, message: doneMessage, progress: studySessionManager.getProgress(session), finished: true });
        return;
      }
    }

    const currentPart = studySessionManager.getCurrentPart(session);
    const aiClient = new ZAIClient();

    const assistantMessage = wantsNextPart || wantsNextSection
      ? await aiClient.chat([
          {
            role: 'system',
            content: '你是一位论文陪读助手。请继续讲解当前部分：先原样引用英文原文，再给中文译文，最后分点解释，并提醒用户可回复“下一部分”。输出尽量保留换行，必要时用 Markdown 的小标题或列表。如果当前内容提到图、表、公式或附图，请明确指出它们在这一段中的定位和作用。'
          },
          {
            role: 'user',
            content: `继续讲解。\n章节：${currentPart.sectionTitle}\n内容：\n${currentPart.partText}\n\n会话记忆：${session.memorySummary || '无'}`
          }
        ])
      : await aiClient.chat([
          {
            role: 'system',
            content: '你是一位论文答疑助手。请只基于当前部分与会话记忆回答，回答简洁、具体、避免空话。输出尽量保留换行，必要时用 Markdown 的段落或列表。若引用当前内容，请尽量保留英文原文，不要只给中文概括。若问题涉及图、表、公式或附图，请明确指出相关位置。'
          },
          {
            role: 'user',
            content: `当前章节：${currentPart.sectionTitle}\n当前内容：\n${currentPart.partText}\n\n用户问题：${message}\n\n会话记忆：${session.memorySummary || '无'}`
          }
        ]);

    studySessionManager.appendTurn(session.id, 'assistant', assistantMessage);

    res.json({
      success: true,
      message: assistantMessage,
      progress: studySessionManager.getProgress(session),
      finished: false
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 获取追问记录
 * GET /api/v2/papers/follow-up/:parentId
 */
paperRouter.get('/follow-up/:parentId', async (req, res, next) => {
  try {
    const { parentId } = req.params;

    const followUps = await prisma.followUpQuestion.findMany({
      where: { parentId },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ success: true, followUps });
  } catch (error) {
    next(error);
  }
});

/**
 * 生成结构化摘要，把失败原因落库而不是往外抛。
 * 解析主链路不 await 它，所以这里必须自己吞掉异常——否则一个未捕获的
 * rejection 会把整个解析进程的报错语义搞乱。
 */
async function generatePaperSummary(paperId: string) {
  try {
    await paperSummaryGenerator.generate(paperId);
    console.log(`[MinerUParse] 论文 ${paperId} 结构化摘要生成完成`);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await prisma.paper.update({
      where: { id: paperId },
      data: { summaryStatus: 'failed', summaryError: message.slice(0, 1000) }
    }).catch(() => {});
  }
}

/**
 * 重新生成结构化摘要（同步返回，前端按钮带 loading）
 * POST /api/v2/papers/:id/summary/regenerate
 */
paperRouter.post('/:id/summary/regenerate', async (req, res, next) => {
  try {
    const { id } = req.params;

    const paper = await prisma.paper.findUnique({
      where: { id },
      include: { sections: { select: { id: true } } }
    });

    if (!paper) {
      throw new HttpError(404, '论文不存在');
    }

    if (paper.sections.length === 0) {
      throw new HttpError(400, '论文尚未解析完成，暂时无法生成摘要');
    }

    const result = await paperSummaryGenerator.generate(id, true);

    res.json({ success: true, summary: result });
  } catch (error) {
    next(error);
  }
});

/**
 * 异步解析论文（后台任务）- 核心逻辑：智能归属 + 图片处理
 */
async function parsePaperWithMinerU(paperId: string, filePath: string) {
  try {
    console.log(`[MinerUParse] 开始解析论文: ${paperId}`);
    console.log(`[MinerUParse] 文件路径: ${filePath}`);

    // 1. 调用 MinerU 解析
    const result = await mineruClient.uploadAndExtract(filePath);

    const artifactDir = path.join(process.cwd(), 'uploads', 'mineru-results-2', paperId);
    const imageDir = path.join(artifactDir, 'images');
    await fs.promises.mkdir(imageDir, { recursive: true });

    const contentList = Array.isArray(result?.contentList)
      ? result.contentList
      : (Array.isArray(result?.content_list) ? result.content_list : null);
    const markdownContent = typeof result?.markdown === 'string' ? result.markdown : '';

    // 2. 保存图片文件
    let imageMap: Record<string, string> = {}; // 原始文件名 -> 本地存储路径
    if (Array.isArray(result?.images)) {
      await Promise.all(result.images.map(async (image: any) => {
        const imageName = String(image?.name || path.basename(String(image?.path || ''))).trim();
        const imageRelPath = String(image?.path || imageName).replace(/\\/g, '/').replace(/^\/+/, '');
        const localPath = path.join(imageDir, imageName);
        await fs.promises.writeFile(localPath, Buffer.from(image.data));
        // 生成前端可访问的 URL
        imageMap[imageName] = `/mineru-results/${paperId}/images/${imageName}`;
        imageMap[`images/${imageName}`] = `/mineru-results/${paperId}/images/${imageName}`;
        if (imageRelPath) {
          imageMap[imageRelPath] = `/mineru-results/${paperId}/${imageRelPath}`;
        }
      }));
    }

    console.log(`[MinerUParse] 保存了 ${Object.keys(imageMap).length} 张图片`);

    // 保存 MinerU 返回快照，便于重传后直接核对顺序与字段
    const resultSnapshot = {
      taskId: result?.taskId ?? null,
      state: result?.state ?? null,
      filename: result?.filename ?? null,
      zipUrl: result?.zipUrl ?? null,
      error: result?.error ?? null,
      progress: result?.progress ?? null,
      markdown: markdownContent || null,
      contentList,
      html: typeof result?.html === 'string' ? result.html : null,
      latex: typeof result?.latex === 'string' ? result.latex : null,
      images: Array.isArray(result?.images)
        ? result.images.map((image: any) => ({
            name: String(image?.name || ''),
            path: String(image?.path || ''),
            byteLength: Number(image?.data?.byteLength ?? image?.data?.length ?? 0)
          }))
        : []
    };

    await fs.promises.writeFile(
      path.join(artifactDir, 'result.json'),
      JSON.stringify(resultSnapshot, null, 2),
      'utf-8'
    );

    if (Array.isArray(contentList)) {
      await fs.promises.writeFile(
        path.join(artifactDir, 'content_list.json'),
        JSON.stringify(contentList, null, 2),
        'utf-8'
      );
    }

    if (markdownContent) {
      await fs.promises.writeFile(path.join(artifactDir, 'result.md'), markdownContent, 'utf-8');
    }

    // 3. 核心：基于 contentList 进行智能归属
    if (Array.isArray(contentList) && contentList.length > 0) {
      const blockIndexMap = new Map<any, number>();
      contentList.forEach((block, index) => {
        blockIndexMap.set(block, index);
      });
      const orderedContentList = [...contentList].sort((left, right) => {
        return compareMineruBlocks(
          getMineruBlockSortKey(left, blockIndexMap.get(left) ?? 0),
          getMineruBlockSortKey(right, blockIndexMap.get(right) ?? 0)
        );
      });

      console.log(`[MinerUParse] 检测到 contentList (${contentList.length} 个块)，开始智能解析...`);

      // 使用事务保证数据一致性
      await prisma.$transaction(async (tx) => {
        let currentSectionId: string | null = null;
        let sectionOrder = 0;
        let paragraphOrder = 0;

        const ensureSection = async (title: string) => {
          if (currentSectionId) {
            return currentSectionId;
          }

          sectionOrder++;
          paragraphOrder = 0;

          const section = await tx.section.create({
            data: {
              paperId,
              title,
              order: sectionOrder
            }
          });

          currentSectionId = section.id;
          return currentSectionId;
        };

        for (const block of orderedContentList) {
          const category = String(block.type || block.category || block.sub_type || '').toLowerCase();
          const text = String(block.text || block.polygon_text || '').trim();
          const textLevel = Number(block.text_level ?? 0);
          const isHeadingLikeCategory = category === 'title' || category === 'header' || category === 'section_title';
          const isHeadingBlock = (isHeadingLikeCategory || (category === 'text' && textLevel === 1)) && looksLikeSectionHeading(text);

          // 3.1 处理章节标题
          if (isHeadingBlock) {
            sectionOrder++;
            paragraphOrder = 0; // 重置段落计数

            // 创建章节
            const section = await tx.section.create({
              data: {
                paperId,
                title: text,
                order: sectionOrder
              }
            });
            currentSectionId = section.id;
            console.log(`[MinerUParse] 识别章节: ${text}`);
          } 
          // 3.2 处理正文、图片、表格
          else if (category === 'text' || category === 'figure' || category === 'table' || category === 'equation' || category === 'list') {
            let paragraphContent = '';

            if (category === 'text' || category === 'equation') {
              paragraphContent = text;
            } else if (category === 'figure') {
              // 图片转为 Markdown
              // 尝试从 block 中提取图片名称
              const imgName = String(block.image_path || block.img_path || block.image || '').trim();
              const imgUrl = imageMap[imgName] || '';
              const captionCandidates = [
                block.caption,
                Array.isArray(block.image_caption) ? block.image_caption.join(' ') : block.image_caption,
                text
              ];
              const caption = captionCandidates
                .map((item) => String(item || '').trim())
                .find((item) => item.length > 0) || 'Figure';
              paragraphContent = imgUrl 
                ? `![${caption}](${imgUrl})` 
                : `**[${caption}] (图片加载失败)**`;
            } else if (category === 'table') {
              // 表格通常以 Markdown 格式存在于 text 中，或者 HTML
              paragraphContent = text.trim() || block.html || '**[表格内容]**';
            } else if (category === 'list') {
              const listItems = Array.isArray(block.list_items)
                ? block.list_items.map((item: unknown) => String(item || '').trim()).filter(Boolean)
                : [];
              paragraphContent = listItems.length > 0 ? listItems.join('\n') : text;
            }

            if (paragraphContent.length > 0) {
              const sectionId = currentSectionId || await ensureSection('前言/摘要');
              paragraphOrder++;
              await tx.paragraph.create({
                data: {
                  sectionId,
                  originalText: paragraphContent,
                  order: paragraphOrder
                }
              });
            }
          }
        }
      });

      console.log(`[MinerUParse] 智能解析完成`);
    } else {
      // 降级处理：如果只有 Markdown 文本
      const markdownContent = typeof result?.markdown === 'string' ? result.markdown : '';
      if (markdownContent.length < 100) throw new Error('提取内容过短');

      console.log(`[MinerUParse] 未检测到 contentList，使用 Markdown 降级解析...`);
      const parsed = parseMarkdownContent(markdownContent);
      const flattened = flattenParsedContent(parsed);

      await prisma.$transaction(async (tx) => {
        await tx.paper.update({ where: { id: paperId }, data: {} }); // 占位
        for (const sec of flattened.sections) {
          const section = await tx.section.create({
            data: { paperId, title: sec.title, order: sec.order }
          });
          for (const para of flattened.paragraphs.filter(p => p.sectionOrder === sec.order)) {
            await tx.paragraph.create({
              data: { sectionId: section.id, originalText: para.text, order: para.order }
            });
          }
        }
      });
    }

    // 4. 更新论文状态为完成
    await prisma.paper.update({
      where: { id: paperId },
      data: { 
        rawContent: JSON.stringify({ 
          status: 'completed', 
          mineruPath: artifactDir, // 路径存入 JSON 字段
          extractedAt: new Date() 
        })
      }
    });

    console.log(`[MinerUParse] 论文 ${paperId} 解析并入库成功！`);

    // 5. 结构化摘要：解析完成后异步生成。
    // 故意不 await——用户拿到章节就能开始读了，摘要不该挡在"能看论文"前面。
    // 摘要失败只把 summaryStatus 置为 failed，不回滚已入库的章节。
    generatePaperSummary(paperId).catch((error) => {
      console.error(`[MinerUParse] 结构化摘要任务异常 (paper: ${paperId}):`, error);
    });

    
    // 清理临时文件
    try { await fs.promises.unlink(filePath); } catch {}

  } catch (error: any) {
    console.error(`[MinerUParse] 解析失败 (paper: ${paperId}):`, error);
    await prisma.paper.update({
      where: { id: paperId },
      data: { rawContent: JSON.stringify({ status: 'failed', error: error.message }) }
    }).catch(() => {});
  }
}

// 将 paperRouter 挂载到主 router 的 /papers 路径下
router.use('/papers', paperRouter);

export { router as paperRouter };

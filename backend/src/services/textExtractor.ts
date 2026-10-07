import path from "node:path";
import { createRequire } from "node:module";

import mammoth from "mammoth";

import { HttpError } from "../utils/errors.js";

const require = createRequire(import.meta.url);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md"] as const;

const allowedExtensionSet = new Set<string>(ALLOWED_EXTENSIONS);

const resolveStandardFontDataUrl = (): string | undefined => {
  try {
    const pdfjsPkgPath = require.resolve("pdfjs-dist/package.json");
    const standardFontsPath = path.join(path.dirname(pdfjsPkgPath), "standard_fonts");
    return standardFontsPath.endsWith(path.sep) ? standardFontsPath : `${standardFontsPath}${path.sep}`;
  } catch {
    return undefined;
  }
};

const standardFontDataUrl = resolveStandardFontDataUrl();

const normalizeText = (rawText: string): string => {
  return rawText
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const validateFileExtension = (fileName: string): void => {
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedExtensionSet.has(extension)) {
    throw new HttpError(400, "仅支持 PDF、DOCX、DOC、TXT、MD 格式文件。");
  }
};

export const validateUploadedFile = (file: Express.Multer.File | undefined): Express.Multer.File => {
  if (!file) {
    throw new HttpError(400, "请先上传论文文件。");
  }

  validateFileExtension(file.originalname);

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, "文件大小不能超过 20MB。");
  }

  return file;
};

const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const initParams: Record<string, unknown> = {
    data: new Uint8Array(buffer),
    useWorkerFetch: false
  };

  if (standardFontDataUrl) {
    initParams.standardFontDataUrl = standardFontDataUrl;
  }

  const loadingTask = (pdfjs as any).getDocument(initParams);
  const pdfDocument = await loadingTask.promise;

  const pageTexts: string[] = [];

  for (let i = 1; i <= pdfDocument.numPages; i += 1) {
    const page = await pdfDocument.getPage(i);
    const content = await page.getTextContent();
    const line = (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? "")
      .join(" ")
      .trim();
    pageTexts.push(line);
  }

  if (typeof loadingTask.destroy === "function") {
    loadingTask.destroy();
  }

  return pageTexts.join("\n");
};

const extractDocText = async (buffer: Buffer): Promise<string> => {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
};

const extractPlainText = (buffer: Buffer): string => buffer.toString("utf8");

const normalizeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "未知错误";
};

const toExtractError = (extension: string, error: unknown): HttpError => {
  const detail = normalizeErrorMessage(error);

  if (extension === ".pdf") {
    return new HttpError(400, `PDF 解析失败，请确认文件未损坏或加密后重试。详情：${detail}`);
  }

  if (extension === ".doc" || extension === ".docx") {
    return new HttpError(400, `Word 文档解析失败，建议优先使用 DOCX 并检查文件完整性。详情：${detail}`);
  }

  if (extension === ".txt" || extension === ".md") {
    return new HttpError(400, `文本文件读取失败，请确认文件编码为 UTF-8。详情：${detail}`);
  }

  return new HttpError(400, `文件解析失败，请更换文件后重试。详情：${detail}`);
};

export const extractTextFromUploadedFile = async (rawFile: Express.Multer.File | undefined): Promise<string> => {
  const file = validateUploadedFile(rawFile);
  const extension = path.extname(file.originalname).toLowerCase();

  let extracted = "";

  try {
    if (extension === ".pdf") {
      extracted = await extractPdfText(file.buffer);
    } else if (extension === ".docx" || extension === ".doc") {
      extracted = await extractDocText(file.buffer);
    } else if (extension === ".txt" || extension === ".md") {
      extracted = extractPlainText(file.buffer);
    } else {
      throw new HttpError(400, "文件格式不受支持，请重新上传。");
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw toExtractError(extension, error);
  }

  const normalized = normalizeText(extracted);

  if (normalized.length < 120) {
    throw new HttpError(400, "提取到的文本过短，请上传更完整的论文文件。");
  }

  return normalized;
};

import express from "express";
import multer from "multer";

import { prisma } from "../lib/prisma.js";
import { PaperAnalyzer } from "../services/paperAnalyzer.js";
import {
  MAX_UPLOAD_BYTES,
  extractTextFromUploadedFile,
  validateFileExtension
} from "../services/textExtractor.js";
import type { AnalyzeSourceType, PaperSection } from "../types/paper.js";
import { HttpError } from "../utils/errors.js";

export interface RecordAnalysisPayload {
  sourceType: AnalyzeSourceType;
  contentChars: number;
  sections: PaperSection[];
  fileName?: string;
  extractedChars?: number;
}

export interface PaperAnalyzerLike {
  analyze(content: string): Promise<PaperSection[]>;
}

export interface PaperRouteDeps {
  analyzer?: PaperAnalyzerLike;
  recordAnalysis?: (payload: RecordAnalysisPayload) => Promise<void>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  },
  fileFilter: (_req, file, callback) => {
    try {
      validateFileExtension(file.originalname);
      callback(null, true);
    } catch (error) {
      callback(error as Error);
    }
  }
});

const defaultRecordAnalysis = async (payload: RecordAnalysisPayload): Promise<void> => {
  try {
    await prisma.analysisRecord.create({
      data: {
        sourceType: payload.sourceType,
        fileName: payload.fileName,
        contentChars: payload.contentChars,
        extractedChars: payload.extractedChars,
        sectionsJson: JSON.stringify(payload.sections)
      }
    });
  } catch (error) {
    // Keep analysis available even if persistence fails.
    console.error("[RecordAnalysisError]", error);
  }
};

export const createPaperRouter = (deps: PaperRouteDeps = {}): express.Router => {
  const router = express.Router();
  const analyzer = deps.analyzer ?? new PaperAnalyzer();
  const recordAnalysis = deps.recordAnalysis ?? defaultRecordAnalysis;

  router.post("/analyze-paper", async (req, res, next) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      if (!content.trim()) {
        throw new HttpError(400, "论文内容不能为空，请输入有效文本。");
      }

      console.info(`[AnalyzePaper] start chars=${content.trim().length}`);

      const sections = await analyzer.analyze(content);

      console.info(`[AnalyzePaper] sections=${sections.length}`);

      await recordAnalysis({
        sourceType: "TEXT",
        contentChars: content.trim().length,
        sections
      });

      res.json({ sections });
    } catch (error) {
      next(error);
    }
  });

  router.post("/upload-paper", upload.single("file"), async (req, res, next) => {
    try {
      console.info(`[UploadPaper] start file=${req.file?.originalname ?? "(none)"} size=${req.file?.size ?? 0}`);

      const extractedText = await extractTextFromUploadedFile(req.file);
      console.info(`[UploadPaper] extracted chars=${extractedText.length}`);

      const sections = await analyzer.analyze(extractedText);
      console.info(`[UploadPaper] sections=${sections.length}`);

      await recordAnalysis({
        sourceType: "FILE",
        fileName: req.file?.originalname,
        contentChars: extractedText.length,
        extractedChars: extractedText.length,
        sections
      });

      res.json({
        sections,
        fileName: req.file?.originalname,
        extractedChars: extractedText.length
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

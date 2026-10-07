import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { PaperSection } from "../src/types/paper.js";

const fakeSections: PaperSection[] = Array.from({ length: 5 }).map((_, index) => ({
  title: `章节 ${index + 1}`,
  content: `这是第 ${index + 1} 章原文内容。`.repeat(10),
  explanation: `## 第 ${index + 1} 章讲解\n\n这是中文讲解。`
}));

const app = createApp({
  analyzer: {
    analyze: async () => fakeSections
  },
  recordAnalysis: async () => undefined
});

describe("POST /api/analyze-paper", () => {
  it("空内容返回 400 和中文错误", async () => {
    const response = await request(app).post("/api/analyze-paper").send({ content: "   " });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("不能为空");
  });

  it("正常内容返回 sections", async () => {
    const response = await request(app)
      .post("/api/analyze-paper")
      .send({ content: "这是一段足够长的论文内容。".repeat(40) });

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.sections)).toBe(true);
    expect(response.body.sections).toHaveLength(5);
  });
});

describe("POST /api/upload-paper", () => {
  it("未上传文件返回 400", async () => {
    const response = await request(app).post("/api/upload-paper");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("上传");
  });

  it("不支持的文件类型返回 400", async () => {
    const response = await request(app)
      .post("/api/upload-paper")
      .attach("file", Buffer.from("malicious content"), "bad.exe");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("仅支持");
  });

  it("损坏的 PDF 返回 400 中文错误", async () => {
    const response = await request(app)
      .post("/api/upload-paper")
      .attach("file", Buffer.from("not a real pdf"), "broken.pdf");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("PDF 解析失败");
  });
});

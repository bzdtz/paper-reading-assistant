import cors from "cors";
import express from "express";
import path from "path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createPaperRouter, type PaperRouteDeps } from "./routes/paperRoutes.js";
import { paperRouter as newPaperRouter } from "./routes/newPaperRoutes.js";
import { chatRouter } from "./routes/chatRoutes.js";

export const createApp = (deps: PaperRouteDeps = {}): express.Express => {
  const app = express();

  const mineruResultsPathCandidates = [
    path.resolve(process.cwd(), "uploads", "mineru-results-2"),
    path.resolve(process.cwd(), "..", "uploads", "mineru-results-2"),
    path.resolve(process.cwd(), "uploads", "mineru-results"),
    path.resolve(process.cwd(), "..", "uploads", "mineru-results")
  ];

  const mineruResultsDirs = mineruResultsPathCandidates.filter(
    (candidate, index, allCandidates) =>
      allCandidates.indexOf(candidate) === index && fs.existsSync(candidate)
  );

  app.use(cors());

  app.use((req, res, next) => {
    const reqId = randomUUID().slice(0, 8);
    const startAt = Date.now();

    console.info(`[REQ:${reqId}] -> ${req.method} ${req.originalUrl}`);

    res.on("finish", () => {
      const cost = Date.now() - startAt;
      console.info(`[REQ:${reqId}] <- ${res.statusCode} ${req.method} ${req.originalUrl} (${cost}ms)`);
    });

    next();
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    "/mineru-results",
    express.static(mineruResultsDirs[0] || mineruResultsPathCandidates[0])
  );

  for (const dir of mineruResultsDirs.slice(1)) {
    app.use("/mineru-results", express.static(dir));
  }

  app.get("/api/health", (_req, res) => {
    res.json({ message: "ok" });
  });

  // 旧的路由（保留兼容）
  app.use("/api", createPaperRouter(deps));

  // 新的路由（MinerU + 翻译/讲解）
  app.use("/api/v2", newPaperRouter);

  // 对话式路由
  app.use("/api/v2", chatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

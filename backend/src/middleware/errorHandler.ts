import type { NextFunction, Request, Response } from "express";
import multer from "multer";

import { HttpError, isHttpError } from "../utils/errors.js";

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new HttpError(404, "接口不存在，请检查请求地址。"));
};

export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ message: "文件大小不能超过 20MB。" });
      return;
    }

    res.status(400).json({ message: "文件上传失败，请检查文件格式后重试。" });
    return;
  }

  if (isHttpError(error)) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  if (error instanceof SyntaxError) {
    res.status(400).json({ message: "请求体格式错误，请使用正确的 JSON。" });
    return;
  }

  console.error("[ServerError]", error);
  res.status(500).json({ message: "服务异常，请稍后重试。" });
};

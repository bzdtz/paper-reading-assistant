/**
 * MinerU 客户端 - 使用本地文件上传解析接口
 * 通过 /api/v4/file-urls/batch 接口上传本地文件
 */
import axios from 'axios';
import { unzipSync } from 'fflate';
import fs from 'fs';
import path from 'path';
import { readRuntimeSettings } from '../config/runtimeSettings.js';

interface MinerUConfig {
  token: string;
  baseUrl: string;
  modelVersion: 'vlm' | 'pipeline' | 'MinerU-HTML';
  pollIntervalMs: number;
  pollTimeoutMs: number;
  requestTimeoutMs: number;
  requestMaxRetries: number;
  requestRetryDelayMs: number;
  uploadTimeoutMs: number;
  uploadMaxRetries: number;
  uploadRetryDelayMs: number;
}

interface UploadResult {
  batchId?: string;
  taskId?: string;
  uploadUrls: string[];
}

interface TaskStatus {
  taskId: string;
  state: string; // pending, running, done, failed, converting
  filename?: string | null;
  zipUrl?: string | null;
  progress?: {
    extractedPages: number;
    totalPages: number;
    startTime: string;
  } | null;
  result?: any;
  error?: string;
}

interface ParsedResult {
  taskId: string;
  state: string;
  filename: string | null;
  zipUrl: string | null;
  error: string | null;
  progress: TaskStatus['progress'];
  markdown: string | null;
  contentList: Record<string, unknown>[] | null;
  images: Array<{ name: string; data: Uint8Array; path: string }>;
  docx: Uint8Array | null;
  html: string | null;
  latex: string | null;
  markdown_info?: { markdown: string };
}

const DEFAULT_CONFIG: Partial<MinerUConfig> = {
  baseUrl: 'https://mineru.net/api/v4',
  modelVersion: 'vlm',
  pollIntervalMs: 5000,  // 每5秒轮询一次
  pollTimeoutMs: 600000,  // 10分钟超时
  requestTimeoutMs: 20000,
  requestMaxRetries: 3,
  requestRetryDelayMs: 1200,
  uploadTimeoutMs: 300000, // OSS 上传单次请求 5 分钟
  uploadMaxRetries: 3,
  uploadRetryDelayMs: 2500
};

const normalizeMineruBaseUrl = (value: string | undefined): string => {
  const rawValue = String(value ?? '').trim();
  const fallback = DEFAULT_CONFIG.baseUrl!;

  if (!rawValue) {
    return fallback;
  }

  try {
    const url = new URL(rawValue);
    url.pathname = url.pathname
      .replace(/\/(file-urls\/batch|extract\/task(?:\/[^/]+)?)$/, '')
      .replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return rawValue
      .replace(/\/(file-urls\/batch|extract\/task(?:\/[^/]+)?)$/, '')
      .replace(/\/+$/, '');
  }
};

export class MinerUClient {
  private readonly startupConfig?: Partial<MinerUConfig>;

  constructor(config?: Partial<MinerUConfig>) {
    this.startupConfig = config;
  }

  private getEffectiveConfig(): MinerUConfig {
    const runtime = readRuntimeSettings().mineru || {};

    const pollIntervalMs = Number(runtime.pollIntervalMs ?? this.startupConfig?.pollIntervalMs ?? process.env.MINERU_POLL_INTERVAL_MS ?? DEFAULT_CONFIG.pollIntervalMs);
    const pollTimeoutMs = Number(runtime.pollTimeoutMs ?? this.startupConfig?.pollTimeoutMs ?? process.env.MINERU_POLL_TIMEOUT_MS ?? DEFAULT_CONFIG.pollTimeoutMs);
    const modelVersionRaw = String(runtime.modelVersion || this.startupConfig?.modelVersion || process.env.MINERU_MODEL_VERSION || DEFAULT_CONFIG.modelVersion || 'vlm').trim();
    const modelVersion = modelVersionRaw === 'pipeline' || modelVersionRaw === 'MinerU-HTML' ? modelVersionRaw : 'vlm';
    const uploadTimeoutMs = Number(runtime.uploadTimeoutMs ?? this.startupConfig?.uploadTimeoutMs ?? process.env.MINERU_UPLOAD_TIMEOUT_MS ?? DEFAULT_CONFIG.uploadTimeoutMs);
    const uploadMaxRetries = Number(runtime.uploadMaxRetries ?? this.startupConfig?.uploadMaxRetries ?? process.env.MINERU_UPLOAD_MAX_RETRIES ?? DEFAULT_CONFIG.uploadMaxRetries);
    const uploadRetryDelayMs = Number(runtime.uploadRetryDelayMs ?? this.startupConfig?.uploadRetryDelayMs ?? process.env.MINERU_UPLOAD_RETRY_DELAY_MS ?? DEFAULT_CONFIG.uploadRetryDelayMs);
    const requestTimeoutMs = Number(runtime.requestTimeoutMs ?? this.startupConfig?.requestTimeoutMs ?? process.env.MINERU_REQUEST_TIMEOUT_MS ?? DEFAULT_CONFIG.requestTimeoutMs);
    const requestMaxRetries = Number(runtime.requestMaxRetries ?? this.startupConfig?.requestMaxRetries ?? process.env.MINERU_REQUEST_MAX_RETRIES ?? DEFAULT_CONFIG.requestMaxRetries);
    const requestRetryDelayMs = Number(runtime.requestRetryDelayMs ?? this.startupConfig?.requestRetryDelayMs ?? process.env.MINERU_REQUEST_RETRY_DELAY_MS ?? DEFAULT_CONFIG.requestRetryDelayMs);

    return {
      baseUrl: normalizeMineruBaseUrl(String(runtime.baseUrl || this.startupConfig?.baseUrl || process.env.MINERU_BASE_URL || DEFAULT_CONFIG.baseUrl)),
      token: String(runtime.token || this.startupConfig?.token || process.env.MINERU_TOKEN || '').trim(),
      modelVersion,
      pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? Math.floor(pollIntervalMs) : DEFAULT_CONFIG.pollIntervalMs!,
      pollTimeoutMs: Number.isFinite(pollTimeoutMs) && pollTimeoutMs > 0 ? Math.floor(pollTimeoutMs) : DEFAULT_CONFIG.pollTimeoutMs!,
      requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? Math.floor(requestTimeoutMs) : DEFAULT_CONFIG.requestTimeoutMs!,
      requestMaxRetries: Number.isFinite(requestMaxRetries) && requestMaxRetries >= 0 ? Math.floor(requestMaxRetries) : DEFAULT_CONFIG.requestMaxRetries!,
      requestRetryDelayMs: Number.isFinite(requestRetryDelayMs) && requestRetryDelayMs > 0 ? Math.floor(requestRetryDelayMs) : DEFAULT_CONFIG.requestRetryDelayMs!,
      uploadTimeoutMs: Number.isFinite(uploadTimeoutMs) && uploadTimeoutMs > 0 ? Math.floor(uploadTimeoutMs) : DEFAULT_CONFIG.uploadTimeoutMs!,
      uploadMaxRetries: Number.isFinite(uploadMaxRetries) && uploadMaxRetries >= 0 ? Math.floor(uploadMaxRetries) : DEFAULT_CONFIG.uploadMaxRetries!,
      uploadRetryDelayMs: Number.isFinite(uploadRetryDelayMs) && uploadRetryDelayMs > 0 ? Math.floor(uploadRetryDelayMs) : DEFAULT_CONFIG.uploadRetryDelayMs!
    };
  }

  private assertConfigured(config: MinerUConfig): void {
    if (!config.token) {
      throw new Error('MINERU_TOKEN is not configured. Please set it in settings or .env file.');
    }
  }

  getPublicConfig(): Omit<MinerUConfig, 'token'> & { tokenMasked: string } {
    const config = this.getEffectiveConfig();
    const token = String(config.token || '');
    const tokenMasked = token.length <= 8
      ? (token ? `${token.slice(0, 2)}***` : '')
      : `${token.slice(0, 4)}***${token.slice(-3)}`;

    return {
      baseUrl: config.baseUrl,
      modelVersion: config.modelVersion,
      pollIntervalMs: config.pollIntervalMs,
      pollTimeoutMs: config.pollTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
      requestMaxRetries: config.requestMaxRetries,
      requestRetryDelayMs: config.requestRetryDelayMs,
      uploadTimeoutMs: config.uploadTimeoutMs,
      uploadMaxRetries: config.uploadMaxRetries,
      uploadRetryDelayMs: config.uploadRetryDelayMs,
      tokenMasked
    };
  }

  private isRetryableRequestError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const causeCode = String((error as any)?.cause?.code || '');
    const code = String(error.code || causeCode || '');
    const message = String(error.message || '').toLowerCase();
    const status = Number(error.response?.status || 0);

    if ([408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    return (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'ENOTFOUND' ||
      message.includes('timeout') ||
      message.includes('network error') ||
      message.includes('socket hang up')
    );
  }

  private isRetryableUploadError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    const causeCode = String((error as any)?.cause?.code || '');

    return (
      message.includes('connect timeout') ||
      message.includes('fetch failed') ||
      message.includes('socket hang up') ||
      causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
      causeCode === 'ECONNRESET' ||
      causeCode === 'ETIMEDOUT' ||
      causeCode === 'ECONNREFUSED' ||
      causeCode === 'EAI_AGAIN'
    );
  }

  private async sleepWithJitter(baseDelayMs: number, attempt: number): Promise<void> {
    const expFactor = Math.pow(1.6, Math.max(0, attempt - 1));
    const jitter = 0.85 + Math.random() * 0.3;
    const delay = Math.min(20000, Math.round(baseDelayMs * expFactor * jitter));
    await this.sleep(delay);
  }

  async testConnection(): Promise<{ available: boolean; probeCode: number; probeMessage: string }> {
    const config = this.getEffectiveConfig();
    this.assertConfigured(config);

    try {
      const response = await axios.get(`${config.baseUrl}/extract-results/batch/__probe__`, {
        timeout: 20000,
        headers: {
          Authorization: `Bearer ${config.token}`
        }
      });

      const code = Number(response.data?.code ?? 0);
      const msg = String(response.data?.msg || response.data?.message || 'ok');

      // -60012 表示 task 不存在，通常说明 endpoint 与 token 已可达
      const available = code === 0 || code === -60012;
      return {
        available,
        probeCode: code,
        probeMessage: msg
      };
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const code = Number((error.response?.data?.code ?? status) || -1);
        const msg = String(error.response?.data?.msg || error.response?.data?.message || error.message || 'unknown error');
        return {
          available: false,
          probeCode: code,
          probeMessage: msg
        };
      }

      return {
        available: false,
        probeCode: -1,
        probeMessage: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 步骤1：申请文件上传链接
   * @param fileName 文件名
   * @param dataId 业务标识（可选）
   * @returns batchId 和上传链接
   */
  async requestUploadUrls(fileName: string, dataId?: string): Promise<UploadResult> {
    const config = this.getEffectiveConfig();
    this.assertConfigured(config);

    console.log(`[MinerU] 申请上传链接: ${fileName}`);

    const attempts = Math.max(1, config.requestMaxRetries + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await axios.post(
          `${config.baseUrl}/file-urls/batch`,
          {
            files: [
              {
                name: fileName,
                data_id: dataId || fileName
              }
            ],
            model_version: config.modelVersion
          },
          {
            timeout: config.requestTimeoutMs,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.token}`
            }
          }
        );

        if (response.data?.code !== 0) {
          throw new Error(`申请上传链接失败: ${response.data?.msg || '未知错误'}`);
        }

        const batchId = response.data.data?.batch_id;
        const taskId = response.data.data?.task_id || response.data.data?.taskId;
        const uploadUrls = response.data.data?.file_urls || [];

        if (!batchId && !taskId && uploadUrls.length === 0) {
          throw new Error('返回数据格式异常');
        }

        if (attempt > 1) {
          console.log(`[MinerU] 申请上传链接在第 ${attempt} 次尝试后成功`);
        }
        console.log(`[MinerU] 获取到上传链接，batchId: ${batchId || 'n/a'}, taskId: ${taskId || 'n/a'}`);
        return { batchId, taskId, uploadUrls };
      } catch (error: any) {
        const retryable = this.isRetryableRequestError(error);
        const canRetry = retryable && attempt < attempts;
        const detail = error instanceof Error ? error.message : String(error);

        console.error(`[MinerU] 申请上传链接失败（第 ${attempt}/${attempts} 次）: ${detail}`);
        if (axios.isAxiosError(error) && error.response) {
          console.error('[MinerU] 响应数据:', JSON.stringify(error.response.data, null, 2));
        }

        if (!canRetry) {
          throw new Error(`申请上传链接失败: ${detail}`);
        }

        await this.sleepWithJitter(config.requestRetryDelayMs, attempt);
      }
    }

    throw new Error('申请上传链接失败: 超过最大重试次数');
  }

  /**
   * 步骤2：上传文件到 OSS（PUT 请求）
   * 使用 fetch API，完全控制请求头
   * @param uploadUrl OSS 上传链接
   * @param filePath 本地文件路径
   */
  async uploadToOSS(uploadUrl: string, filePath: string): Promise<void> {
    const config = this.getEffectiveConfig();

    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const fileSize = fs.statSync(filePath).size;
    console.log(`[MinerU] 开始上传文件到 OSS: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // 为了避免多次磁盘读取，重试复用同一份内存缓冲。
    const fileBuffer = fs.readFileSync(filePath);
    const attempts = Math.max(1, config.uploadMaxRetries + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          body: fileBuffer,
          // 注意：不设置任何自定义头，让 fetch 使用默认行为
          // OSS 签名计算时使用的是空 Content-Type
          signal: AbortSignal.timeout(config.uploadTimeoutMs)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`上传文件到 OSS 失败: HTTP ${response.status}; body=${errorText.slice(0, 200)}`);
        }

        if (attempt > 1) {
          console.log(`[MinerU] OSS 上传在第 ${attempt} 次尝试后成功`);
        } else {
          console.log('[MinerU] 文件上传到 OSS 成功');
        }
        return;
      } catch (error: any) {
        const retryable = this.isRetryableUploadError(error);
        const canRetry = retryable && attempt < attempts;
        const detail = error instanceof Error ? error.message : String(error);

        console.error(`[MinerU] 上传文件到 OSS 失败（第 ${attempt}/${attempts} 次）: ${detail}`);

        if (!canRetry) {
          throw error;
        }

        await this.sleepWithJitter(config.uploadRetryDelayMs, attempt);
      }
    }
  }

  /**
   * 查询批次状态（使用 batch_id 查询）
   */
  async getBatchResults(batchId: string): Promise<TaskStatus[]> {
    const config = this.getEffectiveConfig();
    this.assertConfigured(config);

    try {
      const response = await axios.get(
        `${config.baseUrl}/extract-results/batch/${batchId}`,
        {
          headers: {
            'Authorization': `Bearer ${config.token}`
          }
        }
      );

      console.log('[MinerU] 查询批次结果返回:', JSON.stringify(response.data, null, 2));

      // MinerU 返回格式可能为：
      // { code: 0, msg: "ok", data: { extract_result: [...] } }
      // 或 { data: { extract_result: [...] } }
      const responseData = response.data;
      const responseCode = Number(responseData?.code ?? 0);

      if (responseCode !== 0) {
        const message = String(responseData?.msg || responseData?.message || `code ${responseCode}`);
        throw new Error(`查询批次结果失败: ${message}`);
      }

      const data = responseData?.data || responseData;
      const extractResults = data?.extract_result || data?.extractResult || data?.results || [];

      if (!Array.isArray(extractResults)) {
        console.error('[MinerU] 返回数据格式异常:', JSON.stringify(responseData));
        throw new Error('返回数据格式异常');
      }

      return extractResults.map((item: any) => this.parseBatchTaskResult(item));
    } catch (error: any) {
      console.error(`[MinerU] 查询批次结果失败:`, error.message);
      if (error.response) {
        console.error('[MinerU] 响应数据:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * 轮询等待任务完成
   */
  async pollUntilComplete(batchId: string): Promise<any> {
    const config = this.getEffectiveConfig();
    this.assertConfigured(config);

    const startTime = Date.now();
    const pollInterval = config.pollIntervalMs;
    const timeout = config.pollTimeoutMs;

    console.log(`[MinerU] 开始轮询批次结果: ${batchId}`);

    while (Date.now() - startTime < timeout) {
      const results = await this.getBatchResults(batchId);
      const status = results[0];

      if (!status) {
        await this.sleep(pollInterval);
        continue;
      }

      console.log(`[MinerU] 任务状态: ${status.state}`);

      if (status.state === 'done') {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[MinerU] 任务完成，耗时: ${elapsed}秒`);
        if (status.zipUrl) {
          return this.downloadAndParseZip(status.zipUrl, status.taskId, status.filename);
        }
        return status;
      }

      if (status.state === 'failed') {
        throw new Error(`任务失败: ${status.error || '未知错误'}`);
      }

      await this.sleep(pollInterval);
    }

    throw new Error(`任务超时（${timeout}ms）`);
  }

  /**
   * 完整流程：上传本地文件并等待解析完成
   * 1. 申请上传链接
   * 2. 上传文件到 OSS
   * 3. 轮询等待解析完成
   * 
   * @param filePath 本地文件路径
   * @returns 解析结果
   */
  async uploadAndExtract(filePath: string): Promise<any> {
    try {
      const fileName = path.basename(filePath);
      console.log(`[MinerU] 开始处理文件: ${fileName}`);

      // 步骤1：申请上传链接
      const { batchId, taskId, uploadUrls } = await this.requestUploadUrls(fileName);

      const statusId = taskId || batchId;

      if (!statusId) {
        throw new Error('MinerU 未返回可用于查询状态的 task_id/batch_id');
      }

      // 步骤2：上传文件到 OSS
      await this.uploadToOSS(uploadUrls[0], filePath);

      // 步骤3：轮询等待解析完成
      const result = await this.pollUntilComplete(statusId);

      console.log(`[MinerU] 文件解析完成`);
      return result;
    } catch (error: any) {
      console.error('[MinerU] 上传和解析失败:', error.message);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseBatchTaskResult(data: any): TaskStatus {
    const state = data?.state || data?.status || 'unknown';
    const progressData = data?.extract_progress;

    return {
      taskId: data?.task_id || data?.taskId || '',
      state,
      filename: data?.file_name || data?.filename || null,
      zipUrl: data?.full_zip_url || data?.zip_url || null,
      error: data?.err_msg || data?.error || null,
      progress: progressData ? {
        extractedPages: Number(progressData.extracted_pages ?? 0),
        totalPages: Number(progressData.total_pages ?? 0),
        startTime: String(progressData.start_time ?? '')
      } : null
    };
  }

  private async downloadAndParseZip(zipUrl: string, taskId: string, filename?: string | null): Promise<ParsedResult> {
    const response = await fetch(zipUrl);
    if (!response.ok) {
      throw new Error(`下载 MinerU 结果包失败: HTTP ${response.status}`);
    }

    const zipBytes = new Uint8Array(await response.arrayBuffer());
    return this.parseZipResult(zipBytes, taskId, filename || null, zipUrl);
  }

  private parseZipResult(
    zipBytes: Uint8Array,
    taskId: string,
    filename: string | null,
    zipUrl: string | null
  ): ParsedResult {
    const entries = unzipSync(zipBytes);
    const images: Array<{ name: string; data: Uint8Array; path: string }> = [];
    let markdown: string | null = null;
    let contentList: Record<string, unknown>[] | null = null;
    let docx: Uint8Array | null = null;
    let html: string | null = null;
    let latex: string | null = null;

    for (const [relPath, data] of Object.entries(entries)) {
      if (relPath.endsWith('/')) {
        continue;
      }

      const name = path.basename(relPath);
      const ext = path.extname(name).toLowerCase();
      const text = () => new TextDecoder().decode(data);

      if (ext === '.md') {
        markdown = text();
      } else if (name.endsWith('_content_list.json') || name === 'content_list.json') {
        try {
          const parsed = JSON.parse(text());
          if (Array.isArray(parsed)) {
            contentList = parsed as Record<string, unknown>[];
          }
        } catch {
          // ignore invalid JSON
        }
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) {
        images.push({ name, data: new Uint8Array(data), path: relPath });
      } else if (ext === '.docx') {
        docx = new Uint8Array(data);
      } else if (ext === '.html' || ext === '.htm') {
        html = text();
      } else if (ext === '.tex') {
        latex = text();
      }
    }

    return {
      taskId,
      state: 'done',
      filename,
      zipUrl,
      error: null,
      progress: null,
      markdown,
      markdown_info: markdown ? { markdown } : undefined,
      contentList,
      images,
      docx,
      html,
      latex
    };
  }
}

// 导出单例
export const mineruClient = new MinerUClient();

# 论文辅助器（Vue CLI + JavaScript + Express TypeScript + Prisma SQLite）

一个可直接运行的全栈项目：
- 前端：Vue CLI + Vue 3 + JavaScript + Pinia + Vue Router
- 后端：Node.js + Express + TypeScript
- 数据库：Prisma + SQLite
- AI：z-ai-web-dev-sdk（通过 `.z-ai-config` 配置）

## 1. 项目结构

```text
paper-教教-vs
├─ backend
│  ├─ prisma
│  │  └─ schema.prisma
│  ├─ src
│  │  ├─ config
│  │  │  ├─ env.ts
│  │  │  └─ zaiConfig.ts
│  │  ├─ lib
│  │  │  └─ prisma.ts
│  │  ├─ middleware
│  │  │  └─ errorHandler.ts
│  │  ├─ routes
│  │  │  └─ paperRoutes.ts
│  │  ├─ services
│  │  │  ├─ aiClient.ts
│  │  │  ├─ paperAnalyzer.ts
│  │  │  └─ textExtractor.ts
│  │  ├─ types
│  │  │  ├─ paper.ts
│  │  │  ├─ pdfjs-dist.d.ts
│  │  │  └─ z-ai-web-dev-sdk.d.ts
│  │  ├─ utils
│  │  │  ├─ errors.ts
│  │  │  └─ jsonParser.ts
│  │  ├─ app.ts
│  │  └─ server.ts
│  ├─ tests
│  │  └─ paperRoutes.test.ts
│  ├─ .env.example
│  ├─ .z-ai-config.example
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ vitest.config.ts
├─ frontend
│  ├─ public
│  │  └─ index.html
│  ├─ src
│  │  ├─ components
│  │  │  ├─ AnalyzeProgress.vue
│  │  │  ├─ PasteTab.vue
│  │  │  ├─ SectionList.vue
│  │  │  └─ UploadTab.vue
│  │  ├─ pages
│  │  │  ├─ InputPage.vue
│  │  │  └─ ResultPage.vue
│  │  ├─ router
│  │  │  └─ index.js
│  │  ├─ services
│  │  │  └─ paperApi.js
│  │  ├─ stores
│  │  │  └─ paperStore.js
│  │  ├─ styles
│  │  │  └─ global.css
│  │  ├─ App.vue
│  │  └─ main.js
│  ├─ .env.example
│  ├─ babel.config.js
│  ├─ jsconfig.json
│  ├─ package.json
│  └─ vue.config.js
├─ .gitignore
└─ README.md
```

## 2. 功能说明

### 输入页
- 双 Tab 输入模式：上传文档 / 粘贴文本。
- 上传支持拖拽、点击选择、显示文件名与大小、删除重选。
- 上传时显示进度条，文件上传完成后再进入分析阶段动画。
- 支持格式：PDF、DOCX、DOC、TXT、MD；最大 20MB。
- 粘贴模式显示字符计数，支持 Ctrl/Cmd + Enter 提交。
- 分析中显示 4 步动画：读取文档、分析结构、生成讲解、整理结果。

### 结果页
- 桌面端左右分栏对照阅读，分栏支持拖拽调宽。
- 左侧章节列表可点击跳转并高亮。
- 右侧渲染中文 Markdown 讲解。
- 右侧滚动时自动同步左侧高亮。
- 移动端自动切换为 Tab（原文 / 讲解）。
- 顶部支持“返回输入”和“重新分析”。

### 后端接口
- `POST /api/analyze-paper`
  - 输入：`{ content: string }`
  - 空内容校验，返回中文错误信息。
  - 调用 AI 分析，解析严格 JSON，兼容 markdown 代码块包裹。
  - 输出：`{ sections: [{ title, content, explanation }] }`

- `POST /api/upload-paper`
  - 输入：`multipart/form-data`，字段名 `file`
  - 校验类型和大小。
  - PDF 用 `pdfjs-dist` 提取文本。
  - DOCX/DOC 用 `mammoth` 提取文本。
  - TXT/MD 直接读取。
  - 文本过短报错。
  - 提取文本后复用分析逻辑，返回：
    - `sections`
    - `fileName`
    - `extractedChars`

## 3. 环境配置

### 3.1 后端 .env（SQLite）
复制并编辑：

- `backend/.env.example` -> `backend/.env`

示例：

```env
PORT=3000
DATABASE_URL="file:./dev.db"
```

### 3.2 AI SDK 配置 .z-ai-config
复制并编辑：

- `backend/.z-ai-config.example` -> `backend/.z-ai-config`

示例：

```json
{
  "baseUrl": "https://your-z-ai-endpoint.example.com",
  "apiKey": "your_api_key",
  "chatId": "optional_chat_id",
  "userId": "optional_user_id",
  "token": "optional_token",
  "model": "glm-4.5-air",
  "requestTimeoutMs": 90000,
  "maxRetries": 1,
  "retryDelayMs": 1200
}
```

注意：`baseUrl` 必须是可访问的 http/https 地址，具体路径以你的 AI 服务商文档为准。
可选调优：
- `requestTimeoutMs`：单次 AI 请求超时（毫秒），默认 `90000`。
- `maxRetries`：失败重试次数（不含首次），默认 `1`。
- `retryDelayMs`：重试间隔基准（毫秒），默认 `1200`。

## 4. 启动命令（Windows 兼容）

以下命令均可在 PowerShell、CMD 或 VS Code 终端执行。

### 4.1 安装依赖

```bash
cd backend
npm install

cd ..\frontend
npm install
```

### 4.2 Prisma 初始化

```bash
cd ..\backend
npm run prisma:generate
npm run prisma:migrate
```

### 4.3 启动后端

```bash
cd backend
npm run dev
```

后端地址：`http://localhost:3000`

### 4.4 启动前端

新开一个终端：

```bash
cd frontend
npm run serve
```

前端地址：`http://localhost:8080`

## 5. 验证流程

1. 打开 `http://localhost:8080`
2. 在输入页选择“上传文档”或“粘贴文本”
3. 提交后观察 4 步分析动画
4. 结果页查看：
   - 左侧章节导航与原文
   - 右侧 Markdown 中文讲解
   - 滚动右侧看左侧高亮同步
5. 点击“重新分析”验证重新执行
6. 点击“返回输入”返回输入页

## 6. 测试示例（后端）

```bash
cd backend
npm run test
```

包含示例：
- 空内容校验
- 正常分析返回结构
- 上传接口无文件校验
- 非法文件类型校验

## 7. 常见错误排查

- 提示找不到 `.z-ai-config`：
  - 确认文件在 `backend` 目录下，且 JSON 格式合法。

- 提示 `baseUrl` 不合法：
  - 修改 `.z-ai-config` 的 `baseUrl` 为可访问的 http/https 地址。

- 后端日志出现 `UND_ERR_HEADERS_TIMEOUT` 或 `fetch failed`：
  - 检查网络到 AI 网关的连通性；
  - 增大 `.z-ai-config` 中 `requestTimeoutMs`（例如 `120000`）；
  - 视情况把 `maxRetries` 调整为 `2`。

- 上传 DOC 失败：
  - `mammoth` 对部分老式 DOC 兼容性有限，建议优先使用 DOCX。

- 提示 SQLite 相关错误：
  - 先执行 `npm run prisma:generate` 和 `npm run prisma:migrate`。

- 前端请求失败：
  - 确认后端是否运行在 `3000` 端口，或更新 `frontend/.env` 中 `VUE_APP_API_BASE_URL`。

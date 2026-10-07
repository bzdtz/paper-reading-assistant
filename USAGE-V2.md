# 论文辅助器 V2 使用说明

## 🎯 新功能概览

V2 版本实现了全新的论文查看交互方式，采用**逐段翻译/讲解**的模式，让用户可以更精细地控制学习过程。

### 核心特性

1. **逐段操作**：每个段落都有独立的「翻译」和「讲解」按钮
2. **双模式切换**：右侧可查看翻译或讲解内容
3. **折叠章节**：按章节组织内容，支持展开/折叠
4. **追问功能**：每个段落下方支持连续追问
5. **批量操作**：顶部提供「翻译全部」和「讲解全部」按钮

---

## 🚀 快速开始

### 1. 配置 MinerU API Token

在 `backend/.env` 文件中配置：

```env
MINERU_TOKEN=你的mineru_api_token
MINERU_BASE_URL=https://mineru.net/api/v4
```

> 注意：`MINERU_BASE_URL` 只写到 `/api/v4` 这一层，不要带 `/file-urls/batch` 或 `/extract/task/...`，否则后端拼接接口时会变成错误地址。

官网 API 的标准流程是：先申请上传链接，再上传文件，然后通过 batch ID 查询 `/extract-results/batch/:batchId`，不是单任务 `/extract/task/:taskId`。

### 2. 启动后端

```bash
cd backend
npm run dev
```

后端运行在 `http://localhost:3000`

### 3. 启动前端

```bash
cd frontend
npm run serve
```

前端运行在 `http://localhost:8080`

### 4. 访问 V2 版本

- **上传页面**：`http://localhost:8080/upload-v2`
- **结果页面**：`http://localhost:8080/result-v2`（可带 paper ID 参数）

---

## 📐 界面布局

### 上传页面 (UploadV2Page)

```
┌──────────────────────────────────────┐
│  论文辅助器 V2                        │
│  上传论文进行智能解析                  │
├──────────────────────────────────────┤
│                                      │
│  ┌────────────────────────────┐     │
│  │  📄 拖拽论文到这里          │     │
│  │  或点击选择文件             │     │
│  │  支持 PDF、DOCX...         │     │
│  └────────────────────────────┘     │
│                                      │
│  [重新选择]  [开始解析]              │
└──────────────────────────────────────┘
```

### 结果页面 (ResultPageV2)

```
┌──────────────────────────────────────────────────────────────┐
│  ← 返回输入  |  论文标题  |  🔤翻译全部  📖讲解全部           │
├──────────────────────────┬───────────────────────────────────┤
│  📄 论文原文              │  [翻译] [讲解]  ← 模式切换         │
│                          │                                   │
│  1. Introduction         │  ▼ Section 1: Introduction        │
│  段落1... [翻译][讲解]   │                                   │
│  段落2... [翻译][讲解]   │  📝 段落 1                        │
│                          │  （翻译/讲解内容）                 │
│  2. Background           │  💬 追问 (2)                      │
│  段落1... [翻译][讲解]   │    ┌─────────────────────┐        │
│                          │    │ 问：xxx              │        │
│  ...                     │    │ 答：xxx              │        │
│                          │    └─────────────────────┘        │
│                          │  [输入框] [发送]                   │
│                          │                                   │
│                          │  ▶ Section 2: Background          │
└──────────────────────────┴───────────────────────────────────┘
```

---

## 🔧 API 端点

所有 V2 API 都在 `/api/v2` 路径下：

### 上传论文

```http
POST /api/v2/papers/upload
Content-Type: multipart/form-data

Response:
{
  "success": true,
  "paperId": "uuid",
  "message": "文件已上传，正在解析中..."
}
```

### 获取论文详情

```http
GET /api/v2/papers/:id

Response:
{
  "success": true,
  "paper": {
    "id": "...",
    "fileName": "...",
    "sections": [
      {
        "id": "...",
        "title": "1. Introduction",
        "order": 1,
        "paragraphs": [
          {
            "id": "...",
            "originalText": "...",
            "order": 1,
            "translations": [],
            "explanations": []
          }
        ]
      }
    ]
  }
}
```

### 翻译段落

```http
POST /api/v2/paragraphs/:id/translate

Response:
{
  "success": true,
  "translation": {
    "id": "...",
    "content": "翻译内容..."
  }
}
```

### 讲解段落

```http
POST /api/v2/paragraphs/:id/explain

Response:
{
  "success": true,
  "explanation": {
    "id": "...",
    "content": "讲解内容（Markdown）..."
  }
}
```

### 追问

```http
POST /api/v2/follow-up

Request:
{
  "parentId": "翻译或讲解的ID",
  "parentType": "TRANSLATION | EXPLANATION",
  "question": "你的问题..."
}

Response:
{
  "success": true,
  "followUp": {
    "id": "...",
    "question": "...",
    "answer": "..."
  }
}
```

---

## 🎨 前端组件结构

```
frontend/src/
├─ pages/
│  ├─ UploadV2Page.vue        # V2 上传页面
│  └─ ResultPageV2.vue        # V2 结果查看页面
├─ components/                 # （复用旧组件）
├─ stores/
│  ├─ paperStore.js           # 旧版 Store
│  └─ paperDetailStore.js     # V2 新版 Store
├─ services/
│  ├─ paperApi.js             # 旧版 API
│  ├─ paperApiV2.js           # V2 新版 API
│  └─ mockData.js             # 模拟数据
└─ router/
   └─ index.js                # 路由配置
```

---

## 🧪 使用模拟数据

在配置好 MinerU Token 之前，前端会自动使用模拟数据进行演示：

- 访问 `http://localhost:8080/result-v2`（不带 paper ID）会使用模拟数据
- 访问 `http://localhost:8080/result-v2/some-id` 会尝试加载真实数据，失败后回退到模拟数据

这样你可以在没有后端的情况下完整体验前端交互。

---

## 📝 开发计划

### 待完成

- [ ] 实现 MinerU 文件上传（需要先上传到 OSS 或提供可访问 URL）
- [ ] 批量翻译/讲解的进度条和取消功能
- [ ] SSE 流式返回（用于实时显示生成进度）
- [ ] 追问历史记录持久化
- [ ] 移动端响应式优化
- [ ] 导出功能（导出为 Markdown/PDF）

### 可选增强

- [ ] 段落高亮同步（左侧滚动时右侧自动跟进）
- [ ] 笔记功能（用户可以做笔记）
- [ ] 分享功能（生成分享链接）
- [ ] 多语言支持（英文讲解等）

---

## 🐛 常见问题

### Q: 为什么上传文件后跳转到结果页是空的？

A: 因为 MinerU 的文件上传功能还需要实现（需要先上传到可访问的 URL）。目前你可以：
1. 直接访问 `/result-v2` 查看模拟数据演示
2. 配置 MinerU Token 后，手动修改 `backend/src/routes/newPaperRoutes.ts` 中的上传逻辑

### Q: 如何测试完整的翻译/讲解流程？

A: 访问 `http://localhost:8080/result-v2`，页面会自动加载模拟数据。点击任意段落的「翻译」或「讲解」按钮即可看到效果。

### Q: AI 讲解的 Prompt 在哪里配置？

A: 在 `backend/src/routes/newPaperRoutes.ts` 的 `/paragraphs/:id/explain` 路由中，第 168-197 行配置了你的完整 Prompt。

---

## 📞 技术支持

如有问题，请查看：
- 后端日志：终端输出
- 前端控制台：浏览器开发者工具 Console
- API 请求：Network 标签页查看请求详情

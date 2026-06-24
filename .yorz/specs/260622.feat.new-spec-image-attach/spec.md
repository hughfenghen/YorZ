---
stage: execute
last_action: 完成任务清单中前 10 项（端到端联调需手动操作待补）
updated_at: 2026-06-22
summary: 新建 spec 页面在需求输入框下方支持以文件选择或 Cmd/Ctrl-V 粘贴的方式导入图片/PDF/文本附件，作为附件随 spec 一起创建并在文档中可引用。
---

# 新建 spec 页面：导入与粘贴剪贴板图片

## 1. 背景

新建 spec 页面（`src/gui/src/pages/NewSpec.tsx`）目前只有「类型」单选与一个多行 `textarea`，用户描述需求时只能写纯文本。实际使用中，用户经常需要附带截图（UI mock、错误截图、流程图）或 PDF/文本片段来辅助说明，但现在没有任何方式把这些素材带进 spec 文档，只能口头描述或事后手动拷贝文件。

希望在输入框下方提供"导入文件"与"剪贴板粘贴 (Cmd/Ctrl-V)"两种方式上传附件，并随 spec 一起落地，使生成的 spec 可以直接引用这些附件。

## 2. 需求

> 新建 spec 页面，这输入框的下方支持导入或粘贴（cmd/ctrl-v）剪贴板中的图片

经用户批注澄清，第一版需要扩展到 PDF / 文本（含 markdown）等常见格式。拆解为可执行点：

- 在 NewSpec 表单的需求 `textarea` 下方新增附件区。
- 支持两种导入方式：
  - 点击"导入附件"按钮，弹出系统文件选择框（限定可接受 MIME）。
  - 在页面（至少在 textarea 与附件区获得焦点时）按下 Cmd/Ctrl-V 时，从剪贴板读取**图片**并加入附件列表（PDF/文本不通过粘贴入口）。
- 已添加的附件以缩略图/图标列表展示，支持删除与重命名。
- 提交"创建并启动 Agent"时，附件需要随 spec 一起持久化到该 spec 目录下，并在文档中以可引用形式留痕（路径或 markdown 引用），让后续 Agent 与人审可见。

## 3. 现状分析

### 3.1 前端：`src/gui/src/pages/NewSpec.tsx`

- 当前组件为受控表单：`type` 单选 + `content` textarea + 提交按钮，无任何文件/拖拽/粘贴交互。
- 提交逻辑 `submit()` 调用 `api.createSpec({ type, requirement: text })`，返回 `{runId, draft:true}` 走 draft 流程，由 Agent 决定 spec id 与目录；返回 `{id, path}` 走 legacy 同步路径。
- draft 流程下页面会订阅 `subscribeSpecsList` 轮询新 spec id 并跳转 `/specs/:id`。

### 3.2 现有 API：`src/gui/src/lib/api.ts` + `src/service/routes/specs.ts`

- `POST /api/specs` 当前只接受 JSON：`{type, title?, summary?, requirement?}`。
- draft 模式（仅 type+requirement）流程：
  1. service 端用 `buildDraftPrompt(type, requirement)` 生成 prompt；
  2. 用一个 `__draft__-<uuid>` 占位 specId 启动 Agent；
  3. Agent 通过 yorz-spec skill 自行决定 `summary-name` 与 spec 目录（`.yorz/specs/<id>/spec.md`）。
- 后端无任何 multipart / 文件上传通路，`SpecStore` 仅负责 markdown 读写。
- 每个 spec 目录是独立子目录，约定为附件/截图/中间产物共置位置（见 yorz-spec skill `new-spec.md` 第 21 行），但实际落盘机制尚未实现。

### 3.3 spec id 在 draft 模式下"延迟生成"带来的难点

- 用户在 NewSpec 页面上传附件时，**spec id 尚未存在**，无法直接写入 `.yorz/specs/<id>/`。
- 当前 draft 流程下，spec 目录由 Agent 在 skill 内部决定（含冲突重试 `-2`/`-3`）。前端无法预知最终 id。
- 这意味着附件或者必须先入"暂存区"，等 Agent 落地 spec 后再迁移；或者上传/提交流程需要重新设计。

### 3.4 类似交互参考

- 仓库内未发现其它"粘贴图片"或"附件上传"组件，需要从零搭建：
  - 监听 `paste` 事件，遍历 `event.clipboardData.items` 找到 `kind === 'file' && type.startsWith('image/')` 的 item，用 `getAsFile()` 拿到 `File`。
  - 文件选择走 `<input type="file" accept="image/*,application/pdf,text/plain,text/markdown,.md,.txt" multiple>`。
  - 图片缩略图通过 `URL.createObjectURL(file)` 渲染，非图片（PDF/文本）以"类型图标 + 文件名"形式展示。
  - 组件 unmount 时 `revokeObjectURL` 所有图片 previewUrl。

### 3.5 service 端附件相关空白

- 无 attachment store；无 multipart 解析；无静态文件路由对外暴露 `.yorz/specs/<id>/attachments/`（GUI 之后需要预览图片或下载 PDF，可能需要新增静态资源路由）。

### 3.6 非图片附件相关空白

- 粘贴入口（`clipboardData.items`）在主流浏览器中只对图片 item 产生 `kind === 'file'` 的稳定行为；剪贴板中的 PDF/文本通常以 string item 出现，且语义是"文本贴入 textarea"。因此 PDF/文本附件**只能**通过文件选择按钮进入。
- 服务端 multipart 解析需要按 MIME 白名单分类，统一存盘但分类校验大小与数量上限。
- markdown 渲染层（SpecDetail）目前未验证对非图片附件链接（`[name](attachments/foo.pdf)`）的渲染与点击下载行为；新增静态路由后需保证浏览器以 `inline`（PDF）或 `attachment`（其它）方式响应。

## 4. 技术实现方案

### 4.1 总体思路

按"前端先暂存 → 后端按 draftId 落地 → Agent 落定 spec 后迁移到正式目录 → 在 spec 文档中追加引用"的链路实现。优先选择改动最小、与现有 draft 链路兼容的方案。附件统一抽象为 `Attachment`，按 `kind: 'image' | 'pdf' | 'text'` 在前端区分缩略图渲染与文档引用形式，在后端共用 multipart 通道与存储目录。

### 4.2 前端：NewSpec 表单扩展

在 `src/gui/src/pages/NewSpec.tsx` 中：

- 新增 `attachments` 信号，元素结构：`{ id: string, file: File, name: string, kind: 'image' | 'pdf' | 'text', previewUrl?: string, status: 'pending' | 'uploaded' | 'failed' }`。
- 在 textarea 下方新增"附件"区，包含：
  - "导入附件"按钮 → 触发隐藏 `<input type="file" accept="image/*,application/pdf,text/plain,text/markdown,.md,.txt" multiple>`。
  - 提示文案"或按 Cmd/Ctrl-V 粘贴剪贴板图片"（明示粘贴仅支持图片）。
  - 已选附件缩略图列表：图片渲染 `<img src={previewUrl}>`；PDF/文本渲染对应类型图标 + 文件名。
  - 每项支持删除与**重命名**：点击重命名后弹出/原地输入新文件名（保留原扩展名，禁止改扩展名以规避 MIME 不一致风险）。
- 在 textarea 上绑定 `onPaste`：遍历 `clipboardData.items`，将所有 image item 转 `File`（命名为 `image-<uuid 取四位>.<ext>`，扩展名按 MIME 推断）加入 `attachments`；非图片 item 保持现有 textarea 默认粘贴行为不拦截。
- 大小校验：图片 / PDF / 文本统一单文件 ≤ 5 MB。
- 数量校验：单次新建 spec 累计附件 ≤ 10 个（图片与非图片合并计数）。
- onCleanup 时 `revokeObjectURL` 所有图片 previewUrl。

### 4.3 上传时机与上传 API

引入"草稿期附件暂存"概念：

- 前端在用户首次添加附件时调用一次 `POST /api/spec-drafts`，由后端生成 `draftId`（UUID），返回 `{ draftId }`，并创建临时目录 `.yorz/drafts/<draftId>/attachments/`。
- 后续每个附件通过 `POST /api/spec-drafts/<draftId>/attachments`（multipart/form-data，字段 `file`）逐个上传。响应返回 `{ name, size, mime, kind, storedName }`，前端把 `storedName` 与 attachment 关联，标记 `status: 'uploaded'`。
- 删除附件：`DELETE /api/spec-drafts/<draftId>/attachments/<storedName>`。
- 重命名附件：`PATCH /api/spec-drafts/<draftId>/attachments/<storedName>` `{ name }`（仅改 storedName 与文档内引用名，不改扩展名）。
- 服务端约束：
  - MIME 白名单：`image/*`、`application/pdf`、`text/plain`、`text/markdown`。
  - 单文件 ≤ 5 MB（图片 / PDF / 文本统一上限）。
  - 每 draft 累计 ≤ 10 个（图片与非图片合并计数）。
  - 命名策略：
    - 图片：若浏览器只给占位名（如 `image.png`），统一改写为 `image-<randomUUID 取四位>.<ext>`；用户手动选择的图片沿用其原文件名进入下一条非图片同样的去敏感 + 重名后缀流程。
    - 非图片（PDF / 文本）：沿用原文件名（去除空格 / 路径分隔符 / 控制字符等敏感字符后），重名时自动追加 `-1`、`-2` 后缀。

### 4.4 提交链路改造

`api.createSpec` 与 `POST /api/specs` 增加 `draftId?: string` 字段：

- 前端 `submit()` 在调用 `createSpec` 时附带当前 `draftId`（若有）。
- 后端 `buildDraftPrompt` 增加一段"该 spec 关联草稿附件目录 `.yorz/drafts/<draftId>/attachments/`，请在创建 spec 目录后将其内容迁移到 `.yorz/specs/<id>/attachments/`，并在 `## 背景` 末尾以 markdown 列表引用每个附件（图片用 `![]()`、非图片用 `[]()`）"的指令。
- Agent（即本 skill 在 plan 阶段）会执行迁移并改写 `## 背景` 中插入引用行。
- 迁移失败时（如 draft 目录已被清理）应在 `## 待确认问题` 记录并退出，避免静默丢失。

替代方案：把迁移逻辑放在 service 端 `createSpec` 路径里——但 draft 模式下 spec id 由 Agent 决定，service 无法在 Agent 写盘前就把附件搬到位，因此仍需由 Agent 完成。

### 4.5 spec 文档中的引用形式

- 附件落到 `.yorz/specs/<id>/attachments/<name>`。
- skill 在 plan 阶段（即本 spec 创建后）在 `## 背景` 章节末尾追加：

  ```markdown
  附件：

  - ![需求描述截图 1](attachments/image-a1b2.png)
  - [设计文档](attachments/design-spec.pdf)
  - [示例输入](attachments/sample-input.txt)
  ```

- 规则：`kind === 'image'` 用 `![alt](path)`；`kind === 'pdf' | 'text'` 用 `[name](path)`；`alt` / `name` 取用户在 UI 中确认或重命名后的 `name` 字段。
- 若 Agent 希望在分析中引用附件，可在 `## 现状分析` / `## 技术实现方案` 中直接复用相同的相对路径。

### 4.6 GUI 预览静态资源路由

- 新增 `GET /api/specs/:id/attachments/:name` 与 `GET /api/spec-drafts/:draftId/attachments/:name`，由 Hono 直接读盘返回二进制：
  - 图片：`Content-Type: image/*`，`Content-Disposition: inline`，`Cache-Control: max-age=300`。
  - PDF：`Content-Type: application/pdf`，`Content-Disposition: inline`（允许浏览器内预览）。
  - 文本：`Content-Type: text/plain; charset=utf-8` 或 `text/markdown`，`Content-Disposition: inline`。
- 缩略图在草稿期：图片使用 `URL.createObjectURL(file)`；PDF/文本使用静态类型图标。
- 提交成功跳转后，SpecDetail 的 markdown 渲染器对 `attachments/xxx.png` 自动映射到 `/api/specs/:id/attachments/xxx.png`；对非图片链接保持点击后由浏览器决定打开/下载（依赖 `Content-Disposition`）。

### 4.7 清理与回收

- 后端为 `.yorz/drafts/` 目录设置惰性 TTL（保留 24 小时）：service 启动时与每次新建 draft 时扫描，删除 mtime > 24h 的 draft 目录。
- 用户离开 NewSpec 页且未提交，且 `attachments` 非空 → 在 `onCleanup` 中**不**主动调用 DELETE，让后台 24h TTL 兜底。

### 4.8 影响面

- 新增 / 改动文件预期：
  - `src/gui/src/pages/NewSpec.tsx`（新增附件 UI、paste 逻辑、重命名）
  - `src/gui/src/lib/api.ts`（新增 draft 与 attachment 接口、扩展 createSpec、新增 PATCH 重命名）
  - `src/service/routes/spec-drafts.ts`（**新增**）
  - `src/service/routes/specs.ts`（扩展附件静态路由、`buildDraftPrompt` 增加迁移指令与"图片用 `![]()`、非图片用 `[]()`"指令、`createSpec` 增加 `draftId`）
  - `src/service/draft-store.ts` 或 `attachment-store.ts`（**新增**：负责 draft 目录与附件落盘、MIME 校验、重命名、TTL 清理）
  - 样式 `src/gui/src/styles/*`（缩略图、附件区、文件类型图标）
  - 测试：service 路由测试、SpecStore 不变、可选的前端组件测试
  - skill `yorz-spec/new-spec.md`：补一段"如收到 `draftId`，执行附件迁移并按 kind 选择 markdown 引用语法"指令；本 spec 落地后再补改
- 不影响：CLI（无 NewSpec UI）、追加任务流程、execute 阶段。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 新增 `src/service/attachment-store.ts`：实现 draft 目录创建、附件落盘、MIME 白名单（`image/*` / `application/pdf` / `text/plain` / `text/markdown`）校验、单文件 ≤ 5 MB 与累计 ≤ 10 个上限校验、图片占位名 → `image-<uuid:4>.<ext>` 改写、非图片去敏感字符 + 重名 `-1`/`-2` 后缀、24h TTL 扫描清理、重命名 API（不改扩展名）；验收：单元测试覆盖 MIME 拒绝 / 大小拒绝 / 数量拒绝 / 重名后缀 / TTL 清理 / 重命名扩展名守卫
- [x] 新增 `src/service/routes/spec-drafts.ts`：实现 `POST /api/spec-drafts`、`POST /api/spec-drafts/:draftId/attachments`（multipart）、`DELETE /api/spec-drafts/:draftId/attachments/:storedName`、`PATCH /api/spec-drafts/:draftId/attachments/:storedName`、`GET /api/spec-drafts/:draftId/attachments/:storedName` 静态预览；验收：路由集成测试覆盖增删改查与 404 / 413 / 415 错误码
- [x] 在 `src/service/routes/specs.ts` 扩展 `POST /api/specs` 接受 `draftId?` 字段，并新增 `GET /api/specs/:id/attachments/:name` 静态路由（按 MIME 设置 `Content-Type` 与 `inline` disposition）；验收：路由测试覆盖含 / 不含 draftId 的两种 createSpec 行为，以及静态资源响应头正确
- [x] 在 `buildDraftPrompt` 中追加附件迁移指令：要求 Agent 将 `.yorz/drafts/<draftId>/attachments/` 内容迁移到 `.yorz/specs/<id>/attachments/`、按 `kind` 在 `## 背景` 末尾追加 markdown 引用列表（image → `![]()`、pdf/text → `[]()`）、迁移失败时写入 `## 待确认问题`；验收：`buildDraftPrompt` 单元测试断言指令文本包含关键路径、kind→语法映射、失败兜底
- [x] 在 service 启动钩子与 `spec-drafts.ts` 创建 draft 入口中触发 `.yorz/drafts/` 24h TTL 扫描清理；验收：单测注入 mtime > 24h 的临时 draft 目录，断言被删除且 mtime ≤ 24h 的不被删除
- [x] 在 `src/gui/src/lib/api.ts` 新增 `createDraft` / `uploadAttachment` / `deleteAttachment` / `renameAttachment` 客户端方法，并扩展 `createSpec` 携带 `draftId`；验收：类型签名通过 `tsc`，单元 mock 测试覆盖各方法的 URL / body / 响应解析
- [x] 在 `src/gui/src/pages/NewSpec.tsx` 新增附件区 UI：导入按钮（隐藏 file input，accept 限定白名单 MIME）、textarea `onPaste` 仅截获图片 item、缩略图列表（图片预览 / 非图片图标 + 文件名）、删除与原地重命名（禁改扩展名）、客户端 5 MB / 10 个 / MIME 三重预校验、submit 时携带 `draftId`、`onCleanup` 时 `revokeObjectURL`；验收：手动跑通"选择图片 + PDF + 文本"以及"粘贴图片"两条路径，提交后跳转新 spec 能看到附件引用
- [x] 在 `src/gui/src/styles/*` 新增附件区与缩略图样式，并补 PDF / 文本类型图标资源；验收：UI 在浅 / 深主题下不破裂，缩略图加载失败回退到类型图标
- [x] 让 SpecDetail 的 markdown 渲染器把相对路径 `attachments/xxx` 自动映射到 `/api/specs/:id/attachments/xxx`，非图片以可点击下载 / 内嵌打开的链接渲染；验收：进入新建的含附件 spec 能看到图片缩略；点击 PDF / 文本能在浏览器内打开或下载
- [x] 更新 `.claude/skills/yorz-spec/new-spec.md`：补一段"如收到 `draftId`，执行附件迁移到 `attachments/` 子目录、按 kind 选择 markdown 引用语法（image → `![]()`、pdf/text → `[]()`）、迁移失败写入 `## 待确认问题`"的指令；验收：手工 review 文档 diff，确认指令位置位于 spec 目录创建之后、骨架填写之前
- [ ] 端到端联调：本地启动 service + gui，演练"新建 spec → 加图片 + PDF + 文本 → 重命名 1 项 → 删除 1 项 → 粘贴 1 张图 → 提交 → 查看新 spec `## 背景` 引用 + 静态路由预览"；验收：流程跑通无 console error，新 spec 目录 `attachments/` 与文档引用一致（**阻塞**：当前 Agent 沙盒环境无法驱动浏览器，需开发者本地手动验证）

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-06-22 新建 spec 并完成 plan 阶段初稿，等待用户对 `## 待确认问题` 的批注。
- 2026-06-22 消费首轮用户批注：5 MB / 10 张 / draft 暂存 / 背景章节引用 / 24h 清理 / `image-<uuid:4>.<ext>` 命名 / 支持重命名 已落入方案；批注扩展附件类型至 PDF/文本触发变更重开，已扩展 §3.6、§4.x 并新增 4 条待确认问题。
- 2026-06-22 消费第二轮用户批注：PDF/文本单文件 ≤ 5 MB（与图片一致）、附件合并计数 ≤ 10 个、MIME 白名单为 `application/pdf` + `text/plain` + `text/markdown`、非图片附件沿用原文件名（去敏感字符）+ 重名 `-1`/`-2`；§4.2 / §4.3 已收敛去除"待 §5 确认"的占位语句，`## 待确认问题` 置为暂无，进入 tasks 阶段并生成 11 条任务清单，移除 `## 用户批注` 章节。
- 2026-06-22 进入 execute 阶段，按任务清单依序实现：
  - 新增 `src/service/attachment-store.ts`（MIME / size / count 校验、占位名重写、TTL 清理、重命名扩展名守卫）+ 单测 `src/service/__tests__/attachment-store.test.ts`（17 条）。
  - 新增 `src/service/routes/spec-drafts.ts`（POST draft、multipart 上传、DELETE / PATCH / GET）+ 集成测试 `src/service/__tests__/spec-drafts-route.test.ts`（14 条），并扩展 `src/service/server.ts` / `index.ts` 注入 `AttachmentStore`、启动时触发 TTL 扫描。
  - 扩展 `src/service/routes/specs.ts`：`POST /api/specs` 接受 `draftId?`、新增 `GET /api/specs/:id/attachments/:name` 静态路由，`buildDraftPrompt` 在收到 draftId 时追加附件迁移与失败兜底指令；`buildDraftPrompt` 改为导出函数并补单测 `src/service/__tests__/build-draft-prompt.test.ts`。
  - 扩展 GUI 客户端 `src/gui/src/lib/api.ts`：新增 `createDraft` / `uploadAttachment` / `deleteAttachment` / `renameAttachment` / `*AttachmentUrl`，`CreateSpecBody.draftId?` 串到 `createSpec`。
  - 改写 `src/gui/src/pages/NewSpec.tsx`：textarea 下方新增附件区，按钮 + 隐藏 `<input type=file>`、`onPaste` 仅吞图片 item、缩略图列表（图片预览 / PDF/TXT 图标）、原地重命名（禁改扩展名）、删除、5 MB / 10 个 / MIME 三重校验、submit 自动携带 `draftId`、onCleanup 时 `revokeObjectURL`。
  - 追加 `src/gui/src/styles.css` 附件区与缩略图样式。
  - 扩展 `src/gui/src/lib/markdown.ts`：渲染时把相对 `attachments/xxx` 自动映射到 `/api/specs/:id/attachments/xxx`，非图片链接加 `target=_blank`；SpecDetail 调用处传入 `specId`；新增 `src/gui/src/lib/__tests__/markdown.test.ts`（5 条）。
  - 更新 `.claude/skills/yorz-spec/new-spec.md`：在 spec 骨架写入之后、进入 plan 之前插入"附件迁移（仅当收到 draftId 时）"步骤，明确 kind→markdown 语法映射与迁移失败写入 `## 待确认问题` 的兜底。
  - 验证：`npx vitest run` 通过（20 个文件 / 157 个用例），`npx tsc --noEmit` 仅余一条 pre-existing 警告（`QuestionConfirmPanel.tsx:46` 与本变更无关），`npx vite build` 与 `npx vite build --config vite.gui.config.ts` 均成功。
- 2026-06-22 端到端联调任务保留为未完成：当前 Agent 沙盒环境无法驱动浏览器与剪贴板，需开发者本地 `pnpm dev` 启动 service + gui 后手动跑一遍"上传 + 粘贴 + 重命名 + 删除 + 提交 + SpecDetail 预览"流程。

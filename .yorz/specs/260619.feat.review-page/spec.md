---
stage: execute
last_action: 执行任务清单（自动化部分），人工冒烟待用户验证
updated_at: 2026-06-19
summary: 在 spec 详情页新增 review 入口，进入后展示该 spec 相关联的变更文件列表，并提供一键提交 git 的按钮，便于 Agent 跑完任务后快速 review 与提交。
---

# Spec Review Page

## 1. 背景

[[260617.feat.agent-stream-panel]] / [[260618.fix.agent-streaming-and-cancel]] 已让 Agent 在 spec 文档页可以全程驱动并流式输出，Agent 任务结束后用户的下一步动作是「检查改动并提交」。当前 GUI 没有任何承接这一步的入口：

- spec 详情页（`src/gui/src/pages/SpecDetail.tsx`）只展示 spec md，正文里也只能看到执行记录的文字描述，无法直观看到磁盘上落了哪些改动。
- 用户必须切到终端跑 `git status` / `git diff` / `git commit`，再回到 GUI 继续下一个 spec，体验割裂。
- 已经存在「提交 git」相关的 TODO（见 `README.md` 第 17 行：「快捷指令 → 提交 git」），review 入口可以一并承担。

## 2. 需求

最小可用版本（MVP）只覆盖：

1. spec 详情页头部新增「Review」入口，可跳转到当前 spec 的 review 页。
2. Review 页面以列表形式展示「与当前 spec 相关联的变更文件」（路径 + 变更类型如 M/A/D/??）。
3. 一个「提交到 git」按钮，点击后把上述变更文件作为一次 commit 提交。
4. 提交成功后给出明确反馈（成功 / 失败原因），失败不破坏工作区。

显式不在 MVP 范围内的功能（避免范围扩张）：

- 行内 diff 预览
- 部分文件勾选 / 反选
- amend、push、撤销 commit、分支管理
- 与远端的同步

## 3. 现状分析

### 3.1 前端路由与 spec 详情页

- `src/gui/src/main.tsx` 当前注册了三条路由：`/`、`/specs/new`、`/specs/:id`，均挂在 `AppShell` 之下。Review 页面需要新增一条 `/specs/:id/review`。
- `src/gui/src/AppShell.tsx` 顶栏只有「YorZ」品牌链接 + 「新建 spec」，没有「返回」一类的次级导航；review 子页需要自己在 header 处提供返回 spec 详情页的入口。
- `src/gui/src/pages/SpecDetail.tsx` 的 header（`detail-head`）目前并列「运行 Agent」按钮（约 161–181 行），review 入口应放在这里，紧邻它，复用 `primary-action` 样式族。
- `src/gui/src/lib/api.ts` 把所有后端调用收敛成单一 `api` 对象；新增 review/commit 接口需要在这里加方法，并补全类型。

### 3.2 后端路由分布与依赖

- `src/service/server.ts` 把 `/api` 下分挂到 `createSpecsRoutes` / `createEventsRoutes` / `createProjectRoutes`。review 相关接口与 spec 强绑定（按 specId 查变更、按 specId 提交），最自然落在 `createSpecsRoutes` 里，沿用 `Deps = { store, runner }` 的注入方式，并补一个 `cwd` 字段。
- 各路由文件都使用 Hono + 手写 body 解析（见 `parseCreateBody` / `parseQuestionAnswersBody`），没有引入校验库，新接口沿用同一风格即可。
- `src/service/index.ts` 已经在用 `child_process.spawn`（启动浏览器），新增 git 调用直接复用 `node:child_process`（`execFile`/`spawn`）即可，不引第三方依赖。

### 3.3 Agent runner 与流事件

- `src/service/agent.ts` 已经在 `attachJsonlStream` / `handleLine` 中解析 claude `stream-json` 的每条事件，并通过 `formatMessage` 识别 `tool_use` 与 `tool_result`。这意味着我们可以在不改 Agent 子进程命令的前提下，额外旁路出"本次 run 写过哪些文件"。
- `AgentRunner` 当前对外暴露 `run / get / active / listActive / cancel / subscribe`，事件源（emitter）目前只对外发 `stdout` / `exit` / `error`。新增 `file_touched` 不会破坏既有调用方。
- 文件级写动作集中在固定几种工具：`Write` / `Edit` / `MultiEdit` / `NotebookEdit`，其 `input.file_path` 字段稳定。`Bash` 内部的写动作覆盖率太低、解析风险高，本期不识别。

### 3.4 spec 子目录与持久化

- `SpecStore.specsDir = <cwd>/.yorz/specs`；每个 spec 拥有独立子目录 `.yorz/specs/<id>/`，目前只放 `spec.md`，但目录本身已被 git 看见（git status 中可见 `.yorz/specs/...` 未跟踪态）。Agent 写入路径的中间产物落到这里最自然。
- spec id 形如 `YYMMDD.<type>.<slug>`；嵌入 commit message 时使用 `[spec:<id>]` 锚点即可。

### 3.5 git 仓库现状

- 仓库根（`process.cwd()`）已经是 git 仓库。spec 目录 `.yorz/specs/<id>/` 未在 `.gitignore` 中，证明 spec 目录本身会被 git 看见——这意味着 `touched-files.json` 这类中间产物如果不想被纳入提交，需要主动剔除（见 §4.4）。
- 当前没有任何 git 包装代码；提交语义、签名、co-author 等约定全部沉淀在用户 git 配置 / commit hook，本期保持中立，不强加签名/co-author。

### 3.6 现有约束

- 无前端单测基础设施（见 [[260618.fix.agent-streaming-and-cancel]] §4.5），review 页面只能靠 service 单测 + 人工冒烟兜底。
- prettier 已经在仓库根配置；新增 ts/tsx 文件需要遵守，避免 spec 写回后 formatter 报警。
- macOS / Linux 为主支持平台，git 调用按 POSIX 路径处理即可。

## 4. 技术实现方案

### 4.1 总体思路

- **后端**：在 `createSpecsRoutes` 中新增 2 个接口——`GET /api/specs/:id/changes`（列变更）与 `POST /api/specs/:id/commit`（提交）。git 操作封装到 `src/service/git.ts`，仅用 `node:child_process.execFile` 调用本地 `git`，零依赖。
- **「相关联」的取值**：MVP 等价于「**Agent 本次（及之前未提交）run 中真实写过的文件** ∩ **当前 git 工作区相对 HEAD 的未提交变更**」。两边都必要：
  - touched 集合保证视图聚焦在 Agent 动过的文件，不被用户的并发改动污染。
  - 与 git status 取交集排除掉「Agent 写过但用户随后手动 revert / 已经提交」的路径。
- **Agent 写入捕获**：复用 `AgentRunner` 已有的 stream-json 解析路径，在识别到 `Write` / `Edit` / `MultiEdit` / `NotebookEdit` 工具调用时旁路记录 `input.file_path`。该 set 持久化到 `.yorz/specs/<id>/touched-files.json`（跨 service 进程重启依然可读）。
- **前端**：新增 `Review` 页面与路由 `/specs/:id/review`，SpecDetail 头部加入「Review」入口按钮（始终可见，按 Q6 决议），api 客户端加入对应方法，UI 仅做最朴素的列表 + 单按钮，错误以 banner 形式展示。

### 4.2 Agent 写入路径捕获与持久化

新建 `src/service/touched-files.ts`：

- `class TouchedFilesStore`：
  - `add(specId, paths: string[])`：把路径并入 `.yorz/specs/<specId>/touched-files.json`（结构：`{ paths: string[] }`），按 set 语义去重；忽略空字符串与绝对路径之外的输入（后者交给 git 层校验）。
  - `read(specId): Promise<string[]>`：缺失则返回 `[]`。
  - `remove(specId, paths: string[])`：commit 成功后从集合中移除已提交路径，结果为空时删除 json 文件。
  - 所有写入串行（`p-queue` 思路即可，但本期就用一个 per-spec mutex Map，避免引入新依赖）。
  - 路径相对 `cwd` 存储（保持与 git status 输出一致），避免被绝对路径污染。

修改 `src/service/agent.ts`：

- 在 `handleLine`（已解析出 `ev`）中新增对 `assistant` 消息内 `tool_use` 项的扫描：当 `p.name` ∈ `{ 'Write', 'Edit', 'MultiEdit', 'NotebookEdit' }` 且 `p.input.file_path` 是字符串时，归一化为相对 `cwd` 的 POSIX 路径，emit `'file_touched'` 事件。
- `AgentRunner` 在 `spawn` 内对 emitter 增加监听：`emitter.on('file_touched', (relPath) => this.touched?.add(specId, [relPath]))`。`touched` 通过构造函数注入，可选（保持测试简单）。
- `AgentRunHandle` 新增 `onFileTouched(cb)`，为未来 SSE 推送做准备（本期不在 events.ts 中暴露，避免范围扩张）。

`createApp` 把 `TouchedFilesStore` 注入 `AgentRunner` 与 `createSpecsRoutes`。

### 4.3 后端：git 操作封装

新建 `src/service/git.ts`：

- 暴露一组函数 `listChanges(cwd) / commit(cwd, opts)`：
  - `listChanges(cwd): Promise<GitChange[]>`：内部 `git status --porcelain=v1 -z --untracked-files=all`，解析为 `{ path: string; index: string; worktree: string; status: 'A'|'M'|'D'|'R'|'??'|...; renamedFrom?: string }`。使用 `-z` + NUL 分隔，规避空格/中文路径问题。
  - `commit(cwd, { message, paths }): Promise<{ commit: string }>`：先 `git add -- <paths>`（`paths` 必须非空且每个都通过白名单校验），再 `git commit -m <message>`；解析输出取新 commit hash（`git rev-parse HEAD`）。
- 所有调用通过 `execFile('git', [...args], { cwd })`，**禁止字符串拼接 shell 命令**，避免命令注入。
- 错误模型：抛出 `class GitError extends Error { code: string; stderr: string }`；路由侧捕获后按错误码映射到 HTTP 400/409/500。
- 路径校验：
  - 拒绝绝对路径、`..` 段、以 `/` 开头的路径。
  - 用 `path.resolve(cwd, p)` 后再校验仍在 `cwd` 之下，杜绝越界。

### 4.4 后端：路由

修改 `src/service/server.ts`，把 `cwd` 与 `TouchedFilesStore` 一并注入 `createSpecsRoutes`；`Deps` 扩展为 `{ store, runner, touched, cwd }`。

在 `src/service/routes/specs.ts` 新增：

- `GET /specs/:id/changes`：
  - 先 `store.read(id)` 确认 spec 存在（404 复用现有风格）。
  - 并行调 `touched.read(id)` 与 `listChanges(cwd)`，求交集后按路径排序返回 `{ changes: GitChange[] }`。
  - touched 集合为空时返回 `{ changes: [] }`（空态由前端处理）。
  - **额外过滤**：默认剔除 `.yorz/specs/<id>/touched-files.json` 自身，避免把中间产物推入交集（即便它出现在 git status，也不该被这条路径关联到 spec）。
- `POST /specs/:id/commit`：
  - 校验 body：`{ message: string; paths?: string[] }`。
    - `message` 必填，trim 后非空，长度 ≤ 2000；
    - `paths` 可省略——省略时使用 `GET /changes` 等价结果的全集；若给出则必须是该全集的子集（防止外部传入仓库其它路径）。
  - 服务端**强制**在 message 末尾追加单独一行 `[spec:<id>]`（若用户传入的 message 已包含该锚点则不重复追加）。这一行是 Q3 决议，零运行时成本、便于未来按 spec 过滤已提交内容。
  - 调用 `commit(cwd, ...)`；成功：
    1. 调 `touched.remove(id, paths)` 清理已提交路径。
    2. 调 `store.appendExecutionLog(id, line)` 把一条形如 `- YYYY-MM-DD 提交 <short-sha>：<message 首行>（N 个文件）` 写回 spec 的 `## N. 执行记录` 末尾（Q4 决议）。
    3. 返回 `{ ok: true, commit: <sha> }`。
  - 失败：4xx + `{ ok: false, error }`，不动 touched 集合，不动 spec md。

### 4.5 SpecStore：追加执行记录

修改 `src/service/spec-store.ts`：

- 新增 `async appendExecutionLog(id: string, line: string): Promise<void>`：
  - 读 spec md，定位 `## 执行记录`（兼容已编号 `## N. 执行记录`）章节。
  - 不存在时按 `SECTIONS` 末尾补齐，再追加一行 `- ${line}`。
  - 更新 frontmatter：`last_action: 提交 git`，`updated_at: today`，`stage` / `summary` 保持原值。
  - 复用现有 `serializeSpec` + `write`，触发 `onWrite` 让 watcher echo-suppress。
- **不**自动给标题重排编号——`SpecStore` 当前的写入路径都没有做编号维护，由 skill 在下一次完整写回时统一处理。

### 4.6 前端：路由与入口

- `src/gui/src/main.tsx` 增加路由：`<Route path="/specs/:id/review" component={SpecReview} />`。
- `src/gui/src/pages/SpecDetail.tsx` header 在「运行 Agent」按钮左侧加 `<A class="ghost" href={\`/specs/${s().id}/review\`}>Review</A>`，沿用 `ghost`/`primary-action` 已有的样式。入口始终可见（Q6 决议）。
- 新增 `src/gui/src/pages/SpecReview.tsx`：
  - `useParams<{ id: string }>` 拿 specId。
  - `createResource(() => api.getSpec(id))` 拿 spec 概要（用于 commit message 默认值）。
  - `createResource(() => api.listSpecChanges(id))` 加载变更列表；首屏渲染 loading / 空态（无变更则提示"暂无 Agent 本次写入的未提交改动"并禁用提交按钮）。
  - 渲染 `<ul>`：每项 `状态徽章(M/A/D/??) + 单色路径`。
  - 提交区：`<textarea>` 输入 commit message + 「提交」按钮。
    - 默认值模板：`${type}(${specId}): ${spec.summary}`，其中 `type` 从 specId 第二段（`feat` / `fix` / `refct`）解析；`summary` 截断到 100 字符。textarea 可改（Q2 决议）。
    - 不在前端拼 `[spec:<id>]` 尾行，避免与服务端追加重复——前端只展示用户语义部分。
  - 提交流程：
    1. 禁用按钮，调用 `api.commitSpecChanges(id, { message })`。
    2. 成功：把变更列表清空，渲染 `提交成功：<short-sha>` toast/banner；保留页面，不自动跳转。
    3. 失败：显示 `<p class="error">` 错误文本，按钮恢复。
- 新增 `src/gui/src/lib/api.ts` 方法：
  - `listSpecChanges(id): Promise<{ changes: GitChange[] }>`；
  - `commitSpecChanges(id, body): Promise<{ ok: true; commit: string }>`。
- 不引入新的全局状态、不接 SSE：用户每次打开 review 页主动拉一次即可。

### 4.7 验证与回归

- 服务端单测（在 `src/service/__tests__/` 新增）：
  - `git.test.ts`：在 tmp 目录初始化裸 repo，制造 M/A/D/?? 四类变更，验证 `listChanges` 解析正确；调用 `commit` 后 `git log --name-only` 与传入 paths 一致。
  - `touched-files.test.ts`：覆盖 add 去重、缺文件 read 返回空、remove 后空集合时文件被清理。
  - `agent.test.ts` 增补：构造一段含 `Write` / `Edit` tool_use 的 stream-json 输入，验证 `'file_touched'` 事件被 emit 且 `file_path` 归一化正确。
  - `service.test.ts` 增补：`GET /api/specs/:id/changes` 覆盖 happy path / 404 / 空 touched 集合；`POST /api/specs/:id/commit` 覆盖 happy path / 404 / 400（message 缺失）/ 400（paths 越界）；提交成功后断言 spec md 执行记录被追加。
- GUI：依赖人工冒烟：在本地仓库制造改动（通过 Agent run 触发 Write/Edit）→ 打开 review 页 → 看到列表 → 提交 → `git log` 确认新 commit 内含 `[spec:<id>]` 尾行 → 检查 spec md 执行记录被追加。

### 4.8 不在本期范围

- 行内 diff 预览（计划后续单独 spec 处理）。
- 文件级 checkbox / 部分提交。
- amend / 改写历史 / push / 撤销。
- `Bash` 内部写动作的捕获（覆盖率低、解析风险高）。
- Co-Authored-By 等签名（Q5 决议：完全不加，由用户 git 配置决定）。
- 已提交内容按 `[spec:<id>]` 反向检索（锚点已埋下，UI 留给后续 spec）。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/service/git.ts` 实现 `listChanges` / `commit` / `GitError` / 路径白名单校验，全部使用 `execFile`，禁止 shell 拼接；导出类型 `GitChange`。
- [x] 在 `src/service/touched-files.ts` 实现 `TouchedFilesStore`（`add` / `read` / `remove`），按 spec 串行写入 `.yorz/specs/<id>/touched-files.json`，路径以相对 `cwd` 的 POSIX 形式存储。
- [x] 在 `src/service/agent.ts` 的 `handleLine` 中识别 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 工具调用，emit `'file_touched'` 事件；`AgentRunner` 注入 `TouchedFilesStore`，在事件触发时累计落盘。
- [x] 在 `src/service/spec-store.ts` 新增 `appendExecutionLog(id, line)`：定位执行记录章节追加一行，更新 frontmatter（`last_action`/`updated_at`），复用 `serializeSpec`+`onWrite`。
- [x] 在 `src/service/routes/specs.ts` 新增 `GET /specs/:id/changes`：返回 `touched ∩ listChanges(cwd)`，剔除 `.yorz/specs/<id>/touched-files.json` 自身，404 复用现有风格。
- [x] 在 `src/service/routes/specs.ts` 新增 `POST /specs/:id/commit`：校验 `message`/`paths`，服务端强制追加 `[spec:<id>]` 尾行，调用 `git.commit`，成功后 `touched.remove` + `appendExecutionLog`，错误码映射 400/404/409/500。
- [x] 修改 `src/service/server.ts` 的 `CreateAppOptions` 与 `createApp`，把 `cwd` + `TouchedFilesStore` 注入到 `AgentRunner` 与 `createSpecsRoutes`。
- [x] 在 `src/gui/src/lib/api.ts` 增加 `listSpecChanges` / `commitSpecChanges` 类型与方法，与后端响应字段保持一致。
- [x] 在 `src/gui/src/main.tsx` 注册 `/specs/:id/review` 路由，挂在 `AppShell` 之下。
- [x] 新建 `src/gui/src/pages/SpecReview.tsx`：`createResource` 拉 spec + changes，渲染状态徽章 + 路径列表 + 默认 commit message textarea + 提交按钮 + 成功/失败 banner；空态禁用提交。
- [x] 在 `src/gui/src/pages/SpecDetail.tsx` 的 `detail-head` 中，「运行 Agent」按钮左侧新增 `<A class="ghost" href={\`/specs/${id}/review\`}>Review</A>` 入口，始终可见。
- [x] 新增 `src/service/__tests__/git.test.ts`：tmp 仓库构造 M/A/D/?? 四类变更，断言 `listChanges` 解析、`commit` 后 `git log --name-only` 与 paths 一致、路径越界被拒。
- [x] 新增 `src/service/__tests__/touched-files.test.ts`：覆盖 add 去重、空集合 read 返回 `[]`、remove 清空后文件被删。
- [x] 在 `src/service/__tests__/agent.test.ts` 增补：注入伪造的 stream-json 行（含 `Write`/`Edit` tool_use），断言 `'file_touched'` 被 emit、`file_path` 已归一化为相对 `cwd`。
- [x] 在 `src/service/__tests__/service.test.ts` 增补：`GET /api/specs/:id/changes`（happy / 404 / 空 touched）与 `POST /api/specs/:id/commit`（happy / 404 / 400 message 缺失 / 400 paths 越界），并断言提交后 spec md 执行记录被追加且 commit message 含 `[spec:<id>]` 尾行。
- [x] 在仓库根运行 `npx prettier --write .yorz/specs/260619.feat.review-page/spec.md` 与 `npm test`（若存在），把结果写回执行记录。
- [ ] 人工冒烟：跑一次 Agent → 打开 review 页 → 看变更列表 → 提交 → `git log -1 --name-only` 验证 commit 内容与 `[spec:<id>]` 尾行，记录到执行记录。

## 7. 执行记录

- 2026-06-19 plan 阶段：完成现状分析、技术实现方案与待确认问题；阻塞在 §5 待用户批注。
- 2026-06-19 tasks 阶段：消费 6 条 `！！！` 批注；Q1 选项 B 引入「Agent 写入路径捕获」链路，§4 重写为 `touched ∩ git status` 的方案；Q3/Q4 落地为服务端追加 `[spec:<id>]` 尾行 + `appendExecutionLog`；Q5/Q6 维持中立/常显；拆解为 17 项任务，进入 execute。
- 2026-06-19 execute 阶段：实现后端三个新模块（`git.ts` / `touched-files.ts` / `SpecStore.appendExecutionLog`）；改造 `AgentRunner` 从 stream-json 中识别 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 工具调用并旁路 `'file_touched'` 事件；在 `routes/specs.ts` 新增 `GET /specs/:id/changes` 与 `POST /specs/:id/commit`（含 `[spec:<id>]` 锚点强制追加、`appendExecutionLog` 回写）；`server.ts` + `index.ts` 注入 `TouchedFilesStore` 与 `cwd`。前端新增 `/specs/:id/review` 路由与 `SpecReview` 页面，`SpecDetail` 头部加 Review 入口，`api.ts` 暴露 `listSpecChanges` / `commitSpecChanges`，并补足最小 CSS。
- 2026-06-19 execute 验证：`npx tsc --noEmit` 通过；`npx vitest run` 全量 110/110 通过（新增 `git.test.ts` 7 项、`touched-files.test.ts` 6 项、`agent.test.ts` +2 项、`service.test.ts` +6 项）；`npx vite build --config vite.gui.config.ts` 产物 OK；prettier 已格式化全部新增/修改文件。剩余「人工冒烟」需用户在本机跑一次 Agent → 打开 review 页 → 提交，从 `git log -1` 验证 `[spec:<id>]` 尾行。

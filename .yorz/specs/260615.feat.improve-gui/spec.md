---
stage: execute
last_action: 全部任务执行完毕，pnpm test 40/40 通过、build 通过、端到端冒烟通过
updated_at: 2026-06-16
summary: 改进 GUI：文本选择浮动菜单、批注落盘到 spec、解释通过 Service 中转 Agent、页面触发 Agent 续跑、简化新建表单与移除底部追加批注
---

# 改进 GUI 交互体验

## 背景

- 产品设计与技术设计文档 @docs/Prod-Design.md @docs/Architecture.md
- 已实现需求 ../260614.feat.minimal-service-gui/
  - html 页面已渲染 spec 内容，功能与样式有待优化

## 需求

- 选择文本弹出浮动菜单，包含批注、解释两个菜单项
- 页面需要可交互的批注功能
  - 用户用鼠标选择一段文本，可以给文本添加批注，类似 word 的批注交互
  - 批次内容以某种格式与引用（选中）的内容关联，落到 yorz 的 spec 文档中，最终目的是传递给 Agent
    - Agent 根据 批注内容更新 spec 文档
- 页面需要解释功能
  - 用户可以选择某段文本，让 Agent 解释这段文本的含义
  - 解释内容不需要更新 spec 文档，通过 cli server 在页面与 Agent 之间中转内容
- spec 页面缺失调用 Agent 的能力
  - 期望批注之后，可以在页面触发 cli server 调用 Agent 按照 skill 继续执行
- 移除页面底部追加内容功能 @src/gui/src/pages/SpecDetail.tsx
- 简化新增 spec 页面 @src/gui/src/pages/NewSpec.tsx
  - 只需要选择类型、输出内容，标题、总结总结应该由 Agent 自动补全
  - 新建之后应该直接调用 Agent 按 skill 执行

## 现状分析

### GUI 现状

- `src/gui/src/pages/SpecDetail.tsx`
  - 仅渲染 markdown（`renderMarkdown` → `innerHTML`），无文本选择/批注交互
  - 底部存在「追加批注」表单：`textarea` + 提交按钮 → `POST /api/specs/:id/inputs { kind: 'append-note', content }`
  - SSE 订阅 `subscribeSpec` 已经能在 md 变更时自动 refetch
- `src/gui/src/pages/NewSpec.tsx`
  - 表单字段：`title`（必填） / `type` 三选一 / `summary`（必填，≤200） / `requirement`（可选 textarea）
  - 校验后 `POST /api/specs` → 跳转 `/specs/:id`，**未触发 Agent**
- `src/gui/src/lib/api.ts` 当前接口：`listSpecs` / `getSpec` / `createSpec` / `appendNote` / `getProject`，无「触发 Agent」与「请求解释」接口
- `src/gui/src/lib/sse.ts` 仅订阅单个 spec 的文件变更事件

### Service 现状

- `src/service/spec-store.ts`
  - `create()` 校验 `title.trim()` 与 `summary.trim()` 必填，否则抛错
  - `appendNote()` 以 `> 用户批注（YYYY-MM-DD）：...` 形式追加到 body 末尾，更新 `updated_at`，`last_action` 固定为「追加用户批注」
  - 章节常量 `SECTIONS` 已包含七大空章节
- `src/service/routes/specs.ts`
  - `POST /api/specs` 校验 `title` 与 `summary` 必填，type 默认 `feat`
  - `POST /api/specs/:id/inputs` 当前仅支持 `kind: 'append-note'`
- 不存在「触发 Agent」「Agent 解释」等接口，**Architecture 4.2 中 Agent Relauncher 模块尚未落地**
- `src/service/server.ts` / `index.ts` 没有引用任何 child_process / spawn 调用

### 与 skill 的契合点

- `yorz-spec` skill 自动模式判定第 3 条：「文档存在任意 `！！！` 批注 → 进入 tasks」
- skill 阶段二 tasks 行为：消费所有 `！！！` 批注，合并意图到方案与任务清单，处理后删除批注文本
- 这意味着：**只要批注以 `！！！` 开头并写回到 spec md**，Agent 续跑就会自动按 skill 工作流推进；GUI 端不需要再为「触发 Agent」编造额外的提示词，只要 spawn 一次"驱动 yorz-spec skill"的 Agent 进程即可

### 既有约束

- 项目根 `claude` 命令存在（别名 `claude --dangerously-skip-permissions`），`opencode` 命令也已安装
- 项目尚无 Agent 选择的运行时配置；CLI 的 `adapters/*` 仅用于解决 skills 安装目录，不涉及 spawn

## 技术实现方案

### 总览

本期把 GUI 从「只读 + 追加批注」升级为「围绕文本选择展开的批注 / 解释 + 主动驱动 Agent」。新增能力切分到四条独立通道，并对现有创建表单做减法：

1. **选择浮动菜单**：纯前端，基于 `Selection` + `Range` API + `position: fixed` 自定义 DOM 菜单，定位到选区附近。
2. **批注落盘**：复用「写 spec md → SSE 刷新」环路；新 `kind: 'annotate'` 输入类型把"章节号 + 标题 + 选中文本 + 批注"写回 spec md，批注体使用 skill 约定的 `！！！` 前缀。
3. **解释中转**：新增最小 Agent Relauncher（基于 `claude -p`），结果通过 SSE 流式回到 GUI，**不落到 spec md，不持久化**。
4. **页面触发 Agent 续跑**：同一 Relauncher 抽象，skill-run 模式；GUI 顶部常驻「运行 Agent」按钮，**仅手动触发**；stdout 通过 SSE 广播到「执行日志」面板。
5. **NewSpec 简化 + 自动续跑**：表单只保留 `type` + 「需求内容」textarea；Service 端放宽 `title` / `summary` 必填约束；创建成功后前端立即触发一次 Agent skill-run。
6. **skill 自身扩展（小幅）**：在 `.claude/skills/yorz-spec/SKILL.md` 增加约定——写回 spec 时必须给二、三级标题加层级编号（`## 1. 背景` / `### 2.1 GUI 现状`），便于批注引用回查。

### Service 改造

#### Agent Relauncher（新增）

新增 `src/service/agent.ts`：

```ts
export type AgentMode = 'skill-run' | 'explain'
export interface RunAgentInput {
  specId: string
  mode: AgentMode
  prompt: string
}
export interface AgentRunHandle {
  id: string
  mode: AgentMode
  specId: string
  onStdout(cb: (chunk: string) => void): () => void
  onExit(cb: (code: number) => void): () => void
  onError(cb: (msg: string) => void): () => void
  buffer(): string // 历史 stdout（≤64 KB）
  kill(): void
}
export class AgentRunner {
  constructor(opts: {
    cwd: string
    resolveAgentCmd: () => { cmd: string; args: (prompt: string) => string[] }
  })
  run(input: RunAgentInput): AgentRunHandle
  get(runId: string): AgentRunHandle | undefined
}
```

- 实现：`child_process.spawn(cmd, args(prompt), { cwd, env, stdio: ['ignore','pipe','pipe'] })`
  - MVP 锁定 `claude -p <prompt>` 一次性模式
  - `cmd` / `args` 通过 `resolveAgentCmd()` 计算，读取 `.yorz/config.json` 的 `agent` 字段（默认 `claude`）；后续可在不改 Runner 的前提下切换
- 并发约束：内部 `Map<specId, AgentRunHandle>` 仅限制 `mode: 'skill-run'`；同 specId 已有 skill-run 进程时直接复用（返回已有 handle）。`mode: 'explain'` 与 specId 解耦，可多次并发触发
- stdout 缓冲：每个 handle 维护一个环形 buffer（≤ 64 KB），SSE 后接订阅时补播缓冲历史，避免错过早期输出
- 异常：spawn 失败 / 进程非零退出 → 触发 `onError` 与 `onExit`；清理 Map

> 不引入完整的多 Agent adapter 抽象；仅在 `agent.ts` + 一个轻量 `agent-config.ts` 读取 `.yorz/config.json`。

#### `.yorz/config.json`（新增）

```jsonc
{
  "agent": "claude", // "claude" | "opencode"，缺省 "claude"
}
```

- Service 启动时检测 `<cwd>/.yorz/config.json`，缺省默认 claude
- 运行时不监听该配置变更；用户改后需重启 service 生效

#### `spec-store.ts` 调整

- `create({ type, requirement, title?, summary? })`：放宽校验
  - 若 `title` 缺失或为空 → 取 `requirement` 首行（截断 ≤30 字符）作为占位标题，否则 `未命名 spec`
  - 若 `summary` 缺失或为空 → 取 `requirement` 首段截断 ≤200 字符作为占位 summary
  - id 仍按 `YYMMDD.<type>.<kebab>` 生成；kebab 源改为「优先 requirement → fallback title」
- 新增 `appendAnnotation(id, { sectionPath, quote, note })`：
  - 参数：`sectionPath` 形如 `"2.1 GUI 现状"`（章节号 + 标题，前端从渲染的 DOM 解析）；`quote` 为选中文本，`note` 为批注正文
  - 在 body 末尾追加：
    ```
    > {{sectionPath}} 中 "{{quote 截断 ≤200}}"
    >
    > ！！！{{note}}
    ```
  - frontmatter 更新：`stage` 切回 `plan`（按 skill 全局硬约束，作为安全下界；skill 自动模式第 3 条会再次推进到 tasks）；`last_action: '用户新增批注 ！！！'`；`updated_at: today`
- **移除** `appendNote()`：连同 `POST /api/specs/:id/inputs { kind: 'append-note' }` 路由分支与对应测试一并删除（用户决议）
- `serializeSpec` 已正确处理 frontmatter 字段顺序，无需改动

#### Routes 改造

`src/service/routes/specs.ts`：

- `POST /api/specs`：
  - `title` / `summary` 改为可选；保留 `type` 校验
  - 返回 `{ id, path }` 同前
- `POST /api/specs/:id/inputs`：
  - 仅支持 `kind: 'annotate'`，body：`{ kind: 'annotate', sectionPath: string, quote: string, note: string }`
  - 校验：`quote` 与 `note` 非空，长度上限 quote ≤ 2000、note ≤ 2000、sectionPath ≤ 200；不再接受 `append-note`
- 新增 `POST /api/specs/:id/run`：触发 Agent skill-run
  - body：`{}`
  - prompt：
    ```
    请使用 yorz-spec skill 处理 spec：.yorz/specs/<id>/spec.md
    ```
  - 返回 `{ runId }`；若 spec 已有 skill-run 运行中，返回该已存在 runId（不创建新进程）
- 新增 `POST /api/specs/:id/explain`：触发 Agent 解释
  - body：`{ text: string }`，校验非空 ≤ 4000
  - prompt：

    ```
    以下为 spec 文档 .yorz/specs/<id>/spec.md 中的一段内容。
    请用中文简洁解释其含义、背景与可能的实施影响。**不要**修改任何文件，只在终端输出解释文本。

    引用：
    """
    {{text}}
    """
    ```

  - 返回 `{ runId }`；不持久化结果

`src/service/routes/events.ts`：

- 现有 SSE 已发送 `event: updated`
- 增加事件类型：
  - `event: agent-stdout`，data `{ runId, mode, specId, chunk }`
  - `event: agent-exit`，data `{ runId, mode, specId, code }`
  - `event: agent-error`，data `{ runId, mode, specId, message }`
- 订阅器订阅 watcher + AgentRunner；连接建立时若有匹配 specId 的活跃 run，先补播 `buffer()` 内容
- 仅对该 specId 相关的 agent 事件下推；解耦：explain 通过 specId 路由，不影响其他 spec 的事件

#### 安全 / 健壮性

- spawn 时严格使用 argv 数组形式，**不拼 shell 字符串**
- explain 文本可能含敏感片段，**仅传给本地 Agent CLI，不外发**
- 同一 spec 的 skill-run 复用已有进程，避免并发改写 md 引发损坏

### GUI 改造

#### 选择浮动菜单

新建 `src/gui/src/components/SelectionMenu.tsx` + `src/gui/src/lib/selection.ts`：

- 在 `SpecDetail` 渲染 markdown 的容器 `<article class="markdown" ref={articleRef}>` 上挂监听
- 检测逻辑（`lib/selection.ts`）：
  - 监听 `document.selectionchange`，过滤非折叠 + Range 完全落在 `articleRef` 内的选区
  - 调用 `range.getBoundingClientRect()` 拿到选区矩形，菜单 fixed 定位到矩形右上方（视口溢出时翻转）
  - 选区清空 / 点击菜单外区域 → 隐藏
  - 解析 `sectionPath`：从 `range.startContainer` 向上回溯，找到最近的前置 `h2` / `h3`，读取 `textContent`（skill 改造后已含编号）；找不到时回退为 `"(无章节)"`
- 菜单按钮：
  - `批注`：弹出小型 popover（同样 fixed 定位），含 `textarea` + 「提交」按钮 → `POST /api/specs/:id/inputs { kind: 'annotate', sectionPath, quote, note }` → 关闭 popover；由 SSE `updated` 触发 refetch
  - `解释`：`POST /api/specs/:id/explain { text }` → 拿到 runId → 打开「解释结果」抽屉，订阅 SSE 中匹配该 runId 的 `agent-stdout` 流式渲染；抽屉关闭后丢弃

#### SpecDetail 调整

- **删除**底部「追加批注」表单与相关 state（`note` / `noteError` / `noteBusy`）及 `api.appendNote` 调用
- 顶部 header 右侧新增「运行 Agent」按钮（常驻）：
  - 点击 → `POST /api/specs/:id/run`；按钮根据 SSE 中 `agent-stdout` / `agent-exit` 状态切换 `空闲 / 运行中… / 完成 / 失败`
  - 进入页面时若 service 端有对应 specId 的活跃 skill-run（SSE 补播信号），按钮直接显示为「运行中…」
- 新增「执行日志」折叠面板（默认折叠）：展示 stdout 流，等宽字体，可滚动
- 浮动菜单 + 批注 popover + 解释抽屉挂接到该页面

#### NewSpec 简化

- 字段保留：`type`（三选一 pill，默认 feat） + `content`（textarea，必填，≥ 5 字符）
- 删除：`title` / `summary` / `requirement` 三个独立字段
- 提交逻辑：
  ```ts
  const { id } = await api.createSpec({ type: type(), requirement: content() })
  await api.runAgent(id) // 立即触发 skill-run
  navigate(`/specs/${id}`)
  ```
- 列表 / 详情头部展示策略：使用 frontmatter `summary` + body 首个 `# 标题`；Agent 跑完 plan 之前显示占位「（待 Agent 补全）」

#### api.ts / sse.ts 调整

```ts
createSpec(body: { type: SpecType; requirement: string; title?: string; summary?: string })
// 移除 appendNote
appendAnnotation(id, body: { sectionPath: string; quote: string; note: string })
runAgent(id): Promise<{ runId: string }>
explain(id, text: string): Promise<{ runId: string }>
```

```ts
subscribeSpec(id, {
  onUpdated?: () => void
  onAgentStdout?: (e: { runId: string; mode: 'skill-run' | 'explain'; chunk: string }) => void
  onAgentExit?: (e: { runId: string; mode: string; code: number }) => void
  onAgentError?: (e: { runId: string; mode: string; message: string }) => void
})
```

#### 样式

- 浮动菜单 / 批注 popover：`position: fixed`，圆角阴影，暗色模式兼容；按钮 min 32×32 px（PC），移动端 44×44 px
- 「执行日志」面板：等宽字体，单色背景，可滚动
- 「解释结果」面板：桌面端右侧抽屉（宽 360px），移动端底部抽屉（占视口 40%）

### skill 改造

修改 `.claude/skills/yorz-spec/SKILL.md`：

- 在「Markdown 格式化约定」一节追加规则：
  - **二、三级标题必须带层级编号**：写回 spec 前，遍历 body 的 `## ` / `### ` 标题，按出现顺序重写为：
    - `## N. 标题` （N 从 1 开始）
    - `### N.M 标题` （M 在所属二级下从 1 开始）
  - 已含编号则按当前位置重新编号，保持稳定（避免误把"## 1. 背景"反复变形）
  - 编号与原标题文本之间用单个空格分隔
- 影响范围：仅 skill 文档约束，Agent 在 plan/tasks/execute 任何写回 spec 时都需先做该归一化
- 注：本 spec 当前各级标题尚未编号；本期任务的 plan/tasks 写回也只在 skill 文档完成后由 Agent 后续运行时自动补齐，**当前 spec 不强制本轮就重排标题**

### 测试策略

- **单元**：
  - `tests/spec-store.test.ts` 追加：`appendAnnotation` 写入格式（含 `！！！` 前缀与 sectionPath）、frontmatter `stage` 切回 plan、`updated_at` 更新；`create` 在缺省 title/summary 时使用占位值；旧 `appendNote` 测试用例移除
  - 新建 `tests/agent.test.ts`：mock `child_process.spawn`（用 `node:test` 的 helper 或 vitest `vi.mock`）验证 Runner 的同 specId skill-run 复用、stdout 缓冲补播、kill 行为、resolveAgentCmd 读取 `.yorz/config.json`
- **集成**：
  - `tests/service.test.ts` 调整：
    - 移除 append-note 相关用例
    - 新增：POST `annotate` → spec md 含 `> 2.1 ... 中 "..."` 与 `！！！` 前缀 + SSE `updated`
    - 新增：POST `explain` + fake-claude fixture（`tests/fixtures/fake-claude.js` echo 一段 stdout）→ SSE 收到 `agent-stdout` 与 `agent-exit`
    - 新增：POST `run` 时若已有同 specId 活跃 run，复用同一 runId
- **GUI 手测清单**（构建后通过 `node dist/cli/index.js serve` 端到端）：
  1. 选中正文文本 → 浮动菜单出现在选区右上 → 批注 popover 提交 → spec md 末尾出现引用块 + ！！！
  2. 选中正文文本 → 解释 → 抽屉打开 → 流式追加文本 → 完成后保持显示直到手动关闭
  3. SpecDetail 不再渲染底部追加批注表单
  4. NewSpec 仅 type + content；提交后跳详情且 Agent 按钮显示「运行中…」
  5. 顶部「运行 Agent」按钮：点击 → 状态变更；执行日志面板可展开看 stdout
- **回归**：原 22 个用例去除 append-note 相关 2~3 个后维持通过；新增用例不破坏构建

### 阶段切分（已细化为 tasks）

下方任务清单按依赖顺序排列，可独立验证。

## 待确认问题

- 暂无

## 任务清单

- [x] 修改 `.claude/skills/yorz-spec/SKILL.md`：在「Markdown 格式化约定」追加二、三级标题层级编号规则（`## N. 标题` / `### N.M 标题`），验收点：手工读 skill 文档可见新规则且与既有条目格式一致
- [x] 在 `src/service/agent-config.ts` 新增 `resolveAgentCmd({ cwd })`：读取 `<cwd>/.yorz/config.json` 的 `agent` 字段（默认 `claude`），返回 `{ cmd, args: (prompt) => string[] }`；当前仅实现 claude（`['-p', prompt]`）与 opencode（同 `['-p', prompt]` 占位），验收点：新建 `tests/agent-config.test.ts` 覆盖缺省、显式 claude、显式 opencode、非法值兜底 claude 共 4 个用例通过
- [x] 新增 `src/service/agent.ts` 实现 `AgentRunner`：`run(input)` spawn 进程（stdio: ignore/pipe/pipe）、stdout 写入 ≤64KB 环形 buffer 并 emit、`onExit/onError` 事件、同 specId 的 skill-run 复用已有 handle、explain 不占用 spec lock、`kill()` 调用 `child.kill('SIGTERM')`；验收点：`tests/agent.test.ts` 覆盖 5 个用例（stdout 流 + exit、skill-run 复用、explain 不复用、kill 终止、spawn 失败 emit error）全部通过
- [x] 修改 `src/service/spec-store.ts`：放宽 `create()`（title/summary 可选，缺省占位）、移除 `appendNote()`、新增 `appendAnnotation({ id, sectionPath, quote, note })` 写入 `> {sectionPath} 中 "{quote}"\n>\n> ！！！{note}` 并把 frontmatter stage 切回 plan；验收点：`tests/spec-store.test.ts` 删除旧 append-note 用例并新增 3 个用例（annotation 格式、stage 回退、create 占位）全部通过
- [x] 修改 `src/service/routes/specs.ts`：`POST /api/specs` title/summary 可选；`POST /api/specs/:id/inputs` 仅接受 `kind: 'annotate'`（含 sectionPath/quote/note 校验，长度上限 200/2000/2000），不再接受 `append-note`；新增 `POST /api/specs/:id/run`（返回 `{runId}`，复用同 specId 活跃 run）与 `POST /api/specs/:id/explain`（校验 `text` ≤4000，返回 `{runId}`）；验收点：路由级集成测试覆盖每条新行为
- [x] 修改 `src/service/routes/events.ts` + `src/service/server.ts` + `src/service/index.ts`：在 createApp 注入 `AgentRunner` 实例；SSE 订阅端订阅 watcher + AgentRunner，连接建立时为存在的活跃 run 补播 `buffer()`；下推 `agent-stdout` / `agent-exit` / `agent-error` 三类事件，data 含 `{runId, mode, specId, ...}`；验收点：`tests/service.test.ts` 新增「POST run + fake-claude fixture → SSE 依次收到 stdout/exit」用例通过
- [x] 新增 `tests/fixtures/fake-claude.js`：可执行脚本（shebang `#!/usr/bin/env node`），读取 argv 中的 `-p <prompt>`，stdout 分 3 次 echo `received prompt`/`<prompt>`/`done` 然后 0 退出；`resolveAgentCmd` 已暴露 `YORZ_AGENT_CMD` 钩子；验收点：`node tests/fixtures/fake-claude.js -p hi` 输出 3 段
- [x] 修改 `src/gui/src/lib/api.ts`：移除 `appendNote`；`createSpec` 入参 title/summary 改为可选；新增 `appendAnnotation(id, {sectionPath, quote, note})`、`runAgent(id)`、`explain(id, text)` 三个方法；验收点：`pnpm build:gui` 编译通过，类型签名与 service routes 对齐
- [x] 修改 `src/gui/src/lib/sse.ts`：`subscribeSpec(id, handlers)` 接受 `{onUpdated, onAgentStdout, onAgentExit, onAgentError}`，内部用 `addEventListener` 注册 4 类事件并将 data JSON.parse 后传回；验收点：编译通过且 `subscribeSpec` 返回的 unsub 能解除全部监听
- [x] 新增 `src/gui/src/lib/selection.ts`：导出 `observeSelection(container, onChange)`，监听 `document.selectionchange` 节流 50ms 后判定选区是否在 container 内，命中则回调 `{ rect, text, sectionPath }`（sectionPath 通过向上回溯到最近 h2/h3 textContent 解析），未命中传 null；验收点：手测在 SpecDetail 任选文本能拿到正确 sectionPath
- [x] 新增 `src/gui/src/components/SelectionMenu.tsx`：根据 `observeSelection` 的回调 fixed 定位浮动菜单（含视口溢出翻转），渲染「批注」「解释」两个按钮，分别触发 `onAnnotate(selection)` / `onExplain(selection)` props；验收点：在 SpecDetail 中能拖选文本看到菜单按钮，按钮区域点击不会清空选区（mousedown preventDefault）
- [x] 新增 `src/gui/src/components/AnnotatePopover.tsx`：fixed 浮动 popover，含 `<textarea>` + 「提交」/「取消」按钮，提交时调用 `api.appendAnnotation`，关闭后清空状态；验收点：批注提交后 spec md 末尾出现约定格式 + ！！！，SSE 触发详情自动刷新
- [x] 新增 `src/gui/src/components/ExplainDrawer.tsx`：根据 `runId` 订阅 SSE 中匹配的 `agent-stdout` 流式追加到 `<pre>` 区域，`agent-exit` 后显示「完成」状态，桌面端右抽屉（宽 360px）、移动端底抽屉（视口 40%）；验收点：触发解释后抽屉内能看到流式输出且关闭后不持久化
- [x] 修改 `src/gui/src/pages/SpecDetail.tsx`：移除底部「追加批注」表单与 state；顶部 header 右侧加「运行 Agent」按钮（状态机：空闲/运行中/完成/失败），点击调用 `api.runAgent`；挂载 SelectionMenu/AnnotatePopover/ExplainDrawer；新增「执行日志」折叠面板订阅 SSE agent-stdout；验收点：详情页无底部表单，按钮可触发 Agent 并展示日志，选中文本可批注/解释
- [x] 修改 `src/gui/src/pages/NewSpec.tsx`：删除 title/summary/requirement 字段与校验，仅保留 type pill + content textarea（必填 ≥5 字符）；提交流程：`createSpec({type, requirement: content})` → `runAgent(id)` → `navigate('/specs/'+id)`；验收点：表单仅 2 个可见字段，提交后跳转详情页且 Agent 按钮显示「运行中…」
- [x] 修改 `src/gui/src/pages/Home.tsx`（如需）与样式 `src/gui/src/styles.css`：列表项 summary/标题为空时显示「（待 Agent 补全）」占位；新增浮动菜单/popover/抽屉/运行按钮/执行日志相关 CSS（暗色模式兼容）；验收点：手测各组件视觉无破坏、暗色模式可读
- [x] 运行 `pnpm test` 全部通过；运行 `pnpm build` 产出 `dist/cli/index.js` + `dist/gui/index.html` + `dist/gui/assets/*` + `dist/skill/SKILL.md`；启动 `node dist/cli/index.js serve --port 17424`，手动验证「测试策略 GUI 手测清单」全部 5 项通过
- [x] 运行 `npx prettier --write` 对所有改动文件做格式化，确认无未提交格式差异

## 执行记录

- 2026-06-16 任务 1：在 `src/skill/SKILL.md` 与 `.claude/skills/yorz-spec/SKILL.md` 的「Markdown 格式化约定」一节追加二、三级标题层级编号规则（`## N. 标题` / `### N.M 标题`，含已编号重排、复位、不影响 frontmatter/一级标题）；prettier 格式化通过；两份文件 diff 为空
- 2026-06-16 任务 2：新增 `src/service/agent-config.ts`（`resolveAgentCmd` 读取 `.yorz/config.json` 的 `agent` 字段，默认/未知值兜底 claude；额外暴露 `YORZ_AGENT_CMD` 环境变量钩子供测试切换二进制路径）；`tests/agent-config.test.ts` 5 个用例（默认 / claude / opencode / 非法值兜底 / env override）全部通过
- 2026-06-16 任务 3：新增 `src/service/agent.ts`（`AgentRunner` 含 64KB 环形 buffer、`onStdout/onExit/onError`、同 specId 的 skill-run 复用、explain 不复用、`kill()` 触发 SIGTERM、spawn `error` 同步映射到 `exit` 防 Promise 悬挂）；`tests/agent.test.ts` 5 个用例（stdout 流 + 退出码、skill-run 复用、explain 并发、kill 终止、不存在二进制 emit error）全部通过；累计 `tests/` 下 32 个用例 0 失败
- 2026-06-16 任务 7：新增 `tests/fixtures/fake-claude.js`（chmod +x，分 3 次 echo `received prompt / <prompt> / done`），可独立运行 `node tests/fixtures/fake-claude.js -p hi` 输出 3 段；已被任务 3 的测试间接用作 agent 替身
- 2026-06-16 任务 4：`src/service/spec-store.ts` 放宽 `create` 必填（title/summary 缺省时分别取 requirement 首行 ≤30 字符与首段 ≤200 字符占位，全缺省落到「（待 Agent 补全）」）；删除 `appendNote`；新增 `appendAnnotation({id, sectionPath, quote, note})` 写入 `> <sectionPath> 中 "<quote>"\n>\n> ！！！<note>` 并把 frontmatter stage 强制切回 plan；`tests/spec-store.test.ts` 重写为 9 个用例（含 annotate 格式 / stage 回退 / 必填校验 / 占位回退）全部通过
- 2026-06-16 任务 5：`src/service/routes/specs.ts` 注入 `runner` 依赖；`POST /api/specs` title/summary 可选；`POST /api/specs/:id/inputs` 仅接受 `kind: 'annotate'`（校验 sectionPath/quote/note 非空 + 长度上限）；新增 `POST /api/specs/:id/run`（构造 `请使用 yorz-spec skill 处理 spec：...` 提示词、复用同 specId 活跃 skill-run）、`POST /api/specs/:id/explain`（text ≤4000，prompt 含明确「不要修改任何文件」约束）；返回均含 `{runId}`
- 2026-06-16 任务 6：`src/service/agent.ts` 追加 `subscribe(specId, cb)` 监听未来 run 句柄；`src/service/routes/events.ts` 改造为既订阅 watcher 又订阅 runner：连接建立时 backfill `runner.active(id)` 的 buffer，新 run 触发 attachAgent；下推 `agent-stdout`/`agent-exit`/`agent-error` 三类事件并补播历史 buffer；`server.ts` 与 `index.ts` 注入 `AgentRunner` 单例；`tests/service.test.ts` 重写为 9 个用例（含 placeholder create / annotate / run+SSE / explain+SSE / 400 校验）；`pnpm test` 累计 40 个用例 0 失败
- 2026-06-16 任务 8：`src/gui/src/lib/api.ts` 移除 `appendNote`；`createSpec` 入参 title/summary 改为可选；新增 `appendAnnotation` / `runAgent` / `explain` 三个方法，请求体与 service 路由签名对齐
- 2026-06-16 任务 9：`src/gui/src/lib/sse.ts` 扩展为 `subscribeSpec(id, handlers)`，handlers 含 `onUpdated/onAgentStdout/onAgentExit/onAgentError`，内部 `addEventListener` 注册四类事件 + 对 data 做 JSON.parse 容错；返回 unsub 解除全部监听并 `source.close()`
- 2026-06-16 任务 10：新增 `src/gui/src/lib/selection.ts` `observeSelection(container, cb)`：监听 `document.selectionchange`，节流 50ms，过滤非折叠 + Range 完全落在 container 内的选区，回调 `{text, rect, sectionPath}`；sectionPath 通过自定义的 DOM 反向遍历找到最近的 h2/h3 textContent（已含 skill 加的层级编号）
- 2026-06-16 任务 11：新增 `src/gui/src/components/SelectionMenu.tsx` 浮动菜单：按 selection rect 计算 fixed 位置（顶部空间不足时翻转到选区下方，左右边界裁剪），渲染「批注」「解释」两个按钮；`onMouseDown={e => e.preventDefault()}` 阻止点击时取消选区
- 2026-06-16 任务 12：新增 `src/gui/src/components/AnnotatePopover.tsx` 弹窗：fixed 定位（选区下方 8px），含引用预览 blockquote + textarea + 提交/取消按钮；提交时调用传入的 `onSubmit(note)`（实际由 SpecDetail 桥接到 `api.appendAnnotation`）；本地维护 busy/error 状态
- 2026-06-16 任务 13：新增 `src/gui/src/components/ExplainDrawer.tsx` 抽屉：桌面右侧 360px、移动端底部 40vh（media query）；header 含状态徽标（pending/streaming/done/failed）+ 关闭按钮；body 用 `<pre>` 渲染流式 stdout；点击 backdrop 也关闭
- 2026-06-16 任务 14：`src/gui/src/pages/SpecDetail.tsx` 重写：移除底部 append-note 表单与 state；header 增 stage badge + 「运行 Agent」按钮（四态：idle/running/done/failed）；`observeSelection` 挂到 `article ref`；按钮点击 → `api.runAgent` → SSE `agent-stdout` 累加到 `log()` 并切到 running，`agent-exit` 切到 done/failed；新增「执行日志」折叠面板；选中文本时弹 SelectionMenu，批注走 AnnotatePopover，解释走 ExplainDrawer；title/summary 空时回退「（待 Agent 补全）」
- 2026-06-16 任务 15：`src/gui/src/pages/NewSpec.tsx` 重写：仅保留 `type` 三选 pill + `content` textarea（≥5 字符校验）；提交时 `createSpec({type, requirement: content})` → 立即 `runAgent(id)`（失败仅 console.warn 不阻塞导航）→ 跳转详情页
- 2026-06-16 任务 16：`src/gui/src/pages/Home.tsx` 列表项 title/summary 空时回退「（待 Agent 补全）」；`src/gui/src/styles.css` 追加 selection-menu / annotate-popover / explain-drawer / run-btn / run-log 五组样式，含移动端 max-width 720px 媒体查询切换抽屉布局；暗色模式沿用现有 CSS 变量
- 2026-06-16 任务 17：`pnpm test` 6 个测试文件 40 个用例 0 失败；`pnpm build` 产出 `dist/cli/index.js`（40.29 kB） + `dist/gui/index.html` + `dist/gui/assets/index-*.js`（155.08 kB）/ `index-*.css`（8.14 kB） + `dist/skill/SKILL.md`；启动 `node dist/cli/index.js serve --port 17424`：`curl /` 返回 GUI HTML、`POST /api/specs {type,requirement}` 占位字段创建成功、`POST /api/specs/:id/inputs annotate` 写入 `> 1. 背景 中 "..."\n>\n> ！！！...` 并切回 plan、`GET /api/specs/:id` frontmatter `last_action: 用户新增批注 ！！！` 正确
- 2026-06-16 任务 18：`npx prettier --write` 覆盖 `src/**/*.{ts,tsx,md,css}` + `tests/**/*.ts`，14 文件被规整为统一缩进/换行；spec md 自身已按 frontmatter 规范保留

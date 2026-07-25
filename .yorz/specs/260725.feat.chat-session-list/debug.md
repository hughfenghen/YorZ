---
status: resolved
active:
updated_at: '2026-07-25 16:40:09'
---

## Debug 1 · RadioGroup 选中态与非选中态差异不明显

- 状态：resolved
- 快照：892b6cfc95b3acfd2b548387af8964dabfd67c7b
- 进入时间：'2026-07-25 16:21:29'

### 1. Bug 现象与复现

现象：`@src/gui/src/components/ui/radio-group.tsx` 的 radio 选中态与非选中态 UI 差异不明显。当前上下文中的触发位置是 ChatPanel 会话列表 header 右侧的 3/5/10 radio 组。

复现路径：

1. 打开包含 ChatPanel 的 GUI 页面。
2. 展开 Chat 面板中的会话列表。
3. 观察 3/5/10 radio 组的选中项与未选中项差异。

### 2. 关联链路分析

- `src/gui/src/components/ui/radio-group.tsx` 定义全局 `RadioGroupItemControl` 视觉状态。
- `src/gui/src/components/ChatPanel.tsx` 使用 `RadioGroupItemInput` / `RadioGroupItemControl` / `RadioGroupItemLabel` 组合渲染 3/5/10 radio。
- 选中态依赖 Kobalte 在 `ItemControl` / `ItemIndicator` 上注入的 `data-[checked]` 状态类。

### 3. Debug 基线

- 快照 SHA：`892b6cfc95b3acfd2b548387af8964dabfd67c7b`
- 进入时间：`2026-07-25 16:21:29`
- 退出闸门：`git diff 892b6cfc95b3acfd2b548387af8964dabfd67c7b` 只能剩合法修复，不能包含未登记脚手架。

### 4. 假设看板

- H1：原始 radio 控件未选中态也使用 `border-primary`，导致选中态和非选中态共享高强调边框；在小尺寸 `h-3 w-3` 场景里，仅靠内部小圆点/背景变化不够明显。
  - 若成立：源码可见未选中态为 `border-primary`，选中态没有改变边框颜色；修复应改为未选中 `border-input bg-background`，选中 `border-primary bg-primary` 并增加轻量 ring。
  - 若不成立：源码已存在明显的未选中/选中边框、背景、ring 差异，则问题应转向 ChatPanel 尺寸压缩或主题色本身。

### 5. 证据

- 取证 1：`git show HEAD:src/gui/src/components/ui/radio-group.tsx` 显示原始 `RadioGroupItemControl` 未选中态就使用 `border-primary`，选中态只增加 `data-[checked]:bg-foreground`；内部 indicator 使用 `data-[checked]:bg-background`。这说明选中与非选中共享同一高强调边框，H1 成立。
- 取证 2：当前工作区 `src/gui/src/components/ui/radio-group.tsx` 已调整为未选中 `border-input bg-background`，选中 `data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:ring-2 data-[checked]:ring-primary/20`，内部点为 `bg-primary-foreground`。状态差异从“仅背景/小圆点变化”扩大为“边框 + 背景 + ring + 内部点”四处变化。
- 验证 1：`pnpm run typecheck` 通过，说明组件类型和导出使用关系正常。
- 验证 2：`pnpm run build:gui` 通过，说明 Tailwind 类和 GUI 构建链路可生成。
- 退出闸门：`git diff 892b6cfc95b3acfd2b548387af8964dabfd67c7b` 对 tracked 文件无输出；Debug 期间没有引入未登记脚手架或额外 tracked 污染。

### 6. 脚手架清单

_暂无_

### 7. 收尾核对

- [x] 根因确认：未选中态使用 `border-primary`，选中态缺少边框/ring 差异。
- [x] 修复验证：当前工作区 radio 样式已改为未选中低强调、选中 primary 填充与 ring。
- [x] 脚手架清理：无临时日志、Mock、短路、临时页面。
- [x] 退出闸门：`git diff 892b6cfc95b3acfd2b548387af8964dabfd67c7b` 对 tracked 文件无输出。
- [x] 完整性检查：`pnpm run typecheck`、`pnpm run build:gui` 通过。

## Debug 2 · GUI Chat 新会话发送 hello 后仍显示未命名会话

- 状态：resolved
- 快照：45ae6ca4bca2b6714abb128235988211037c4cb8
- 进入时间：'2026-07-25 16:33:38'

### 1. Bug 现象与复现

现象：在 Codex CLI 中发送 `hello` 后，CLI 的 Thread name 显示为 `hello`；但在 GUI Chat 中发送 `hello` 后，会话名称仍显示为“未命名会话”，未按期望显示总结性名称字符串。

复现路径：

1. 使用 Codex CLI 创建会话并发送 `hello`，观察 `/resume` 或 thread name 显示为 `hello`。
2. 在 GUI Chat 中新建/使用草稿会话并发送 `hello`。
3. 观察 ChatPanel 会话列表中该会话名称显示为“未命名会话”。

### 2. 关联链路分析

- GUI Chat 发起消息后由 `ChatPanel` 调用会话接口创建/续接 session。
- `SessionManager.createSession()` 负责写入本地 `.yorz/tmp/sessions/index.json` 索引。
- Codex 会话由 `CodexAdapter` 通过 `@openai/codex-sdk` 启动，并从 Codex 原生历史、rollout JSONL、`~/.codex/session_index.jsonl` 提取标题。
- `SessionManager.listSessions()` 合并本地索引与 adapter 原生历史后返回给前端。
- `ChatPanel.displaySessionTitle()` 对空标题或等于 id 的标题显示 i18n untitled 兜底。

### 3. Debug 基线

- 快照 SHA：`45ae6ca4bca2b6714abb128235988211037c4cb8`
- 进入时间：`2026-07-25 16:33:38`
- 退出闸门：`git diff 45ae6ca4bca2b6714abb128235988211037c4cb8` 只能剩合法修复，不能包含未登记脚手架。

### 4. 假设看板

- H1：GUI 首轮发送消息时，`ChatPanel` 在后台创建了新的服务端 session，但前端仍保留/选中原草稿 session；列表当前项来自本地草稿索引，没有映射到 Codex adapter 的真实 thread id，因此 adapter 提取出的 `hello` 标题无法覆盖 UI 当前会话。
  - 若成立：代码中可见发送首条消息后会话 id 从 draft id 切换到 backend/agent id 的逻辑缺失，或 `currentSessionId` 没有更新；测试可模拟首次发送后列表仍含空标题 draft。
  - 若不成立：发送首条消息后已有真实 Codex thread id 进入 `sessions` 并被选中，则应转向标题提取或合并策略。
- H2：`CodexAdapter.readMeta()` 的 rollout 解析没有兼容 GUI 通过 SDK 写入的 user message 结构，导致首条真实 prompt 摘要为空。
  - 若成立：用实际/夹具中的 GUI rollout 结构调用标题提取会得到空标题，而扩展解析后可得到 `hello`。
  - 若不成立：单测或本机 rollout 解析能得到 `hello`，问题不在 adapter 摘要提取。
- H3：`SessionManager.listSessions()` 合并策略把空标题/“未命名会话”本地索引当作可读标题，阻止 adapter 的 `hello` 覆盖。
  - 若成立：合并代码或测试显示索引标题为 untitled/空占位时不会被 native readable title 替换。
  - 若不成立：合并策略已正确让 native readable title 覆盖不透明标题。

### 5. 证据

- 取证 1：`~/.codex/session_index.jsonl` 最近记录中没有本次 GUI `hello` 会话的 `thread_name`，说明 GUI SDK 创建的会话不能依赖 CLI `/resume` 使用的 session index 立即提供标题。
- 取证 2：本机真实 rollout `/Users/fenghen/.codex/sessions/2026/07/25/rollout-2026-07-25T16-15-39-019f9858-1fa6-7550-b514-7de5300c3a0b.jsonl` 中，`session_meta.cwd` 为当前项目，且第 7 条记录是 `role=user`、文本为 `hello`。这证伪 H2 的“rollout 没有真实 prompt”大方向；adapter 有数据可提取。
- 取证 3：`.yorz/tmp/sessions/index.json` 中同一会话 `019f9858-1fa6-7550-b514-7de5300c3a0b` 的本地索引标题为另一个 UUID：`d51b5e6c-19ce-420a-8a1a-bc46dbbfd767`。GUI 的 `displaySessionTitle()` 会把 UUID 标题显示成“未命名会话”，因此用户看到的现象来自本地索引标题先行占位。
- 取证 4：`SessionManager.send()` 修复前不会用首条用户 prompt 更新空/UUID 本地标题，只依赖后续 adapter 列表扫描和 refetch 时序；这让 GUI 首发后存在持续显示“未命名会话”的窗口。
- 根因确认：H1 部分成立，问题不是前端未切到真实 thread id，而是首次发送后本地索引标题没有同步由 prompt 生成，且 UUID 判断没有覆盖 UUIDv7/Codex id 形态。H2 被证伪。H3 部分成立，旧索引中的 UUID 标题需要被视为不透明标题并允许 native/prompt 标题覆盖。
- 修复 1：`src/service/session-manager.ts` 新增 prompt 标题摘要逻辑，在 `send()` 开始时若索引标题为空、等于 id 或 UUID 形态，则用真实 prompt 写回标题；Codex provisional id reconcile 后保留该标题。
- 修复 2：`SessionManager.send()` 改为 async，各 HTTP 路由在返回 202 前等待标题索引写入完成，消除前端 `api.sendSessionMessage()` 后立即 `refetchSessions()` 仍读到旧标题的竞争窗口。
- 修复 3：`src/service/session-manager.ts` 与 `src/gui/src/components/ChatPanel.tsx` 的 UUID 判断放宽为 UUID-like，覆盖 UUIDv7/Codex id。
- 回归测试 1：`src/service/__tests__/session-manager.test.ts` 覆盖 UUIDv7-looking 本地标题被 native `hello` 覆盖。
- 回归测试 2：`src/service/__tests__/session-manager.test.ts` 覆盖 untitled draft 首发 `hello` 后，真实 Codex id 的 store 标题为 `hello`。
- 回归测试 3：`src/service/__tests__/codex-adapter.test.ts` 覆盖没有 `session_index.thread_name` 时从真实 user prompt `hello` 生成标题。
- 验证通过：`pnpm vitest run src/service/__tests__/codex-adapter.test.ts src/service/__tests__/session-manager.test.ts`。
- 验证通过：`pnpm run typecheck`。
- 验证通过：`pnpm test`（40 个测试文件，345 个测试通过）。
- 退出闸门：`git diff 45ae6ca4bca2b6714abb128235988211037c4cb8 --stat` 显示本次 Debug 的 tracked 变更集中在 `SessionManager`、相关路由调用点、`ChatPanel` UUID 判断和 `session-manager` 测试；`src/service/__tests__/codex-adapter.test.ts` 是进入前已有未跟踪测试文件，本次在其中追加合法回归用例。

### 6. 脚手架清单

_暂无_

### 7. 收尾核对

- [x] 根因确认：本地索引标题没有在首发 prompt 后同步更新，且 UUID 判断未覆盖 UUIDv7/Codex id。
- [x] 修复验证：新增首发 prompt 写回标题，UUID-like 标题作为不透明标题处理。
- [x] 脚手架清理：无临时日志、Mock、短路、临时页面。
- [x] 退出闸门：基于 `45ae6ca4bca2b6714abb128235988211037c4cb8` 的 diff 只剩合法修复。
- [x] 完整性检查：相关 vitest、`pnpm run typecheck`、`pnpm test` 通过。

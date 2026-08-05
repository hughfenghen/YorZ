# Review · 260804.fix.worktree-session-pollution

## 2026-08-04 10:30:33

### 变更总结

本次变更实现了 spec `260804.fix.worktree-session-pollution` 的两项修复，与 spec 技术方案 4.1 / 4.3 节描述行级匹配：

1. **核心修复**：`ClaudeAdapter.listSessions()` 显式传入 `includeWorktrees: false`，关闭 Claude Agent SDK 默认的 worktree 会话聚合行为，使主项目会话列表不再泄漏 worktree 会话（`claude-adapter.ts` 第 147 行）。
2. **次要修复**：`NewSpec.tsx` 中新增 `pendingSessionId` 变量，将 `requestChatSession` 调用从 `submit()` 推迟到 `pollForNewSpec` 导航成功后执行，避免 worktree 新建 spec 时 ChatPanel 仍绑定主项目导致跨项目加载会话消息。

### 影响范围

- **ClaudeAdapter.listSessions()**：行为变更（🔴 breaking），主项目不再返回 worktree 会话，worktree 不再返回主项目会话。CodexAdapter / OpenCodeAdapter 不受影响（原本就严格按 cwd 过滤）。
- **NewSpec.submit() / pollForNewSpec()**：时序调整（🟡 affected），仅影响 worktree 新建 spec 时的 ChatPanel 切换时序，不影响功能正确性。
- **SessionManager / SessionStore**：无需改动，索引层 `.yorz/tmp/sessions/index.json` 本来就按项目隔离。
- **getSessionMessages**：无需改动，修复后 worktree 会话不再出现在主项目列表中，不会触发跨项目调用。

### 风险提醒

1. **工作区存在与本 spec 无关的未提交变更**：`.yorz/config.json`（`agent.kind` 从 `codex` 改为 `inherit`）、`pnpm-lock.yaml`（大规模变更 1263 行）、`pnpm-workspace.yaml`（新增 untracked 文件）。这些变更不属于本 spec 范围，后续 git commit 时需注意区分，避免混入本次提交。
2. **SDK `includeWorktrees` 选项依赖**：修复依赖 `@anthropic-ai/claude-agent-sdk` 提供 `includeWorktrees` 选项。若 SDK 版本降级至不支持该选项的版本，需确认 fallback 行为。
3. **行为变更对存量用户的影响**：此前依赖主项目列表能看到 worktree 会话的用户会注意到会话消失。但按 spec 分析，这是设计意图修正——worktree 已注册为独立项目，其会话应在 worktree 项目页面查看。

### 变更文件清单

- src/service/agent-sdk/claude-adapter.ts
- src/gui/src/pages/NewSpec.tsx

# Review · 260630.refct.agent-driven-review-workflow

## 2026-06-30 22:14:36

### 变更总结

按 spec 完成「spec review 工作流」重构，整体把"基于 touched-files 的被动 review/commit"替换为"Agent 主动驱动的结构化 review + git ops"：

- 服务端：`AgentMode` 扩展为 `'skill-run' | 'explain' | 'review' | 'git-ops'`，新增 `GitOpsAction = 'commit' | 'discard' | 'stash'`；`RunAgentInput` / `AgentRunHandle` / `ActiveRunInfo` / `AgentLogMeta` 透传 `action`。删除 `WRITE_TOOL_NAMES`、`emitTouchedFromEvent`、`file_touched` 事件链路、`TouchedFilesStore` 整个模块（含 `project-registry` 注入与 `AgentRunner.touched` 选项）以及 `routes/specs.ts` 中 `GET /changes`、`POST /commit` 两个 handler 与 `ensureSpecAnchor` / `parseCommitBody` helper。
- 新增 `src/service/routes/spec-review.ts`，导出 `createSpecReviewRoutes`，挂载 `POST /review`、`POST /git`、`GET /review` 三个接口；`POST /git` 校验 `action ∈ {commit, discard, stash}`，否则 400；`server.ts` 注册新路由。
- 新增 skill 子文档 `src/skill/yorz-spec/review.md`，并在 `SKILL.md` 列表追加第 7 条引用、`index.json` 同步登记 review 模块；明确 `review.md` 追加规则、4 节固定标题、git 操作白名单（仅 `add/commit/restore/clean/stash`）与禁令（`push` / `reset --hard` / `rebase`）。
- GUI：`SpecReview.tsx` 整体重写为「按钮区（刷新 / 提交 / 丢弃[`confirm`] / 暂存）+ 主区 Markdown 渲染 review.md」，复用 `renderMarkdown` 与 `agentTasks.start` 注册 dock 进度；右上角展示最近一次 review 时间。`api.ts` 删除 `listSpecChanges` / `commitSpecChanges` / `GitChange` / `CommitBody`，新增 `triggerReview` / `gitOp` / `getReview`，`AgentLogMeta` 扩展 `mode` 与可选 `action`；`sse.ts` 同步类型。`SpecAgentLogs.tsx` 新增 `agentTagLabel` / `modeClassName`，按 `(mode, action)` 渲染 `Run / Explain / Review / GitCommit / GitDiscard / GitStash`，并保留 `mode-${mode}` / `mode-${mode}-${action}` CSS 类名。`styles.css` 新增对应色块与 `.review-actions` / `.review-body` 布局，移除已废弃的 `.review-changes` / `.review-commit` / `.change-list` 样式。
- 测试：新增 `src/service/__tests__/spec-review.test.ts`（9 个场景）；删除 `touched-files.test.ts`；`agent.test.ts` / `service.test.ts` 删除所有 touched / commit 相关用例。

### 影响范围

- **后端 API 不兼容变更**：`GET /projects/:pid/specs/:id/changes`、`POST /projects/:pid/specs/:id/commit` 两个接口已下线；任何外部脚本或 GUI 旧版本调用都会 404。新增 `POST /review`、`POST /git`、`GET /review`。
- **agent-logs 数据结构**：`AgentLogMeta` 新增可选 `action` 字段，磁盘上既有的旧日志 JSON 仍兼容（字段缺省视为旧模式）。
- **GUI Review 页**：路由 `review-link` 入口保持不变，但页面交互完全重写——旧的 commit message textarea / 变更文件列表已移除；用户操作改为 4 个按钮。
- **agent-log 标签 UI**：所有 mode 标签从原始字符串改为 PascalCase 友好标签，CSS 选择器从 `.mode-skill-run` / `.mode-explain` 扩展到 `.mode-review` / `.mode-git-ops` / `.mode-git-ops-commit` 等。
- **commit message 约定**：commit 不再由 service 自动追加 `[spec:<id>]` 锚点；改由 Agent 基于 review 报告生成 message，且按 `260630.refct.review-commit-msg-remove-scope` 不带 scope。任何依赖 `[spec:<id>]` 文本搜索的工具会失效。
- **磁盘历史数据**：既存 `touched-files.json` 保留不动（已确认不主动清理），不再有写入逻辑——文件成为只读历史归档。
- **skill 升级**：`yorz-spec` 现在多承担一种"无状态机"模式（review / git-ops 不写 frontmatter.stage），CLI install 拷贝路径不变。

### 风险提醒

- **review.md 格式 100% 依赖 Agent 遵守**：service 端只读取文本、不解析结构。若 Agent 偶尔输出不规范（缺三级小节、时间格式错位、覆盖历史等），用户层不会立刻报错，长期可能让 `lastReviewTime` 解析失败或破坏文档可读性。建议未来在 service 端补一个轻量校验（至少校验"是否新增了一个 `## YYYY-MM-DD HH:mm:ss` 标题"）。
- **discard 失去服务端二次校验**：spec 明确把"丢弃"二次确认下放到 GUI `window.confirm`，service 端不再校验 `confirmed` 字段。任何绕过 GUI 直接 `POST /git {action:'discard'}` 的调用都会立即生效；当前服务对内网/本机暴露尚可接受，但若未来 GUI 上加远程访问/分享 review 链接，需要重新评估。
- **4 个动作无并发去重**：spec 明确"不限并发，每次分配独立 runId"。对同一 spec 反复点击"提交"会启动多个 Agent，可能在 git 上互相竞争（多个 `git add`/`git commit` 串行也会产生空提交或冲突）。建议在 GUI 侧对同 spec 同 action 做按钮节流（spec 未要求，作为后续优化项记录）。
- **未追加 `[spec:<id>]` 锚点**：失去机器可查找的 spec→commit 关联。若团队依赖 `git log --grep '[spec:'` 做溯源，需要事先沟通；建议补充 release notes / CHANGELOG 段落说明。
- **review.md 文件单调增长**：每次 review 都追加新二级标题，无清理 / 滚动机制。长生命周期 spec（数月内多次 review）会让 `review.md` 变得很长；当前 GUI 一次性渲染全文，未来可能需要"仅显示最近 N 条"或折叠历史。
- **GUI 体验细节**：`trigger('review')` 之后用 `setTimeout(..., 1500)` 触发 refresh，假设 Agent 在 1.5s 内写完 review.md。短时间 Agent 写完时间可能略多于 1.5s，会出现"列表还是旧内容"的瞬时不一致；用户需要再次手动刷新页面或等 dock 任务完成。建议后续改为订阅 agent-tasks 完成事件再 refresh。
- **类型预存告警**：spec 执行记录提到 `QuestionConfirmPanel.tsx` 中 `note` 重复键告警是预先存在、与本次无关；本次未顺手修复，留作独立任务。
- **测试覆盖偏轻**：`spec-review.test.ts` 主要覆盖路由参数校验与 Runner 调用，没有端到端验证 Agent 真的写出合规 review.md（受限于 e2e 成本可接受）；首次正式 review 应人工抽检产物。

### 变更文件清单

- .yorz/specs/260630.refct.agent-driven-review-workflow/spec.md （新增 spec，本次需求源）
- src/service/agent.ts （AgentMode/GitOpsAction 扩展，删除 touched 链路）
- src/service/agent-log-store.ts （meta.action 透传与落盘）
- src/service/project-registry.ts （删除 TouchedFilesStore 注入）
- src/service/routes/specs.ts （删除 /changes、/commit 与相关 helper）
- src/service/routes/spec-review.ts （新增三接口）
- src/service/server.ts （注册 spec-review 路由）
- src/service/touched-files.ts （删除）
- src/service/__tests__/agent.test.ts （删除 touched 用例）
- src/service/__tests__/service.test.ts （删除 commit/changes 用例）
- src/service/__tests__/touched-files.test.ts （删除文件）
- src/service/__tests__/spec-review.test.ts （新增）
- src/gui/src/lib/api.ts （删除 listSpecChanges/commitSpecChanges，新增 triggerReview/gitOp/getReview）
- src/gui/src/lib/sse.ts （AgentMode/GitOpsAction 类型扩展）
- src/gui/src/pages/SpecReview.tsx （整体重写）
- src/gui/src/pages/SpecAgentLogs.tsx （agentTagLabel / modeClassName 标签渲染）
- src/gui/src/styles.css （新色块 / 新布局 / 移除废弃样式）
- src/skill/yorz-spec/SKILL.md （列表追加第 7 条引用）
- src/skill/yorz-spec/index.json （登记 review 模块）
- src/skill/yorz-spec/review.md （新增 skill 子文档）
- TODO.md （同步任务进展）
- .yorz/specs/260630.refct.auto-execute-after-questions-cleared/spec.md （顺带的相关 spec 状态更新）

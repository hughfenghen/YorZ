# Windows 兼容与跨平台稳定性 TODO

> 更新时间：2026-07-28
>
> 当前修复分支：`codex/fix/windows-compatibility`

## 1. 文档目标

汇总本轮仓库分析与 Windows 弹窗问题排查中发现的兼容性、安全性和工程保障问题，作为后续修复清单。

状态说明：

- `[x]`：已在当前分支完成并通过定向验证，但尚未提交或发布。
- `[ ]`：尚未实现。
- `待决策`：实现前需要确认产品或兼容策略，不能直接替用户选择。

本清单遵循以下边界：

- Windows 修复不能改变 macOS/Linux 的既有命令、参数、输入输出和生命周期。
- 不使用全局 `shell: true` 解决 Windows shim 问题。
- 不为了兼容性改造无关业务功能。
- 每项修复都必须包含对应平台的回归验证。

## 2. 当前分支已完成

### 2.1 Windows 后台进程反复弹出 cmd

- [x] 确认主根因：Review 页面订阅 Git changes 后，Service 每 1000ms 执行一次 `git status`；原实现未设置 `windowsHide`。
- [x] 新增跨平台子进程封装：
  - Windows：注入 `windowsHide: true`。
  - macOS/Linux：原样返回调用方选项，不改变既有行为。
- [x] Git 轮询和 Git 操作统一使用隐藏的非交互式子进程。
- [x] 后台 Service 的 detached Node 子进程在 Windows 下隐藏控制台。
- [x] Agent 测试 runner 使用相同的隐藏控制台策略。

关联位置：

- `@src/service/process.ts`
- `@src/service/git.ts`
- `@src/service/events-hub.ts`
- `@src/cli/serve.ts`
- `@src/skill/yorz-spec/__tests__/runner.ts`

验收记录：

- `process.test.ts`、`git.test.ts`、`serve.test.ts`、`service.test.ts` 共 32 个定向测试通过。
- Windows 后台 Service 启动、Review changes SSE 订阅保持 5 秒、Service 停止流程通过。

### 2.2 Windows 浏览器启动

- [x] 移除 Windows 下不可直接执行的 shell 内建命令 `start`。
- [x] Windows 使用原生 `explorer.exe` 打开默认浏览器。
- [x] macOS 继续使用 `open`，Linux 继续使用 `xdg-open`。
- [x] 处理 `spawn` 的异步错误事件，浏览器打开失败不再影响 Service。

关联位置：

- `@src/service/index.ts`
- `@src/service/process.ts`

### 2.3 Windows `test:agent` 无法启动 Vitest

- [x] 复现 `spawn vitest ENOENT`。
- [x] 改为通过当前 `process.execPath` 运行 Vitest 的真实 JavaScript 入口，避免依赖 `vitest.cmd`。
- [x] `pnpm test:agent -- --help` 在 Windows 下执行成功。

关联位置：

- `@scripts/test-agent.mjs`

### 2.4 当前分支工程验证

- [x] `pnpm run build:cli` 通过。
- [x] 新增 Windows、macOS、Linux 子进程选项与浏览器启动器映射测试。
- [x] CodeGraph 已同步并处于最新状态。
- [x] 用户已有的 `pnpm-lock.yaml` 修改保持不变。

## 3. P0：必须优先修复

### 3.1 Service 默认暴露到局域网且缺少访问控制

状态：`[ ] 待决策`

现状：

- Service 当前监听 `0.0.0.0`，同一网络中的其他设备可以访问。
- API 可以读取项目内容、触发 Agent、执行 Git commit/discard/stash、管理 worktree。
- 当前未看到身份认证、访问令牌、Origin 校验或 CSRF 防护。
- Agent 以无人值守高权限模式执行，因此该问题不只是信息读取风险。

关联位置：

- `@src/service/index.ts`
- `@src/service/server.ts`
- `@src/service/routes/`

建议方案：

- 默认只监听 `127.0.0.1`。
- 增加显式的 `--host` 或 `--lan` 参数后才允许局域网访问。
- LAN 模式必须生成或配置访问令牌，并对 HTTP、SSE 请求统一鉴权。
- 校验 `Origin`/`Host`，避免恶意网页借助浏览器访问本机 YorZ API。
- 日志中不得输出完整令牌。

验收标准：

- 默认启动后，其他局域网设备无法连接。
- 本机 GUI、HTTP API、SSE 和浏览器自动打开功能正常。
- 未授权 LAN 请求返回 401/403，授权请求功能完整。
- Windows、macOS、Linux 均覆盖 localhost 与显式 LAN 模式测试。

### 3.2 Worktree 清理顺序在 Windows 下可能被文件占用阻断

状态：`[ ]`

现状：

- `removeWorktree()` 先将 worktree 目录移入回收站，之后才调用 `registry.remove()`。
- `mergeBackToMain()` 先执行 `git worktree remove`，之后才关闭并移除 registry 中的项目实例。
- registry 中缓存的 watcher、Agent session 或其他句柄可能仍持有 worktree 文件。
- Windows 对已打开文件和目录的删除更严格，容易出现 `EPERM`、`EBUSY` 或清理一半的状态。

关联位置：

- `@src/service/worktree-manager.ts`
- `@src/service/project-registry.ts`
- `@src/service/watcher.ts`
- `@src/service/session-manager.ts`

建议方案：

- 将“关闭项目实例”和“从全局配置删除项目记录”拆成两个明确阶段。
- 清理顺序调整为：
  1. 停止 watcher、Agent session 和相关订阅。
  2. 使用 `git worktree remove` 正常移除。
  3. 必要时执行有限次数、带短退避的 Windows 文件锁重试。
  4. 正常移除失败后才使用回收站作为兜底。
  5. `git worktree prune` 并删除分支。
  6. 最后持久化删除 registry 记录并广播项目列表变化。
- 中途失败时保留可恢复的 registry 信息，不产生“目录还在但项目记录消失”的状态。

验收标准：

- Windows 下 watcher 已启动、Review 已订阅、Agent session 已创建时仍能移除 worktree。
- clean/dirty worktree、合并成功、合并冲突、目录被短暂占用分别有定向测试。
- 清理失败时返回明确错误，worktree 和 registry 状态仍可继续操作或重试。
- macOS/Linux 的正常移除与合并行为不变。

## 4. P1：发布 Windows 兼容版本前完成

### 4.1 统一处理 `.exe`、`.cmd`、`.bat`、`.ps1` 命令入口

状态：`[ ]`

现状：

- Runtime 主要使用 Agent SDK，但 `test:agent` 和自定义 `YORZ_AGENT_CMD` 仍可能直接派生 CLI。
- Windows 上 npm 全局命令常以 `.cmd` shim 存在，`spawn(..., { shell: false })` 无法保证直接执行。
- 当前只修复了 Vitest 的 shim；Claude、Codex、OpenCode 或自定义 Agent 命令仍需专项验证。

关联位置：

- `@src/service/agent-config.ts`
- `@src/skill/yorz-spec/__tests__/runner.ts`
- `@scripts/test-agent.mjs`

建议方案：

- 优先解析并直接执行真实 `.exe` 或 JavaScript 入口。
- 仅当目标确认为 `.cmd`/`.bat` 时使用 `cmd.exe /d /s /c`，并继续隐藏控制台。
- `.ps1` 显式使用 PowerShell `-NoProfile -NonInteractive -File`。
- 参数以数组传递，不拼接未经转义的命令字符串。
- 不对所有平台或所有命令启用 `shell: true`。

验收标准：

- Windows 下内置三种 Agent 和自定义 Agent 命令均能启动、输出、退出和取消。
- 路径包含空格、中文和括号时参数不丢失。
- macOS/Linux 仍直接执行原有命令，不经过 Windows launcher。

### 4.2 Agent SDK 的 Windows 实机兼容矩阵

状态：`[ ]`

现状：

- Claude、Codex、OpenCode 由不同 SDK 管理，其内部可能继续启动 CLI/server 子进程。
- 本次封装只能控制 YorZ 自己显式创建的子进程，不能自动覆盖第三方 SDK 内部实现。

关联位置：

- `@src/service/agent-sdk/claude-adapter.ts`
- `@src/service/agent-sdk/codex-adapter.ts`
- `@src/service/agent-sdk/opencode-adapter.ts`

建议方案：

- 分别确认 SDK 是否支持传递 spawn、stdio、环境变量和 Windows 隐藏窗口选项。
- SDK 不支持时，优先升级或向上游提交能力，不通过全局 monkey patch 修改 `child_process`。
- 记录每个 Agent 的安装方式、可执行文件解析结果、取消方式和退出码。

验收标准：

- Windows 下每种 Agent 完成：新会话、继续会话、工具调用、取消、异常退出、Service 停止。
- Agent 执行期间不产生额外 cmd/PowerShell 窗口。
- macOS/Linux 同样完成最小会话回归。

### 4.3 全局配置、运行状态和日志使用平台规范目录

状态：`[ ] 待决策`

现状：

- 未设置 `YORZ_HOME`/`XDG_CONFIG_HOME` 时，所有平台都使用 `~/.config/yorz`。
- Windows 通常使用 `%APPDATA%` 保存漫游配置，使用 `%LOCALAPPDATA%` 保存运行状态、日志和缓存。
- 直接迁移会让已有用户看起来“丢失项目列表”，因此不能静默切换。

关联位置：

- `@src/service/global-config.ts`
- `@src/cli/serve.ts`
- `@src/service/index.ts`

建议方案：

- 保留 `YORZ_HOME` 为最高优先级覆盖项。
- 明确拆分：
  - 配置：Windows `%APPDATA%\YorZ`、macOS `~/Library/Application Support/YorZ`、Linux XDG config。
  - runtime/log：Windows `%LOCALAPPDATA%\YorZ`、macOS Library 对应目录、Linux XDG state/cache。
- 首次启动检测旧 `~/.config/yorz`，执行可回滚迁移或继续兼容读取。
- 迁移过程必须保留旧文件并记录结果。

验收标准：

- 新安装使用目标平台规范目录。
- 旧版本升级后项目列表、runtime 和日志可继续使用。
- `YORZ_HOME` 在三个平台均能完全覆盖默认路径。
- 多进程并发启动不会造成配置损坏或重复迁移。

## 5. P2：稳定性与性能改进

### 5.1 降低 Review Git changes 的轮询开销

状态：`[ ]`

现状：

- 弹窗已经修复，但 Review 页面仍会每秒启动一次 `git status`。
- 多个标签页已经共享单个 watcher，但大型仓库仍会持续产生 Git 进程与磁盘开销。

关联位置：

- `@src/service/events-hub.ts`
- `@src/gui/src/pages/SpecReview.tsx`
- `@src/gui/src/lib/sse.ts`

建议方案：

- 保留首次订阅立即刷新。
- Git commit/discard/stash 和 Agent round 完成后主动刷新。
- 活跃操作期间保持较短间隔，空闲后退避到 3～5 秒。
- 页面不可见时暂停或降频；最后一个订阅者离开后继续保持当前立即停止行为。
- 不直接递归监听整个仓库，避免大型仓库、`node_modules` 和 Windows watcher 压力。

验收标准：

- 文件变化能在产品可接受时间内出现在 Review。
- 无订阅者时不存在 Git 轮询。
- 多标签页仍只产生一个项目级轮询。
- 大型仓库空闲时的 Git 进程数量显著下降。

### 5.2 Windows 路径与文件系统专项测试

状态：`[ ]`

建议覆盖：

- 安装路径、项目路径和 worktree 路径包含空格、中文、括号。
- 盘符大小写、反斜杠/正斜杠、UNC 路径。
- 长路径和接近 Windows 路径长度边界的 spec/worktree 名称。
- 杀毒软件或编辑器短暂占用文件。
- Git executable 不在默认位置、存在多个 Git 安装。
- 文件名仅大小写变化。

验收标准：

- 所有路径都以参数数组传递，不通过字符串拼接 shell 命令。
- 失败时错误信息包含操作类型和目标路径，但不泄露访问令牌。
- 路径测试同时验证 macOS/Linux 没有出现平台分支回归。

### 5.3 建立轻量跨平台 CI

状态：`[ ]`

现状：

- `.github/workflows/` 当前只有 npm 发布工作流。
- Windows 子进程、路径和文件锁问题主要依赖人工发现。
- 当前阶段为三个平台配置完全相同的全量合并门禁，投入与收益不匹配。

建议方案：

- 新增独立 CI workflow，不修改 npm 发布条件。
- 普通 PR 只要求 `windows-latest` 和 `ubuntu-latest`：
  - 安装依赖。
  - CLI 构建。
  - 不依赖真实 Agent 凭证的核心定向测试。
- `macos-latest` 改为定时任务或发布前任务，不阻塞每个普通 PR。
- 真实 Agent 集成测试保持可选或受保护，避免普通 PR 消耗凭证。

验收标准：

- Windows/Linux 的 CLI 构建和核心测试作为合并门禁。
- Windows 覆盖子进程封装、浏览器启动映射、Git 和 Service start/stop。
- macOS 至少在定时任务或正式发布前完成构建与核心回归。
- CI 不发布包、不写真实用户目录、不依赖开发者本机配置。

## 6. 推荐实施顺序

1. P0.1：确定 Service 默认监听与 LAN 鉴权策略。
2. P0.2：修复 worktree 资源关闭和删除顺序。
3. P1.1 + P1.2：完成 Agent CLI/SDK Windows 实机矩阵。
4. P1.3：确定平台目录及旧数据迁移方案。
5. P2.1 + P2.2：优化轮询开销，扩展复杂路径和文件锁覆盖。
6. P2.3：建立 Windows/Linux PR 门禁，macOS 使用定时或发布前验证。

## 7. 完成定义

只有同时满足以下条件，才可将“Windows 完整兼容”标记为完成：

- Windows 安装、启动、浏览器打开、项目管理、Spec、Review、Git、Agent、worktree 和停止服务流程全部通过。
- 操作期间没有意外 cmd、PowerShell 或 Windows Terminal 窗口。
- macOS/Linux 对应核心流程通过，且未改变原有命令和行为。
- Windows/Linux PR CI 持续通过，macOS 在定时任务或正式发布前验证通过。
- 默认网络暴露和 LAN 访问具有明确、安全的产品策略。
- 旧版本配置可迁移或兼容读取，不造成用户数据“消失”。

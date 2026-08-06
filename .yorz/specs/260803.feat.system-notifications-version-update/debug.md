---
status: resolved
active:
updated_at: '2026-08-06 13:39:08'
---

## Debug 1 · 更新并重启后 yorz 版本未更新且提示仍存在

- 状态：resolved
- 快照：95307fe40d44ca4f163a5a385c10ea00a094744e
- 进入时间：'2026-08-06 12:00:47'

### 1.1 Bug 现象与复现

用户在 spec 追加任务中记录：执行系统提示里的更新并重启之后，`yorz` 版本仍为 `0.5.0`，期望为 `0.5.1`，系统提示仍然存在。

用户提供的现场命令输出：

```text
▶ yorz --version
0.5.0
▶ which yorz
/Users/fenghen/Library/pnpm/yorz
```

当前项目运行服务上下文：暂无运行中的命令服务。若需要 GUI 复现，需要启动服务或请用户在 GUI 命令菜单启动后重试。

### 1.2 关联链路分析

版本更新提示链路：

1. 服务端版本检测发现 registry latest 大于本地 `package.json` 版本，upsert `version-update` 提示。
2. GUI 点击“更新”后调用 `POST /api/system-notifications/:id/update`。
3. 服务端 `SystemNotificationCenter.update()` 执行全局安装命令，成功后把提示 action 改为 `restart-ready`。
4. GUI 点击“重启”后调用 `POST /api/system-notifications/:id/restart`。
5. 服务端派生 detached `yorz serve restart`；GUI 成功响应后本地移除提示并刷新页面。

可疑点集中在第 3 步全局安装命令选择与第 5 步重启后进程实际使用的 `yorz` 可执行文件来源是否一致。

### 1.3 Debug 基线

- 快照 SHA：`95307fe40d44ca4f163a5a385c10ea00a094744e`
- 进入时间：`2026-08-06 12:00:47`
- 退出闸门：收尾前执行 `git diff 95307fe40d44ca4f163a5a385c10ea00a094744e`，确认只剩合法修复，无临时脚手架残留。
- 快照创建备注：首次 `git stash create` 报 `could not write index`；取证无 `.git/index.lock`，执行 `git update-index -q --refresh` 后重试成功。

### 1.4 假设看板

- [x] H1：更新命令没有更新用户实际执行的 `/Users/fenghen/Library/pnpm/yorz`。若成立，会看到当前代码选择的安装命令与 `which yorz` 的 pnpm 全局 bin 来源不匹配，或执行命令未改变该 symlink 指向版本；若不成立，会看到安装命令正确指向 pnpm 全局包且安装后 `yorz --version` 应变为 latest。结论：成立。
- [x] H2：服务端当前版本比较基准使用开发目录 `package.json`，与用户全局 CLI 版本来源不同。若成立，会看到运行中的服务由源码/旧 dist 启动，重启后仍读到旧版本基准并重新生成提示；若不成立，服务端和 shell `yorz --version` 版本来源一致。结论：不是首要根因；H1 已解释安装后 shell `yorz --version` 仍停留在 0.5.0 的现场证据。
- [x] H3：restart API 成功只表示 detached restart worker 已派生，并不表示新 CLI 已成功安装。若成立，会看到更新失败路径没有阻止或记录足够错误，或者 restart 前 action 已错误进入 `restart-ready`；若不成立，只有安装命令成功退出才会进入 `restart-ready`。结论：证伪；`update()` 只有在安装命令 0 退出后才进入 `restart-ready`，问题在安装命令更新了错误的全局位置。

### 1.5 证据

- `npm view @yorz/cli version dist-tags --json` 返回 latest `0.5.1`，用户现场 `yorz --version` 为 `0.5.0`，现象成立。
- `which yorz` 输出 `/Users/fenghen/Library/pnpm/yorz`；`pnpm list -g @yorz/cli --depth 0` 显示全局 pnpm 包为 `@yorz/cli 0.5.0`。
- `npm prefix -g` 为 `/Users/fenghen/.nvm/versions/node/v24.11.0`，与 pnpm 全局 bin `/Users/fenghen/Library/pnpm` 不同。
- `env -i PATH="$PATH" HOME="$HOME" node -e ...` 显示直接启动命令时 `npm_config_user_agent` 与 `npm_execpath` 均为 `undefined`；当前 `resolveGlobalInstallCommand({})` 的测试期望是 `npm install -g @yorz/cli@latest`。
- `/Users/fenghen/Library/pnpm/yorz` wrapper 最终 `exec node "$basedir/global/5/.pnpm/@yorz+cli@0.5.0.../node_modules/@yorz/cli/dist/cli/index.js"`；运行时可通过 `process.argv[1]` 或 `NODE_PATH` 看到 `.pnpm` / `Library/pnpm/global` 来源。
- 临时启动 `yorz serve --port 7541 --foreground` 后，`ps -p 18378 -o pid= -o command=` 显示真实命令行为 `node /Users/fenghen/Library/pnpm/global/5/.pnpm/@yorz+cli@0.5.0_.../node_modules/@yorz/cli/dist/cli/index.js serve --port 7541 --foreground`，确认真实 `process.argv[1]` 是 pnpm global `.pnpm` 下的 CLI 入口脚本，而不是 `/Users/fenghen/Library/pnpm/yorz` shell wrapper。
- 证据链闭合：服务直接由 pnpm 全局 wrapper 启动时，没有 npm env，当前代码默认用 npm 更新，实际用户执行的是 pnpm 全局 `yorz`，因此更新后 `yorz --version` 仍为旧版本，重启后版本检测继续生成系统提示。
- 修复：`resolveGlobalInstallCommand()` 增加 `argv` 与 `NODE_PATH` 回退检测，先信任 `npm_config_user_agent` / `npm_execpath`，无显式 env 信号时再从 pnpm wrapper 的 `.pnpm` 路径识别包管理器。
- 验证：新增 pnpm wrapper 路径用例后，`pnpm vitest run src/service/__tests__/system-notifications.test.ts src/cli/__tests__/serve.test.ts` 通过，`pnpm run typecheck` 通过。
- 退出闸门：`git diff 95307fe40d44ca4f163a5a385c10ea00a094744e -- src/service/system-notifications.ts src/service/__tests__/system-notifications.test.ts .yorz/specs/260803.feat.system-notifications-version-update/debug.md` 仅包含合法修复与 debug 归档；无临时脚手架。完整 `git diff <SNAP>` 额外列出 `prevent-system-sleep` 相关已跟踪文件，但这些路径相对当前 HEAD 干净，且不在本次工作区 diff 中，判定为进入前/快照上下文噪声。

### 1.6 脚手架清单

- 暂无。

### 1.7 收尾核对

- [x] 根因已由硬证据确认。
- [x] 修复后复现步骤通过。
- [x] 脚手架清单全部核销。
- [x] `git diff 95307fe40d44ca4f163a5a385c10ea00a094744e` 只剩合法修复。
- [x] 关联测试 / typecheck 通过。

# Windows P0 运行时安全修复实施计划

> 依据：`docs/superpowers/specs/2026-08-06-windows-p0-runtime-safety-design.md`

## 任务一：限制服务监听地址

**文件：**
- 修改：`src/service/index.ts`
- 修改：`src/service/__tests__/service.test.ts`

1. 增加远程地址启动失败的测试，并确认测试先失败。
2. 增加带注释的 Loopback 地址校验函数，在创建监听器前拒绝远程地址。
3. 运行服务定向测试，确认 Loopback 正常、远程地址被拒绝。

## 任务二：增加 Worktree 合并前端校验

**文件：**
- 修改：`src/gui/src/pages/SpecList.tsx`
- 新增：`src/gui/src/lib/worktree-merge.ts`
- 修改：`src/gui/src/lib/__tests__/project.test.ts`
- 修改：`src/gui/src/i18n/zh-CN.ts`
- 修改：`src/gui/src/i18n/en.ts`

1. 增加测试，验证运行命令和 Agent 轮次均被识别，并确认测试先失败。
2. 打开合并确认框前读取最新任务状态，存在运行任务时显示本地化提示。
3. 最终提交合并前再次校验，降低确认框打开后新任务启动造成的竞态。
4. 后端保持原有清理行为，不自动停止正在进行的任务。
5. 运行前端辅助函数测试和 GUI 构建检查。

## 任务三：修复 Windows 命令进程树终止和陈旧 PID 误杀

**文件：**
- 修改：`src/service/command-manager.ts`
- 修改：`src/service/__tests__/command-manager.test.ts`

1. 增加 Windows 后代进程终止测试，以及持久化存活 PID 不被终止的测试；确认至少一个测试先失败。
2. Windows 当前子进程使用 `taskkill.exe /T /F`，POSIX 保持进程组信号。
3. 启动恢复仅更新陈旧记录状态，不对磁盘 PID 发信号。
4. 运行 CommandManager 定向测试并检查测试残留进程。

## 任务四：保护 Windows Service 的持久化 PID

**文件：**
- 修改：`src/cli/serve.ts`
- 修改：`src/cli/__tests__/serve.test.ts`

1. 增加 Windows 令牌缺失或请求失败时不调用 `process.kill` 的测试，并确认测试先失败。
2. 将 Windows 停止逻辑收紧为“关闭令牌成功才等待退出”，移除 PID 信号回退。
3. 保留 POSIX 的既有回退行为。
4. 运行 CLI serve 定向测试。

## 最终验证

1. 运行服务、命令、CLI 与前端合并校验的直接相关测试文件。
2. 运行定向 TypeScript 检查，只筛选本次相关文件错误。
3. 运行 `git diff --check`。
4. 运行 `codegraph sync` 和 `codegraph status`。
5. 检查 `git status` 和差异范围，确认无无关修改与残留测试进程。

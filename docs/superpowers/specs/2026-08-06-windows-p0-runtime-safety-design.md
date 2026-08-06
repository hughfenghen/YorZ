# Windows P0 运行时安全修复设计

## 目标

修复四个已经通过当前代码与 Windows 实测确认的 P0 风险：未认证远程命令执行、Worktree 清理竞态导致的数据丢失、Windows 子进程树无法完整终止，以及持久化 PID 复用导致误杀无关进程。

## 范围与边界

- 服务只允许监听 Loopback 地址，不在本次引入认证系统或局域网模式。
- Worktree 合并和删除必须先停止全部写入者，再执行最终 Git 状态检查。
- Windows 仅对当前进程内实际创建并持有的命令子进程执行进程树终止。
- 从磁盘恢复的 PID 只能通过关闭令牌证明身份；无法证明时不得强制终止。
- 不修改前端，不增加第三方依赖，不顺带处理非 P0 Windows 兼容问题。

## 方案

### 1. 服务监听边界

在服务启动入口统一校验 `host`。允许 `localhost`、`127.0.0.1`、`::1` 及其等价 Loopback 表达；其他地址在监听前直接报错。这样 API 中已有的任意命令执行能力不会暴露给远程网络。

### 2. Worktree 写入者静默化

为 `ProjectRegistry.release` 增加显式的“停止项目命令”选项。普通配置重载继续保留命令进程；Worktree 合并和删除使用严格释放：

1. 停止 Agent、Watcher 和该项目的命令管理器。
2. 合并场景在静默化后再 `git add/status/commit`。
3. 删除场景在静默化后再执行最终 `git status`；发现改动立即中止。
4. 只有磁盘与 Git 清理成功后才删除 registry 记录。

### 3. Windows 当前命令进程树终止

保留现有 POSIX 进程组终止逻辑；Windows 改用系统自带的 `taskkill.exe /PID <pid> /T /F`，以 shell PID 为根终止完整进程树。同步关闭路径使用同步调用，异步停止路径使用异步调用，并隐藏系统窗口。

### 4. 持久化 PID 身份保护

- `CommandManager` 启动时遇到磁盘中的 `running` 记录，只标记为已结束，不对 PID 发信号。
- Windows `serve stop` 仅在关闭令牌请求成功时等待服务退出；令牌缺失或验证失败时，不再回退到 `process.kill`。
- 当前进程内持有的命令子进程仍可安全使用进程树终止，因为其身份由实际 `ChildProcess` 对象证明。

## 错误处理

- 非 Loopback 启动返回明确错误，且监听器不会创建。
- Worktree 静默化失败时保留 registry 和目录，停止后续 Git/删除动作。
- `taskkill` 失败时保留运行记录并抛出停止失败，避免伪装成功。
- 无法验证的持久化服务 PID 返回未停止结果和可操作说明，不删除仍存活的 runtime 记录。

## 验证

- 服务入口测试覆盖允许的 Loopback 与拒绝的远程地址。
- Worktree 测试验证严格释放发生在 Git 状态检查之前，并验证静默化后出现改动会阻止删除。
- Windows 命令测试验证实际 shell 后代一并终止；持久化存活 PID 不会收到终止信号。
- CLI 测试验证 Windows 令牌失败时不会调用 `process.kill`。
- 仅运行直接相关测试文件、定向 TypeScript 检查、`git diff --check`、`codegraph sync` 与 `codegraph status`。

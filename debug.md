---
status: resolved
active:
updated_at: '2026-07-25 18:27:27'
---

## Debug 1 · npm 发布工作流未识别 0.3.1 提交消息

- 状态：resolved
- 快照：821ee63e68c1f2462219a27e074af23b341be177（工作区干净，git stash create 无输出，使用 HEAD 作为基线）
- 进入时间：'2026-07-25 18:26:30'

### 1. Bug 现象与复现

GitHub Actions `Publish npm` 在 `main` 分支 push 后未继续执行发布步骤。日志中 `REF_TYPE=branch`、`REF_NAME=main`、`HEAD_COMMIT_MESSAGE=0.3.1`，判断步骤输出 `main head commit message does not match vX.Y.Z.`。

### 2. 关联链路分析

`.github/workflows/npm-publish.yml` 的 `Determine publish eligibility` 步骤只使用 `^v[0-9]+\.[0-9]+\.[0-9]+$` 匹配发布标记。分支路径读取 `github.event.head_commit.message`，因此提交消息 `0.3.1` 不会通过发布资格判断。

### 3. Debug 基线

基线：`821ee63e68c1f2462219a27e074af23b341be177`。

### 4. 假设看板

- H1：分支发布判断要求提交消息必须带 `v` 前缀，导致 `0.3.1` 被拒绝。若成立，本地以 `REF_TYPE=branch`、`REF_NAME=main`、`HEAD_COMMIT_MESSAGE=0.3.1` 运行等价判断应得到 `should_publish=false`；修复后应得到 `should_publish=true`、`release_version=0.3.1`。

### 5. 证据

- GitHub Actions 日志显示 `HEAD_COMMIT_MESSAGE: 0.3.1`，随后输出 `main head commit message does not match vX.Y.Z.`。
- 本地等价验证显示：`branch main 0.3.1` 输出 `should_publish=true release_version=0.3.1`。
- 本地等价验证显示：`branch main v0.3.1` 输出 `should_publish=true release_version=0.3.1`。
- 本地等价验证显示：`tag 0.3.1` 输出 `should_publish=false`，tag 发布仍要求 `vX.Y.Z`。

### 6. 脚手架清单

- 无。

### 7. 收尾核对

- 已完成：验证分支标记 `0.3.1` 与 `v0.3.1` 均可解析为 `release_version=0.3.1`。
- 已完成：验证 tag 标记仍要求 `v0.3.1`。
- 已完成：`git diff --check -- .github/workflows/npm-publish.yml debug.md` 通过。

---
name: yorz-git-ops
description: Execute YorZ Review page git operations with focused safety rules.
---

# YorZ Git Ops Skill

本 skill 描述 service 端拉起 git 操作（带 `action`）时，Agent 应遵守的输入解析与 git 安全约束。**这条路径不进入 yorz-spec 的 plan/tasks/execute 状态机**，亦不修改 spec.md 的 frontmatter `stage`。

## 输入

- spec 文档路径（`<spec_path>`）。
- spec-id。
- 当前 git 仓库的未提交变更（`git status -sb` / `git diff` / `git diff --staged`）。
- action：`commit` / `discard` / `stash`。

## action=commit

- 由 Agent 基于 spec 文档与当前 git 状态，自主决定本次要提交的 spec 相关变更文件清单。
- commit message 由 Agent 基于本次变更语义自行生成；不附加 `[spec:<id>]` 锚点，不带 scope（遵循 `260630.refct.review-commit-msg-remove-scope`）。
- 仅允许使用 `git add <paths>` + `git commit -m <message>`；**禁止** `git push` / `git reset --hard` / `git rebase` / 修改任何已提交历史。

## action=discard

- 使用 `git restore --staged --worktree -- <paths>` 丢弃已 tracked 的修改；untracked 新文件使用 `git clean -fd -- <paths>` 清理。
- 对 untracked 文件先在终端输出待清理列表，再执行 clean，便于日志回溯。
- **不**预先 `git stash` 作为“保险备份”（遵循用户显式意图，保持轻量）。
- **禁止** `git reset --hard`、`git push`。

## action=stash

- 使用 `git stash push -m "yorz:<spec-id>" -- <paths>`，仅暂存 spec 相关变更文件。
- 不要使用 `git stash --all` 之类会影响 untracked / ignored 文件的形式，除非明确需要。
- **禁止** `git push`。

## 通用硬约束

- 仅操作 `<spec_path>` 与 git 工作区文件；不修改无关 spec、不修改本 skill 文件。
- 任一 git 子命令失败时，把错误信息写入终端日志（service 端会落盘到 agent-logs），不要静默吞掉。
- 元确认禁令：不向用户回问“是否继续 / 是否执行”等问题（GUI 已在按钮触发前做过必要的二次确认）。若无法安全判断文件范围或命令失败且无法自行恢复，应停止并把原因写入终端日志。

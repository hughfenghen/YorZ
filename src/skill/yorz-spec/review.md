# Review / Git Ops 阶段说明

本文件描述 service 端拉起 `mode=review` / `mode=git-ops`（带 `action`）时，Agent 应遵守的输入解析、输出格式与 git 安全约束。**这条路径不进入 plan/tasks/execute 状态机**，亦不修改 spec.md 的 frontmatter `stage`。

## mode=review

输入：

- spec 文档路径（`<spec_path>`），同目录可能已存在 `review.md`。
- 当前 git 仓库的未提交变更（`git status -sb` / `git diff` / `git diff --staged`）。

行为：

1. 读取 `<spec_path>` 与 git 变更，理解本次改动相对该 spec 的语义。
2. 将结构化 review 报告**按时间降序插入**到 `<spec_dir>/review.md`（与 spec.md 同级），使**最新条目位于文件顶部**。
   - 若 `review.md` 不存在：先写入一行 `# Review · <spec-id>` 作为一级标题，然后再追加本次条目。
   - 若已存在：**禁止覆盖**历史条目；将本次二级标题及其正文块**插入到 `# Review · <spec-id>` 一级标题之后、既有第一个 `## ` 二级标题之前**，使 review 条目按时间降序（最新在顶）排列。一级标题与新条目之间保留 1 个空行，新条目与后续既有条目之间保留 1 个空行。
3. 每次 review 的二级标题使用本机当前时间 `## YYYY-MM-DD HH:mm:ss`，时间格式与 spec frontmatter 一致。
4. 每个二级标题下必须依次包含 4 个三级小节，顺序固定：

   ```markdown
   ## 2026-06-30 14:23:01

   ### 变更总结

   <内容>

   ### 影响范围

   <内容>

   ### 风险提醒

   <内容>

   ### 变更文件清单

   - path/to/a.ts
   - path/to/b.tsx
   ```

5. 报告写完即结束本轮；不要修改 `spec.md`、不要执行任何 git 写操作。

## mode=git-ops + action=commit

- 输入：spec 文档 + 最近一次 `review.md` 条目（若存在）+ 当前 `git status`。
- 由 Agent **自主决定**本次要提交的 spec 相关变更文件清单；优先以最近 review 的"变更文件清单"为锚，结合 `git status` 中实际存在的未提交文件做交集。
- commit message 由 Agent 基于 review 总结自行生成；不附加 `[spec:<id>]` 锚点，不带 scope（遵循 `260630.refct.review-commit-msg-remove-scope`）。
- 仅允许使用 `git add <paths>` + `git commit -m <message>`；**禁止** `git push` / `git reset --hard` / `git rebase` / 修改任何已提交历史。

## mode=git-ops + action=discard

- 使用 `git restore --staged --worktree -- <paths>` 丢弃已 tracked 的修改；untracked 新文件使用 `git clean -fd -- <paths>` 清理。
- 对 untracked 文件先在终端输出待清理列表，再执行 clean，便于日志回溯。
- **不**预先 `git stash` 作为"保险备份"（遵循用户显式意图，保持轻量）。
- **禁止** `git reset --hard`、`git push`。

## mode=git-ops + action=stash

- 使用 `git stash push -m "yorz:<spec-id>" -- <paths>`，仅暂存 spec 相关变更文件。
- 不要使用 `git stash --all` 之类会影响 untracked / ignored 文件的形式，除非明确需要。
- **禁止** `git push`。

## 通用硬约束

- 仅操作 `<spec_path>`、`<spec_dir>/review.md` 与 git 工作区文件；不修改无关 spec、不修改本 skill 文件。
- 任一 git 子命令失败时，把错误信息写入终端日志（service 端会落盘到 agent-logs），不要静默吞掉。
- 不向用户回问"是否继续 / 是否执行"等元确认问题；GUI 已经在按钮触发前做了必要的二次确认。

---
name: yorz-spec
description: Drive YorZ spec docs through plan / tasks / execute stages with deterministic state updates.
---

# YorZ Spec Drive Skill

将单个 YorZ spec 文档作为状态机执行，围绕 `plan` / `tasks` / `execute` 三阶段推进，把状态持续写回文档。md 是单一真相；Agent 持续推进直至阻塞（待确认问题、决策、Review）才退出。

## 如何使用本 skill

本 skill 已按流程节点拆为多个子文档；每次接到 spec 任务时，**按以下顺序**按需 Read：

1. 先读 [输入约定与 frontmatter / Markdown 格式化](./conventions.md) — 解析 `spec_path`、frontmatter、章节齐全度。
2. 再读 [自动模式判定顺序](./routing.md) — 根据当前文档状态选择进入哪个阶段。
3. 然后根据判定结果读对应阶段文档：
   - [阶段一 plan](./plan.md) — 含「待确认问题结构」与「候选项硬约束」「产出前自检 checklist」「正反例」。
   - [阶段二 tasks](./tasks.md) — 含「批注消费规则」「用户批注清理」。
   - [阶段三 execute](./execute.md) — 含「追加任务 `[open]→[fixed]` 状态机」。
4. 涉及新建 spec 时读 [新建 spec 流程](./new-spec.md)。
5. 任何阶段都需要遵守的硬约束、变更重开判定见 [全局硬约束](./rewrite-rules.md)。

> 子文档之间通过 markdown 链接互相引用；遇到引用就把目标 md 也 Read 进来再继续。

## 输出优先级

1. 先保证状态正确（frontmatter 元信息更新、章节齐全）。
2. 再保证结构正确（列表格式、任务格式、候选项硬约束）。
3. 最后保证内容质量（可执行、可验收、可追踪）。

## 与 YorZ 工作流的关联

- 本 skill 不依赖 YorZ Service / GUI 也能独立工作：Agent 直接读写 `spec_path` 即可。
- 当 YorZ Service 在线时，Agent 写回 md 会被 Service 的 FS Watcher 感知并推送给 GUI；Agent 仍然以"持续推进、遇阻即退"为原则。
- 如需用户介入（待确认问题、决策、Review），Agent 把信息写回文档对应章节后立即退出，由用户人工补齐 `！！！` 批注，再由 CLI / Service 重新拉起 Agent 继续执行。

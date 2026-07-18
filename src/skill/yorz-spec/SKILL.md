---
name: yorz-spec
description: Drive YorZ spec docs through plan / tasks / execute stages with deterministic state updates.
---

# YorZ Spec Drive Skill

将单个 YorZ spec 文档作为状态机执行，围绕 `plan` / `tasks` / `execute` 三阶段推进，全部任务完成后进入终止态 `done`，把状态持续写回文档。md 是单一真相；Agent 持续推进直至阻塞（待确认项、决策、Review）或收尾为 `done` 才退出。

## 如何使用本 skill

本 skill 文档结构精简为 3 个文件；每次接到 spec 任务时，**按以下顺序**按需 Read：

1. **本文档（SKILL.md）**：输入约定、frontmatter 规范、格式约定、自动模式判定、全局硬约束、lint 硬约束、持续推进约束。
2. **[stages.md](./stages.md)**：plan / tasks / execute / new-spec 四阶段流程与正面示例。
3. **[review.md](./review.md)**：Review / Git Ops 阶段（独立路径，低频使用）。

[mermaid.md](./mermaid.md) 与 `references/` 目录**仅按需 Read**：只有在判断当前阶段需要输出 mermaid 图表「升维」时才加载，纯状态推进任务不必读取，以节省 context。**plan 阶段的「图形化补充」收尾子步骤**（见 stages.md）会针对 `现状分析`/`技术方案` 两节强制加载 mermaid.md 补图；补图须遵循其核心原则**「图优先、精确信息折叠」**——表层给图，精确细节折叠进 `<details>` 精确层。

> 当 Agent 以 `mode=review` / `mode=git-ops` 启动时，按 [review.md](./review.md) 执行；该路径不进入 plan/tasks/execute 状态机，也不修改 spec.md 的 frontmatter。

## 输入约定

- `spec_path`：**可选**，目标 spec 文档路径。
  - 显式给出时：典型位置 `docs/specs/*.md` 或 `.yorz/specs/<id>/spec.md`，直接更新该 spec。
  - 缺省时按以下顺序解析：
    1. **从 session 上下文恢复**：扫描当前会话历史中已出现/已读写过的 spec 文档路径；存在多个时优先选取最近一次被读写的；若仍有歧义，向用户确认。
    2. **从当前 prompt 创建**：若上下文中没有任何 spec 文档，按 [新建 spec 流程](./stages.md#new-spec) 生成路径与骨架。
- spec 目录默认为 `.yorz/specs`，可由 `<ProjectRoot>/.yorz/config.json` 的 `specsDir` 字段覆盖。
- `mode`：可选，`plan|tasks|execute|auto`，默认 `auto`。
- 批注前缀：`！！！`

## frontmatter 规范

每个 spec md 顶部必须有 YAML frontmatter：

```yaml
---
stage: plan # plan | tasks | execute | done
last_action: 简述上一次动作
updated_at: '2026-06-14 15:42:07' # 秒级 + 单引号
summary: 一句话概要，≤ 200 字符
---
```

- 字段顺序固定为 `stage` → `last_action` → `updated_at` → `summary`，每个字段独占一行，禁止嵌套与额外字段。
- `updated_at` 使用本地秒级 `YYYY-MM-DD HH:mm:ss`，**写入时必须用单引号包裹**。
- 缺失任意字段时，先补齐再继续。

## Markdown 格式化约定

- 每次写回 spec md 后，**应在仓库支持的条件下运行 Markdown formatter**（优先 `npx prettier --write <spec_path>`）；未配置则跳过。
- formatter 必须保留 YAML frontmatter 不变。
- 任务清单仅使用单层 `- [ ]` / `- [x]`，避免缩进与嵌套。
- 二、三级标题必须带层级编号，便于外部按章节号定位：
  - 每次写回前按 body 中 `## ` / `### ` 出现顺序重新编号。
  - 二级标题 `## N. 标题`（N 从 1 起）；三级标题 `### N.M 标题`（M 在所属二级下从 1 起）。
  - 该规则不影响 frontmatter 与一级标题（`# `）。

## 自动模式判定顺序（严格按顺序）

`mode=auto` 时，**严格按顺序**判定，命中即停：

1. 若 `spec_path` 缺省：从 session 上下文恢复 spec 路径；恢复失败进入 [新建 spec 流程](./stages.md#new-spec) 并以 `plan` 起步。
2. **优先扫描 `## 追加任务` 中是否存在 `[open]` 条目**：存在即视为"新输入"信号，进入 `plan`（重开流程）。
3. 若识别到新增/扩展需求或新增 bug，进入 `plan`（重开流程）。
4. 若文档存在任意 `！！！` 批注，进入 [tasks](./stages.md#tasks)。
5. 若 `## 待确认项` 下存在有效条目（非空态 `_暂无_`），停止推进并等待人工批注。
6. 若 `stage` 已是 `done` 且上述 1–5 均未命中（无新输入/批注/待确认项），直接停止：终止态不再自动推进。
7. 若存在未完成的**非 `[manual]`** 任务（`- [ ]` 且非 `- [ ] [manual]`），进入 [execute](./stages.md#execute)。
8. 若任务清单已就绪且不存在未完成的非 manual 任务（走到此处已排除 `[open]`/新需求/批注/待确认项）：将 `stage` 置为 `done` 并停止推进（终止态）。
9. 若 `## 技术实现方案` 为空或明显不完整，进入 [plan](./stages.md#plan)。
10. 进入 [tasks](./stages.md#tasks) 生成或刷新详细任务清单。

> 章节名 `## 待确认项` 为新名，parser/lint 兼容旧名 `## 待确认问题`；存量 spec 保留旧名仍可识别，新建/重写一律用 `待确认项`。
>
> 待确认项判定：章节内存在任一 `### ` 三级标题即视为未决；仅有 `_暂无_` 或整章为空即视为无未决条目；存在未决条目时禁止进入 execute。
>
> `done` 判定忽略 `- [ ] [manual]` 人工确认项：即使 manual 项仍未勾选，只要其余任务全部完成、且无待确认项/批注/`[open]`，即可收尾为 `done`。

## 全局硬约束

### 通用

- 仅更新目标 spec 文档，不修改无关文档。
- 每次写回文档都必须更新 frontmatter 元信息。
- 执行任务时若涉及代码改动，只改动与任务相关的最小范围。

### 章节建议

初始化 spec 时**建议**创建以下章节（`## 追加任务` `## 用户批注` 为可选，由用户触发追加时懒插入）：

- `## 现状分析` / `## 技术实现方案` / `## 待确认项` / `## 任务清单` / `## 执行记录`

> lint 不再强制校验章节齐全；但 routing 按章节名查找时，章节不存在视为空态。

### 变更重开流程

**触发条件：**

- 在已有 spec 中识别到"新增/扩展需求"或"新增 bug"，将 `stage` 切回 `plan`，`last_action` 记录"变更重开流程"。
- `## 追加任务` 存在 `- [open] [feat|refct|fix] ...` 条目时，将 `stage` 切回 `plan`。

**重开后必须做的事：**

- 仅针对新增内容重新走完 `plan → tasks → execute`。
- 未受影响的既有结论/任务可保留，受影响任务必须重新评估。
- plan 阶段消费追加任务条目时，**不修改** `[open]` 状态标记。

## 输出优先级

1. 先保证状态正确（frontmatter 元信息更新）。
2. 再保证结构正确（列表格式、任务格式、候选项）。
3. 最后保证内容质量（可执行、可验收、可追踪）。

## 写回后的 lint 硬约束

任何阶段完成对 `spec.md` / `review.md` 的写入后，Agent **必须**通过 Bash 运行 `yorz lint <path> --format json`，并 parse stdout。

- `errorCount === 0` 时视为通过。
- 存在 `severity: error` 时按 `ruleId` + `message` + `line` 定位并修改，然后重新运行 lint。
- 同一文件 lint 连续失败达到 **3 次**，将偏差作为 `## 待确认项` 条目写入 spec.md 后退出，等待人工干预。
- `warn` 级 finding 不阻断推进，但应尽力消除。

## 持续推进硬约束

Agent 在 plan / tasks / execute 任意阶段，**只允许**因以下"合法阻塞"退出当轮：

1. `## 待确认项` 章节存在非 `暂无` 条目；
2. spec md 内存在任何 `！！！` 批注；
3. 识别到新增/扩展需求或新增 bug，按变更重开流程切回 `plan`；
4. 执行外部命令 / 工具调用失败，需要用户做不可推断的决断。

**显式禁止**以下"元确认"行为：

- 以"任务很多 / 改动较大 / 范围广 / 时间长 / 风险高"为由询问"是否继续 / 是否执行 / 是否同意此方案"。
- 在 execute 阶段中段汇报进度并要求用户确认下一步。
- 反问类如"要不要我开始 / 是否继续下一项"等问句。

替代约定：tasks/execute 阶段若产生新疑问，**必须**作为新条目写回 `## 待确认项` 并按变更重开流程退出。

兜底：对外部世界有副作用、不可逆的命令（如 `git push`、`git reset --hard`、`rm -rf`、修改 CI 配置等破坏性操作）仍按系统默认安全准则处理。

## 与 YorZ 工作流的关联

- 本 skill 不依赖 YorZ Service / GUI 也能独立工作：Agent 直接读写 `spec_path` 即可。
- 当 YorZ Service 在线时，Agent 写回 md 会被 Service 的 FS Watcher 感知并推送给 GUI。
- 如需用户介入，Agent 把信息写回文档对应章节后立即退出，由用户人工补齐 `！！！` 批注，再由 CLI / Service 重新拉起 Agent 继续执行。

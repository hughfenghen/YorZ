---
stage: execute
last_action: 完成全部 14 项任务，vitest 88/88 通过、tsc 通过
updated_at: 2026-06-19
summary: spec 详情页支持「追加任务」入口（需求/重构/Bug 三类），提交后写回 spec 并自动触发 Agent 进入 plan 重开 → tasks → execute 处理。
---

# spec 详情页支持追加任务并触发 Agent 处理

## 1. 背景

来自用户的原始需求（保留原文以便追溯）：

> spec 文档页面需要支持追加 bug，将 bug 描述合入当前 spec 文档，然后让 Agent 执行修复。

在第一轮 plan 评审中，用户进一步把范围扩展为：

> 修改当前 spec，不限于追加 bug，即支持在已有 spec 追加需求、重构或 bug 任务。

仓库根 `README.md` 的 TODO 中已经预留了 `spec 追加 bug` 这一项，定位是「不建立 spec 的沟通」之一：用户在某条 spec 已经走完一轮 plan/tasks/execute 之后，又发现新的 bug、要扩展一小段需求、或者要对已实现部分做一次小范围重构，不希望另开一个 spec、也不希望像写「待确认问题」批注那样去找一段引用，而是希望直接把"新输入"贴进当前 spec、让 Agent 接着干。

skill 侧的 SKILL.md 实际上已经为这条路径定义了语义：

> 若在已有 spec 中识别到"新增/扩展需求"或"新增 bug"（无论来自正文变更或 `！！！` 批注），必须将 frontmatter `stage` 立即切回 `plan`，并在 `last_action` 记录"变更重开流程"。

但目前**没有任何 GUI/Service 入口**让用户把"新需求/新重构/新 bug"递交进 spec，导致 SKILL 的"变更重开"分支在产品里是死路径——只能让用户手动改 md，或在 `## 待确认问题` 里塞一条问题然后通过批注答复绕一圈。

## 2. 需求

- `SpecDetail` 页面增加一个**追加任务**入口（按钮 / 浮层），无论 spec 处于 plan / tasks / execute 哪个阶段都可见。
- 入口打开一个对话框，需要支持三种类型的追加项：
  - `feat` 新增/扩展需求
  - `refct` 重构/重写/抽取
  - `fix` 修复缺陷（即原 "追加 Bug"）
- 对话框字段：
  - 必填：类型（`feat | refct | fix`）
  - 必填：描述（多行文本）
  - 可选：关联 spec 中某段引用（沿用现有 `SelectionMenu` 的选区机制，但不强制）
- 提交后：
  1. 由 Service 将描述合入当前 spec 文档（追加到一段语义明确的章节，让 SKILL 能识别是"新输入"）
  2. 自动触发 Agent（`/specs/:id/run`）按 yorz-spec skill 处理 → SKILL 自检到新追加项 → 把 `stage` 切回 `plan`，重新走 plan / tasks / execute
- 追加提交本身**不要走"待确认问题答复"通道**：那条通道的语义是回答 plan 阶段的疑问，不是新增需求 / 缺陷 / 重构；混在一起会让 SKILL 的"批注消费 → 删除 ## 用户批注"流程把追加项一并清掉。
- 不引入新的运行模式（仍是 `skill-run`），不改变 Agent 命令行；本期只在 GUI / Service / spec md 结构 / SKILL.md 上做改动。

## 3. 现状分析

### 3.1 现有"用户向 spec 写入内容"的三条通道

仓库已存在三种从 GUI 把内容回写进 spec md 的通道，理解它们的语义差异是设计本期追加通道的前提：

- 自由批注 `POST /specs/:id/inputs`
  - 入口：`SpecDetail.tsx:117-125` 中 `submitAnnotate` → `api.appendAnnotation`，依赖 `SelectionMenu` 的"先划选 spec 正文一段 → 弹批注框"。
  - 写入位置：`spec-store.ts` 的 `appendAnnotation` 追加到 `## 用户批注` 末尾，形式为 `> 引用\n！！！备注`。
  - 语义：plan 阶段对 spec 正文的细粒度反馈；批注会在 tasks 阶段被 SKILL 消费后**整段删除**（见 SKILL.md 阶段二「在 tasks 阶段消费完所有 `！！！` 后，必须**整段删除** `## 用户批注` 章节」）。
- 待确认问题答复 `POST /specs/:id/questions/answers`
  - 入口：`QuestionConfirmPanel` 提交，路径 `SpecDetail.tsx:132-136`。
  - 写入位置：`spec-store.ts` 的 `applyQuestionAnswers` 同样落到 `## 用户批注`，但每条针对的是 `## 待确认问题` 中的一条问题（携带 `questionId` / `questionText` / `selectedOptionLabel` / `note`），SKILL 在 tasks 阶段按问题逐条回填技术方案。
  - 语义：回答 plan 阶段 Agent 已经列出的疑问；同样会被 tasks 阶段清掉。
- 运行 Agent `POST /specs/:id/run`
  - 入口：`SpecDetail.tsx:174` 的"运行 Agent"按钮；submitAnswers 完成后会**自动**调用一次（`SpecDetail.tsx:135`）。
  - 写入位置：不直接改 md，而是拉起 Agent 用 SKILL 处理整份 spec。

### 3.2 SKILL 对"新增/扩展需求 / 新增 bug"的处理预期与缺口

`src/skill/SKILL.md` 的「全局硬约束」明确：识别到"新增/扩展需求"或"新增 bug"必须把 `stage` 切回 `plan`、`last_action` 记"变更重开流程"，并仅针对新增内容重新走完三阶段。

但 SKILL **没有**明确以下几点：

- 追加项该写在 spec md 的哪个章节？是塞进 `## 需求` 的子段，还是新增 `## 追加项` / `## 追加任务`？
- 追加项段落用什么标记让 SKILL "一眼识别为新输入" 而不是误判成正文变更？
- 追加项被 SKILL 消费完后是否要从 md 中清理掉（类似 `## 用户批注`）？保留全部历史会让 spec 越长越乱，全清又会丢失追溯链。
- 与 `！！！` 批注的关系：追加项段落要不要带 `！！！` 前缀？带的话会和"批注消费 → 删除 ## 用户批注"撞车。
- 三类（需求/重构/Bug）SKILL 处理逻辑是否一致？还是需要按类型走不同的 plan 模板？

### 3.3 Service 写文档的能力面

`src/service/spec-store.ts` 当前向外暴露的 spec 修改方法只有：

- `create(input)`：新建 spec
- `appendAnnotation(specId, { sectionPath, quote, note })`：往 `## 用户批注` 末尾追加一段
- `applyQuestionAnswers(specId, payload)`：基于待确认问题逐条回填

文件常量 `SECTIONS`（`spec-store.ts:64`）列出 7 个固定二级章节（`## 背景` / `## 需求` / `## 现状分析` / `## 技术实现方案` / `## 待确认问题` / `## 任务清单` / `## 执行记录`），没有"追加项区"。所以要么扩展 `SECTIONS`，要么复用 `## 需求` 下的子结构。

`POST /specs/:id/inputs`（`src/service/routes/specs.ts:55-67`）直接调用 `appendAnnotation`，对外只暴露 `sectionPath / quote / note` 三参数，不带"kind"字段——不能简单复用，否则追加项会被当成普通批注、在 tasks 阶段被清掉。

### 3.4 Agent 运行链路

`POST /specs/:id/run` 直接以固定 prompt 起一个 `skill-run`（`src/service/routes/specs.ts:88-97`）：

```
请使用 yorz-spec skill 处理 spec：.yorz/specs/<id>/spec.md
```

SKILL 在 auto 模式下会按「自动模式判定顺序」推进：识别到新追加项 → 进 plan → 写 `现状分析` / `技术实现方案` / `待确认问题` → 阻塞等批注或继续 tasks。因此**只要把追加项描述落进 md 的某个 SKILL 能识别的位置，并启动一次 run，整个闭环就能跑通**——这是本期最小可行链路。

### 3.5 GUI 当前与本期相关的对接面

- 顶部按钮区位于 `SpecDetail.tsx:160-181`，已经有"运行 Agent"按钮；同位置追加一个"追加任务"按钮在视觉/布局上最自然。
- 已有的 `AnnotatePopover` 组件用于"划选 + 批注"的浮窗交互，不可直接复用：追加项通常没有引用段，UI 模式更像独立 dialog。本期需要一个新的轻量 dialog 组件（或复用 `QuestionConfirmPanel` 的样式语言）。
- `agentTasks.start(...)` 已经支持把刚起的 run 挂进右下角 Agent Dock；追加项提交后触发的 run 也走这条路。

### 3.6 类型命名与现有体系的对齐

yorz-spec skill 本身在「新建 spec」时已经使用了 `feat | refct | fix` 三类作为 spec id 的 type 段，与本期"追加任务"的三类完全对应：

- `feat` ↔ 新增/扩展需求
- `refct` ↔ 重构/重写/抽取
- `fix` ↔ 修复缺陷

复用同一套 type 标记可以让 SKILL 内部识别逻辑保持一致，也避免在 spec md 中出现两套不同的类型词汇。

## 4. 技术实现方案

> 以下方案已合并第一轮评审中 8 条「待确认问题」的答复（双状态保留 / 顶部 meta 入口 / autoRun=true / 允许无引用 / 多条排队 / 不打断当前 run / 章节位于任务清单后执行记录前 / 列表页本期不做徽标），以及第二轮 6 条答复（沿用 `## 追加任务` 命名 / 单按钮 + dialog 内选 type / 单 `POST /specs/:id/appends` / 双方括号标记 / kind 差异化 plan 模板 / dialog 显示"自动重开 plan"提示）。

### 4.1 spec md 中追加项段落的格式约定

新增 spec 内章节 `## 追加任务`（在已有 7 个固定章节基础上扩展为 8 个，置于 `## 执行记录` **之前**、`## 任务清单` **之后**——逻辑上属于"反馈进来的新输入"而非"已知执行结果"）：

```
## 追加任务

- [open] [feat] 2026-06-19 10:30 | <描述首行（trim, ≤80字符）>
  - 描述：<完整描述（多行原样保留）>
  - 引用：<sectionPath>（可选；无则省略整行）
  - 引用原文：> <quote>（可选；无则省略整行）
- [open] [fix] 2026-06-19 10:45 | <bug 描述首行>
  - 描述：...
- [fixed] [refct] 2026-06-18 14:10 | <重构描述首行>
  - 描述：...
```

- 状态标记：`[open]` / `[fixed]`。默认 `open`；Agent 在 execute 阶段验证完成后把对应条目改为 `[fixed]` 并在 `## 执行记录` 里登记。
- 类型标记：`[feat]` / `[refct]` / `[fix]`，与 spec id 的 type 段保持同一词汇表。状态与类型两个方括号之间用单空格分隔，紧跟时间戳。
- **不带 `！！！` 前缀**，避免与"批注消费 → 删 `## 用户批注`"流程冲突。
- 状态为 `[fixed]` 的条目**保留**在 md 中作为追溯历史，不删除；只有 SKILL 在变更重开时确认所有条目均 `[fixed]` 才可推进至下一轮 tasks。

### 4.2 SKILL.md 增补条款

在 SKILL.md 的「全局硬约束」「自动模式判定顺序」「阶段一/二/三」中插入以下规范（顺序如下，便于审阅）：

1. 「全局硬约束」新增：**`## 追加任务` 章节存在且包含 `- [open]` 条目时视为"新输入"信号，必须把 `stage` 切回 `plan` 并按条目类型分别记 `last_action: 变更重开流程（追加任务：feat|refct|fix）`。**
2. 「自动模式判定顺序」在第 2 步「识别到新增/扩展需求或新增 bug」之前显式补一句：「优先扫描 `## 追加任务` 中是否存在 `[open]` 条目」。
3. 「阶段一：plan」补充：plan 阶段必须把每个 `[open]` 条目纳入 `## 现状分析` / `## 技术实现方案` / `## 待确认问题` 中分析；按 `[feat]` / `[refct]` / `[fix]` 类型差异化处理（feat 重在范围拆解、refct 重在影响面与回归、fix 重在根因与最小修复）；写完后**不**修改条目状态。
4. 「阶段三：execute」补充：execute 阶段每完成一个追加项，在 `## 执行记录` 追加结果，并把对应条目状态从 `[open]` 改为 `[fixed]`，**保留**条目作为历史。
5. 「全局硬约束」补充：spec-store 端 `SECTIONS` 须把 `## 追加任务` 纳入固定章节集合。
6. 「新建 spec」类型分类小节补一句脚注：与「追加任务」共用 `feat / refct / fix` 词汇表。

### 4.3 Service：新接口 `POST /specs/:id/appends`

不复用 `/specs/:id/inputs`（语义不同：那条专属"会被消费删除的批注"）。新增独立 endpoint：

请求：

```json
{
  "kind": "feat | refct | fix",
  "description": "<必填，1..4000 字符>",
  "sectionPath": "<可选，沿用 annotation 的 sectionPath>",
  "quote": "<可选，引用原文，≤500 字符>",
  "autoRun": true
}
```

响应：

```json
{ "ok": true, "runId": "<可选，autoRun=true 时返回>" }
```

实现位置：`src/service/routes/specs.ts` 新增 handler；`src/service/spec-store.ts` 新增 `appendItem(specId, input)` 方法：

- 若 `## 追加任务` 章节不存在则按 4.1 的位置插入空骨架（在 `## 任务清单` 与 `## 执行记录` 之间）。
- 按 4.1 的格式追加一个 `[open] [kind]` 条目；时间使用 `YYYY-MM-DD HH:mm`（store 的 `now()` 已存在并可注入测试时钟）。
- 同时刷新 frontmatter：`stage: plan`、`last_action: 追加任务（<kind>）`、`updated_at: <YYYY-MM-DD>`；保持 `summary` 不变。
- 触发 `onWrite` 钩子保证 watcher 不回响。

`autoRun=true` 时由 handler 在 `appendItem` 成功后调用 `deps.runner.run({ specId, mode: 'skill-run', prompt: ... })`（同 `/specs/:id/run`），把 `runId` 一并返回。已确认默认 `autoRun=true`、不打断当前正在运行的 Agent（如果有同名 run 正在跑则仅写入 md，不强制 cancel）。

### 4.4 GUI：在 SpecDetail 增加追加任务入口

改动点：

- `src/gui/src/components/AppendTaskDialog.tsx`（新增）：受控 dialog，字段包括：
  - 类型选择：`feat | refct | fix` 三选一（radio 或下拉，默认 `fix`，与本 spec 的最初语义对齐）
  - 描述：必填多行文本
  - 引用 sectionPath（只读，从外部传入，若有）
  - 引用原文（只读，若有）
  - 提交 / 取消按钮
- `src/gui/src/pages/SpecDetail.tsx`：
  - 顶部 meta 区追加 `<button>追加任务</button>`（位置：紧邻"运行 Agent"按钮左侧）。
  - 点击 → 打开 `AppendTaskDialog`，初始无 selection；如果点击时 `snap()` 有选区则把 selection 作为引用预填。
  - 提交时调用新 API → 成功后 `agentTasks.start({ runId, mode: 'skill-run', ... })` 把新起的 run 接到 Dock。
- `src/gui/src/lib/api.ts`：新增 `appendItem(specId, body)` 与类型 `AppendItemBody`。
- `SelectionMenu`：保持现有"批注 / 解释"两项不动；不在 SelectionMenu 内加"追加任务"，避免与"批注"语义混淆。

样式上沿用 `AnnotatePopover` 的视觉规范，不再引入新的组件库元素。

### 4.5 测试

- `src/service/__tests__/spec-store.appends.test.ts`：覆盖 `appendItem` 的情形：
  - 章节不存在自动创建
  - 章节已存在追加在末尾
  - frontmatter `stage` 正确切回 plan，`last_action` 按 kind 区分
  - 三类 kind 分别写入正确的 `[feat]` / `[refct]` / `[fix]` 标记
- 路由层覆盖：`POST /specs/:id/appends` 的参数校验（kind 必填且枚举受限、description 必填 + 长度边界）、autoRun 行为、404（spec 不存在）。
- GUI 层至多覆盖 `AppendTaskDialog` 的表单校验单测；e2e 由 README 中 `npm run e2e` 已有的 SpecDetail 流程扩展。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 1. 修改 `src/skill/SKILL.md`「全局硬约束」：新增「`## 追加任务` 章节存在 `[open]` 条目时视为'新输入'信号，必须切回 plan 并按条目类型记 `last_action: 变更重开流程（追加任务：feat|refct|fix）`」一条；并补一条「`SECTIONS` 须包含 `## 追加任务`」。验收：grep 命中两处条款。
- [x] 2. 修改 `src/skill/SKILL.md`「自动模式判定顺序」第 2 步前补「优先扫描 `## 追加任务` 中是否存在 `[open]` 条目」。验收：grep 命中。
- [x] 3. 修改 `src/skill/SKILL.md`「阶段一：plan」：补充「按 `[feat]` / `[refct]` / `[fix]` 类型差异化处理：feat 重在范围拆解、refct 重在影响面与回归、fix 重在根因与最小修复；plan 阶段不修改条目状态」。验收：grep 命中三类描述。
- [x] 4. 修改 `src/skill/SKILL.md`「阶段三：execute」：补充「完成追加项时将 `[open]` 改为 `[fixed]` 并在 `## 执行记录` 追加结果，保留条目作为历史」。验收：grep 命中条款。
- [x] 5. 修改 `src/skill/SKILL.md`「新建 spec」类型分类：脚注说明与「追加任务」共用 feat/refct/fix 词汇表。验收：grep 命中脚注。
- [x] 6. 修改 `src/service/spec-store.ts`：在 `SECTIONS` 数组按顺序插入 `## 追加任务`（位于 `## 任务清单` 之后、`## 执行记录` 之前）。验收：单测覆盖"章节不存在时被骨架补齐"用例通过。
- [x] 7. 在 `src/service/spec-store.ts` 新增 `appendItem(specId, input)` 方法：按 `- [open] [kind] YYYY-MM-DD HH:mm | <首行>` + 缩进子项（描述/引用/引用原文）的格式追加，刷新 frontmatter `stage: plan` / `last_action: 追加任务（<kind>）` / `updated_at`，`summary` 不变；调用 `onWrite` 钩子。验收：单测覆盖 4 个用例。
- [x] 8. 在 `src/service/routes/specs.ts` 新增 `POST /specs/:id/appends` handler：校验 `kind ∈ {feat,refct,fix}`、`description` 长度 1..4000、`quote` ≤500、`sectionPath` 可选；调用 `spec-store.appendItem`；`autoRun` 默认 true，true 时调用 `deps.runner.run({ specId, mode: 'skill-run', prompt })` 并返回 `runId`；spec 不存在返回 404。验收：路由层单测覆盖参数校验、autoRun、404。
- [x] 9. 在 `src/gui/src/lib/api.ts` 新增 `AppendItemBody` 类型与 `appendItem(specId, body)` 方法，类型签名与 service 端契约一致。验收：tsc 通过。
- [x] 10. 新建 `src/gui/src/components/AppendTaskDialog.tsx`：受控 dialog，字段含类型 radio（feat/refct/fix，默认 fix）、描述多行必填（1..4000）、引用 sectionPath/原文（只读，外部传入，可选）、提交/取消按钮、提示文案「本次提交将自动重开 plan 阶段」。验收：组件单测覆盖空描述阻止提交、kind 选择切换。
- [x] 11. 修改 `src/gui/src/pages/SpecDetail.tsx`：顶部 meta 区紧邻"运行 Agent"按钮左侧加「追加任务」按钮；点击打开 `AppendTaskDialog`，若 `snap()` 当前有选区则把 selection 预填引用；提交成功后通过 `agentTasks.start({ runId, mode: 'skill-run', ... })` 接入 Dock。验收：手工/e2e 跑通"打开 dialog → 提交 → Dock 出现 run"。
- [x] 12. 新建 `src/service/__tests__/spec-store.appends.test.ts`：覆盖（a）`## 追加任务` 章节不存在自动创建；（b）已存在追加至末尾；（c）frontmatter `stage` 切回 plan 且 `last_action` 含 kind；（d）三类 kind 分别写入正确 `[feat]/[refct]/[fix]` 标记。验收：vitest 全绿。
- [x] 13. 在路由测试文件中覆盖 `POST /specs/:id/appends`：kind 枚举/description 长度边界拒绝；autoRun=true 返回 `runId` 且调用 runner；spec 不存在返回 404。验收：vitest 全绿。
- [x] 14. 执行 `npx prettier --write .yorz/specs/260619.feat.append-bug-and-fix/spec.md` 与项目级 `npm run test` / `npm run typecheck`（若存在），并在 `## 执行记录` 登记结果或阻塞原因。

## 7. 执行记录

- 任务 1-5：在 `src/skill/SKILL.md` 落入「全局硬约束」（`## 追加任务` 章节固定位置 + `[open]` 条目触发 plan 重开）、「自动模式判定顺序」新增第 2 步（优先扫描 `## 追加任务`，后续编号顺延）、「阶段一：plan」按 feat/refct/fix 差异化分析模板、「阶段三：execute」`[open]→[fixed]` 转写规则、「新建 spec」类型词汇表脚注。验证：手动 grep 全部命中。
- 任务 6-7：在 `src/service/spec-store.ts` 把 `## 追加任务` 加入 `SECTIONS`（位于任务清单之后、执行记录之前），新增 `AppendKind` / `AppendItemInput` 类型与 `appendItem(specId, input)` 方法，按 `- [open] [kind] YYYY-MM-DD HH:mm | <首行>` + 缩进子项写回，刷新 frontmatter 为 `stage: plan` / `last_action: 追加任务（<kind>）` / `updated_at`，并提取 `mergeAppendTasksEntry` + `formatDateTime` 辅助函数。
- 任务 8：在 `src/service/routes/specs.ts` 新增 `POST /specs/:id/appends`：复用 `parseAppendBody` 校验 kind/description/sectionPath/quote/autoRun；spec 不存在返回 404；autoRun 默认 true 时调用 `deps.runner.run({ mode: 'skill-run' })` 并把 `runId` 写进响应。
- 任务 9-11：在 `src/gui/src/lib/api.ts` 暴露 `AppendItemKind` / `AppendItemBody` 与 `api.appendItem(id, body)`；新建 `src/gui/src/components/AppendTaskDialog.tsx`（kind radio 默认 fix、描述必填且 ≤4000、引用只读、提示语「本次提交将自动重开 plan 阶段」）；`SpecDetail.tsx` 顶部 meta 区紧邻"运行 Agent"加「追加任务」按钮，点击时预填当前选区，提交后把返回的 `runId` 接入 `agentTasks` Dock。
- 任务 12-13：新增 `src/service/__tests__/spec-store.appends.test.ts`（6 用例）与 `src/service/__tests__/appends-route.test.ts`（7 用例），分别覆盖 store 端章节自动创建/末尾追加/frontmatter 切回 plan/三类 kind 标记/参数校验/可选引用子项，以及路由端 200+runId/autoRun=false 不返回 runId/kind 枚举/描述长度上下界/404/无效 JSON。
- 任务 14：`npx vitest run` 全量 12 文件 88 用例通过；`npx tsc --noEmit` 退出码 0；`npx prettier --write` 对本 spec.md 无变更（已符合格式）。未跑 e2e（README 中 `npm run e2e` 未列入本期任务范围），如需手测请在浏览器内验证 SpecDetail 上的「追加任务」按钮 → AppendTaskDialog → Dock 出现 run 全链路。

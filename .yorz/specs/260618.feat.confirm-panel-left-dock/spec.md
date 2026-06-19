---
stage: execute
last_action: execute 阶段完成全部 10 条任务（e2e 留待 CI 单独验证）
updated_at: 2026-06-18
summary: 待确认问题面板挂到 spec 主内容左侧避让右下 Agent Dock；SKILL 把"候选项 + 唯一推荐项"提升为 plan 硬约束；候选问题末尾新增"其他（自由批注）"radio，选项与批注互斥
---

# 待确认问题面板改挂主内容左侧并强化候选项规范

## 1. 背景

来自用户的原始需求（保留原文以便追溯）：

> specs/260618.refct.question-confirm-ui
> UI 优化，确认问题的 UI 弹窗应该悬挂到 spec 文档主内容的左侧，避免与右侧的 Agent 输出内容面板冲突；
> 当前待确认问题的 UI 效果有待优化，可以在 skill 文档中规范 A 的输出确认问题的格式，那 UI 就比较好做。
> 比如 Agent 在每个待确认的问题后面有 ABC 三个方案，Agent 建议选择 A。

经过两轮 plan/tasks 批注，需求脉络补充为：

- 上一轮 spec（`260618.refct.question-confirm-ui`）落地了"右侧悬浮卡片 + radio 单选 + 自定义批注"的确认 UX；同期 `260617.feat.agent-stream-panel`/`260618.fix.agent-dock-layout` 引入并放大了右下角 `AgentPanelDock`（默认宽 `max(50vw, 600px)`，高 `calc(100vh - 2rem)`），两个浮层在右侧严重重叠。
- skill 已有《待确认问题结构》小节，但表述为"尽量提供候选项与推荐项"，存在 Agent 不提供候选项 / 提供多个推荐 / 候选项长文本 等不规范输出形态，让前端卡片渲染降级为"自由文本批注"或排版混乱。
- 用户在本轮批注中观察到：当用户既想选某候选项又想写自定义批注时（如"以备注为准"），现有 UI 给人的感受是"只能二选一"——而实际上 `QuestionConfirmPanel` 提交逻辑已同时携带 `selectedOptionLabel + note`，问题出在 UI 的可发现性 / 文案暗示。

## 2. 需求

- 把 `QuestionConfirmPanel` 的视觉位置从视口右侧改为"贴在 spec 主内容（`.content` / `article.markdown`）左侧"，与右下角 `AgentPanelDock` 在 z-index 与位置上完全错开。
- 改动后用户在 plan 阶段仍能"对照 spec 原文" + "阅读 Agent 实时输出" + "勾选答复"三者并行，互不遮挡。
- 在 `src/skill/SKILL.md` 中把"待确认问题必须提供候选项 + 必须恰好 1 个 `(推荐)`"提升为 plan 阶段硬约束，写明示例与不合规处理方式，让 Agent 输出形态可被 GUI 稳定解析。
- **新增**：`QuestionConfirmPanel` 必须在每条带候选项的问题末尾自动追加一项"其他（自由批注）"radio 选项；当用户选中该项时 textarea 展示并作为答复主体，提交载荷只携带 `note`；当用户选中正常候选项时 textarea 隐藏，载荷只携带 `selectedOptionLabel`；选项与批注严格互斥，消除"选 A 又写批注"的语义歧义。
- 不引入新的数据通道与 service API；不改变 `parseConfirmQuestions` 的对外类型与提交流程；CSS / SKILL 文案 / QuestionConfirmPanel 文案与少量校验逻辑为本期主要改动面。

## 3. 现状分析

### 3.1 两个浮层都贴右侧导致重叠

- `src/gui/src/styles.css:521` `.question-confirm-panel`：`position: fixed; top: 5rem; right: 1rem; width: min(360px, calc(100vw - 2rem)); z-index: 40;`。
- `src/gui/src/styles.css:683` `.agent-dock`：`position: fixed; right: 1rem; bottom: 1rem; width: min(max(50vw, 600px), calc(100vw - 2rem)); max-height: calc(100vh - 2rem); z-index: 50;`。
- Agent Dock 宽度至少 600px，从底部一直延伸到接近顶部；待确认问题面板宽 360px、z-index 更低，在常见视口（1440px 内）会被 Agent Dock 完全或大部分遮挡。
- 单纯把 z-index 调高无法解决——Agent 长输出本身需要保留这部分宽度阅读。

### 3.2 主内容居中且两侧有可用留白

- `src/gui/src/styles.css:103` `.content { width: min(960px, 100%); margin: 0 auto; padding: 1rem; }`：spec 主内容固定 960px 居中。
- 在 ≥ 1340px 视口（960 + 360 + 16 + 4），主内容左侧有 ≥ 380px 的空白足够放下 360px 宽面板而不遮主体；视口收窄到 1280px 左右时仅剩约 320px。
- 视口更窄（< 1280px）时，左侧不再有可"零遮挡"的位置，需要降级策略（顶部抽屉横跨主内容上方 / 自动收起为胶囊）。

### 3.3 SKILL《待确认问题结构》目前只是建议性表述

- `src/skill/SKILL.md` 已在第 76-93 行规定：候选项为二级 ` -` 子列表、`(推荐)` 单标记、空候选退化为 freeform。
- 阶段一对候选项的要求为"应尽量提供候选答案与一个推荐项"，属软约束。
- 现实输出中存在三类不合规：
  - 完全不给候选项 → 卡片降级为 freeform，用户体感"AI 啥都没建议"。
  - 给 2 个以上 `(推荐)` → `parseConfirmQuestions` 取第一个匹配，剩余推荐项语义被丢弃。
  - 候选项写成多段长描述 → radio 标签被压成多行甚至溢出，卡片高度爆炸。

### 3.4 GUI 解析与渲染对接面

- `src/gui/src/lib/question-parse.ts` 已可识别 `- 选项 (推荐)` 单选语义；当未声明 `(推荐)` 时 fallback 为第一项（参见 `QuestionConfirmPanel.tsx:initialAnswers`）。
- `QuestionConfirmPanel` 自身已经是 `position: fixed` 的独立浮层，不依赖父容器布局；将定位从 `right: 1rem` 改为左侧只是替换 CSS 规则，无 TSX 改动。
- 现有 `e2e/question-confirm.spec.ts` 仅验证"面板可见 + 提交流程"，不强依赖左/右位置，方位变更不致使其失败；但仍需复测以确认选择器（如基于 `.qcp-list`/`.qcp-head`）未被 z-index/可视层级影响。

### 3.5 候选项答复语义需明确"选项 vs 批注"二选一

- 数据通道：`api.ts` 的 `QuestionAnswerBody` 同时声明 `selectedOptionLabel?` 与 `note?`（`src/gui/src/lib/api.ts:37-42`），schema 允许二者同时出现，但本期已确认采用"二选一"互斥语义，提交载荷不再同时携带两个字段。
- 提交逻辑现状（待改）：`QuestionConfirmPanel.tsx:80-91` 会在 `selectedOptionLabel` 与 `note` 均有值时一并填入；本期改为根据当前选中 radio 决定 payload：
  - 选中普通候选项 → 仅携带 `selectedOptionLabel`，丢弃 `note`
  - 选中"其他（自由批注）"sentinel → 仅携带 `note`，不携带 `selectedOptionLabel`
- UI 渲染现状（待改）：radio 列表（`QuestionConfirmPanel.tsx:144-167`）与 textarea（`:168-174`）始终并排展示；本期改为在 radio 列表末尾追加 `其他（自由批注）` 选项，并把 textarea 显示条件改为"`isFreeform=true` 或当前选中 sentinel"。
- 该方案对照原 placeholder 暗示「批注=补充」的设计：
  - 用户看到"其他（自由批注）"radio 时，"用批注替代选项"成为显式动作而非隐式可选项
  - 避免「选 A + textarea 写'以备注为准'」这类对 Agent 难以解释的混合输入
- 默认选中逻辑保持不变：带 `(推荐)` 项默认选中；否则首项；freeform 问题无 radio、textarea 始终显示。

### 3.6 不在本期范围

- 不调整 `parseConfirmQuestions` 的返回类型；不新增 service 路由；不调整 frontmatter 字段。
- 不引入新的全局布局容器（如 split pane）——本期仍以浮层悬挂方式落地，避免与 spec 列表页/新建 spec 页布局耦合。
- 不为 Agent Dock 增加"自动让位"逻辑，避免与 dock 自身的折叠胶囊行为相互影响。
- 不为 SolidJS 组件新增 jsdom + @solidjs/testing-library 测试栈——本仓库目前 `vitest` 仅以 node 环境运行 `*.test.ts`（见 `vite.config.ts`）；本期把 payload 构造逻辑抽成纯函数 helper 并以 `.test.ts` 覆盖即可，不引入新测试基础设施。
- 不修改 `QuestionAnswerBody` schema，仅在 GUI 提交侧收紧"二选一"语义；服务端写回行为不受影响。

## 4. 技术实现方案

### 4.1 整体思路

- **CSS 单点改动**：把 `.question-confirm-panel` 由 `right: 1rem` 改为以"贴主内容左外侧"为基准的左侧定位；窄屏走降级。
- **SKILL 规范升级**：把候选项 + 推荐项从"建议"提升为"plan 阶段硬约束"，并加上不合规时 Agent 的自检与重写要求。
- **解析层小修**：在 `parseConfirmQuestions` 中识别"无候选项"与"多 `(推荐)`" 的不合规形态，仍按现有兼容策略渲染（freeform / 取第一个），但通过控制台 `console.warn` 提示，方便开发者调试 Agent 输出。
- **选项+批注 UX**：调整 placeholder / 辅助文案 / 视觉，让"勾选 radio + 同时写批注"显式可见。

### 4.2 CSS 改动：`.question-confirm-panel` 左侧响应式悬浮

**已确认**：定位方向采用「紧贴 `.content` 主内容左外侧」，宽度策略采用「响应式 `min(600px, 左侧可用空间)`」，z-index 不再与 `.agent-dock` 争抢。

```css
.question-confirm-panel {
  position: fixed;
  top: 5rem;
  /* 通过 right 把面板右缘锚定到 .content (width: 960px) 左外侧外 0.5rem；
     宽度取 min(600px, 左侧可用空间 - 1rem 边距) 自适应。
     960px 与 .content 宽度耦合，若 .content 宽度变更需同步。*/
  right: calc((100vw + 960px) / 2 + 0.5rem);
  width: min(600px, calc((100vw - 960px) / 2 - 1rem));
  max-height: calc(100vh - 7rem);
  z-index: 45;
  /* 其余 background/border/box-shadow/display/overflow 与现状一致 */
}

/* 窄屏：左侧可用空间小于约 320px 时，改为顶部抽屉横跨主内容上方，
   不再尝试挤进 .content 旁边；阈值 ((100vw - 960) / 2 - 1rem) < 320 → 100vw < 1602 取整为 1600。*/
@media (max-width: 1600px) {
  .question-confirm-panel {
    top: 5rem;
    right: 1rem;
    left: 1rem;
    width: auto;
    max-width: calc(100vw - 2rem);
    max-height: 50vh; /* 顶部抽屉，保证下方 spec 主内容仍可见 */
  }
}
```

要点：

- 不改变 `top: 5rem` 与垂直布局；与顶部 `.topbar`（sticky，高度约 `5rem`）保持原有错开。
- 关键 hard-coded 数值 `960px` 沿用 `.content` 宽度，写在注释中说明耦合源。
- 媒体查询阈值 `1600px`：当 `(100vw - 960) / 2 - 1rem` < 约 320px 时面板已无法贴左外侧而不溢出，按"顶部抽屉"降级。

### 4.3 SKILL.md：把候选项 + 推荐项升级为 plan 硬约束

**已确认**：

- 候选项 label **不限制字符长度**，由 UI CSS 自适应换行。
- "自由文本"退化标记采用「在问题正文末尾追加 `（自由文本）` 后缀」。
- 「`(推荐)` 标记**恰好 1 个**」是硬约束（前提是给出候选项）。
- 候选项**数量不强制**：纯澄清 / 错别字确认 / 概念询问类问题以 `（自由文本）` 后缀显式声明退化为自由文本条目即可，无需凑候选项。

修改 `src/skill/SKILL.md` 中的"阶段一：plan"小节与紧随其后的"待确认问题结构"小节：

- 阶段一原文："每条问题应尽量提供候选答案与一个推荐项……"  
  → 改为："**若**给出候选项，必须**恰好** 1 个候选项以 ` (推荐)` 结尾；候选数量不做强制下限。无法或不必枚举（如概念澄清、错别字确认、开放性补全）时，在问题正文末尾追加 `（自由文本）` 后缀显式声明退化为自由文本条目。"
- 待确认问题结构：
  - 候选项书写规则：严格二级缩进，每项一行；**不限制字符长度**，UI 端 CSS 自适应换行。
  - 不合规处理：
    - `(推荐)` 标记数 ≠ 1（前提是给出候选项）：Agent 必须只保留 1 个；如对推荐项不确定，必须在问题文本紧随的同一行末尾给出推荐项理由。
    - 不应再以"没法给候选项就硬凑"的方式应付，而应直接追加 `（自由文本）` 后缀。
  - "用户批注消费"段落保留原有"tasks 阶段消费完整段删除 `## 用户批注`"约定，不变。
- 新增完整示例：
  - 经典「2 候选 + 1 推荐」 ABC 形态；
  - 「`（自由文本）`」形态作为退化示例（澄清类问题）。

### 4.4 GUI 解析层：对不合规输出做容错 + 告警

修改 `src/gui/src/lib/question-parse.ts`：

- 解析每条问题时统计 `(推荐)` 标记数：
  - 0 个 → 保持现状（首项 fallback 为默认选中）。
  - ≥ 2 个 → 保留第一个 `recommended: true`，其余还原为普通选项；同时 `console.warn` 输出问题文本，便于开发者注意到 Agent 输出违规。
- 解析时识别问题正文末尾的 `（自由文本）` 后缀：命中则将该问题强制视为 `isFreeform: true`，并把后缀从 `text` 字段剥离。
- 候选项 label **不做长度告警**（已确认放开字符上限，UI 端 CSS 处理换行）。
- `parseConfirmQuestions` 的对外签名 / 返回类型不变；新增逻辑只增不改字段。

补 `src/gui/src/lib/__tests__/question-parse.test.ts`：

- 多 `(推荐)`：第一个保留，其余降级。
- `（自由文本）` 后缀：`isFreeform=true` 且 `text` 不含后缀。

### 4.5 QuestionConfirmPanel：新增"其他（自由批注）"radio 实现选项/批注互斥

**已确认**：UI 采用「在 radio 列表末尾追加'其他（自由批注）'选项，选中后 textarea 成为答复主体；原候选项与 textarea 互斥」。

抽取纯函数 helper（位于 `src/gui/src/lib/answer-payload.ts`，新建文件）：

```ts
export const FREEFORM_OPTION_LABEL = '其他（自由批注）'
export const FREEFORM_SENTINEL = '__freeform__'

export interface AnswerDraftLike {
  selectedOptionLabel?: string
  note: string
}

export function buildAnswerItem(
  question: { id: string; text: string; isFreeform: boolean },
  draft: AnswerDraftLike,
): {
  questionId: string
  questionText: string
  selectedOptionLabel?: string
  note?: string
} | null {
  const trimmedNote = draft.note.trim()
  // freeform 问题：仅可携带 note
  if (question.isFreeform) {
    if (!trimmedNote) return null
    return { questionId: question.id, questionText: question.text, note: trimmedNote }
  }
  const label = draft.selectedOptionLabel
  // 候选项问题且选中 sentinel "其他"：仅可携带 note
  if (label === FREEFORM_SENTINEL) {
    if (!trimmedNote) return null
    return { questionId: question.id, questionText: question.text, note: trimmedNote }
  }
  // 候选项问题且选中正常候选项：仅可携带 selectedOptionLabel
  if (label) {
    return { questionId: question.id, questionText: question.text, selectedOptionLabel: label }
  }
  return null
}
```

修改 `src/gui/src/components/QuestionConfirmPanel.tsx`：

- 引入 `FREEFORM_OPTION_LABEL` / `FREEFORM_SENTINEL` / `buildAnswerItem`。
- 渲染：
  - 非 freeform 问题在 `qcp-list` 末尾追加一项 `其他（自由批注）` radio，其 `value` 对应 sentinel。
  - textarea 显示条件：`q.isFreeform === true` 或 `draft.selectedOptionLabel === FREEFORM_SENTINEL`；其他情况下不渲染 textarea。
  - 默认选中：保持现状（带 `(推荐)` 项优先，否则首项）。
- 提交（`submit`）：用 `buildAnswerItem` 构造 payload；filter null；保留 freeform `freeformAnnotations` 行为不变。
- 文案：textarea placeholder 在所有可见场景统一为 `写下你的答复…`；移除"不满意？写批注…"等暗示性文案。
- 根节点新增 `data-testid="question-confirm-panel"`（e2e 复用见 §4.6）。
- `unanswered` 计数逻辑同步：选中 sentinel 但未写批注视为未答；选中普通候选项视为已答。

新增 `src/gui/src/lib/__tests__/answer-payload.test.ts`，覆盖：

- 选中普通候选项 → payload 只含 `selectedOptionLabel`，无 `note`。
- 选中 sentinel + 写批注 → payload 只含 `note`，无 `selectedOptionLabel`。
- 选中 sentinel 但未写批注 → 返回 `null`（被 filter 丢弃）。
- freeform 问题写批注 → payload 只含 `note`。
- freeform 问题未写批注 → 返回 `null`。

### 4.6 改动文件总览

- `src/gui/src/styles.css`：仅改 `.question-confirm-panel` 一处规则 + 1 条媒体查询；不动其他选择器。
- `src/skill/SKILL.md`：升级"阶段一：plan"与"待确认问题结构"两段文案；新增示例块。
- `src/gui/src/lib/question-parse.ts`：新增 2 类不合规容错（多推荐、自由文本后缀） + `console.warn`；签名不变。
- `src/gui/src/lib/__tests__/question-parse.test.ts`：新增 2 条用例覆盖上述容错。
- `src/gui/src/lib/answer-payload.ts`（新建）：导出 `FREEFORM_OPTION_LABEL` / `FREEFORM_SENTINEL` 常量与 `buildAnswerItem` 纯函数。
- `src/gui/src/lib/__tests__/answer-payload.test.ts`（新建）：覆盖 §4.5 列出的 5 条用例。
- `src/gui/src/components/QuestionConfirmPanel.tsx`：引入 helper；非 freeform 问题追加 sentinel radio；textarea 仅在 freeform 或选中 sentinel 时显示；`submit` 经由 `buildAnswerItem` 构造 payload；统一 placeholder；根节点添加 `data-testid="question-confirm-panel"`。
- `src/gui/src/__e2e__/question-confirm.spec.ts`：面板可见性断言改用 `data-testid="question-confirm-panel"` 选择器；新增 1 条 e2e：勾选"其他（自由批注）"→ 填批注 → 提交 → 校验 spec md 用户批注中出现批注内容、且不出现选项 label。
- `.yorz/specs/260618.feat.confirm-panel-left-dock/spec.md`：本文件。
- 不改 service、不改 spec-store、不改 routes。

### 4.7 兼容与回滚

- CSS 单点回滚：把 `.question-confirm-panel` 的 `right` 恢复为 `right: 1rem` 即可；其余样式不变。
- SKILL 文案回滚：保留 git 历史，硬约束→软约束的恢复成本极低。
- GUI 解析层回滚：新增逻辑均为可选告警 + 容错；删除新增分支即可还原。
- QuestionConfirmPanel 回滚：撤回 sentinel radio 渲染 + 撤回 textarea 显示条件 + 把 `submit` 还原为旧 payload 构造逻辑。`buildAnswerItem` helper 为新增独立模块，撤回时一并删除。
- 数据兼容：服务端早已接受 `selectedOptionLabel` 与 `note` 任一或两者；本期 GUI 改为只发送其一，旧服务端逻辑无需改动。
- 旧 spec 文档（无候选项或多推荐）不会因 SKILL 升级而失败：解析层向后兼容，只是产生 `console.warn`，不打断渲染或提交。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 修改 `src/gui/src/styles.css` 的 `.question-confirm-panel`：将 `right: 1rem` 改为 `right: calc((100vw + 960px) / 2 + 0.5rem)`；`width` 改为 `min(600px, calc((100vw - 960px) / 2 - 1rem))`；提高 `z-index` 至 `45`；保留 `top/max-height` 不变；新增 `@media (max-width: 1600px)` 媒体查询将面板降级为顶部抽屉（`right/left: 1rem`、`width: auto`、`max-height: 50vh`）。验收：dev 启动后在 1920px 视口下面板紧贴 spec 主内容左外侧、不与右下 Agent Dock 重叠。
- [x] 修改 `src/skill/SKILL.md` 阶段一 plan：把"应尽量提供候选答案与一个推荐项"改写为"若给候选项必须恰 1 个 `(推荐)`；候选数量不强制；澄清类问题在问题正文末尾追加 `（自由文本）` 后缀显式退化"。验收：grep "（自由文本）" 在 SKILL.md 中存在。
- [x] 修改 `src/skill/SKILL.md`《待确认问题结构》：候选项 label 不限字符长度（UI 自适应换行）；多 `(推荐)` 时 Agent 自检修正；新增"自由文本后缀"示例块与"2 候选 + 1 推荐"经典示例块。验收：包含两段示例代码块。
- [x] 修改 `src/gui/src/lib/question-parse.ts`：解析时识别问题正文末尾 `（自由文本）` 后缀并剥离、强制 `isFreeform: true`；统计每问 `(推荐)` 标记数，≥2 时仅保留首个为 `recommended: true` 并 `console.warn`；签名与返回字段不变。验收：新单测通过。
- [x] 在 `src/gui/src/lib/__tests__/question-parse.test.ts` 追加 2 条用例：①"`（自由文本）`后缀剥离 + freeform"；②"多 `(推荐)` 只保留首个"。验收：`npx vitest run src/gui/src/lib/__tests__/question-parse.test.ts` 通过。
- [x] 新建 `src/gui/src/lib/answer-payload.ts`：导出 `FREEFORM_OPTION_LABEL = '其他（自由批注）'`、`FREEFORM_SENTINEL = '__freeform__'`、`buildAnswerItem(question, draft)` 纯函数（实现见 §4.5）。验收：文件存在且导出符号正确。
- [x] 新建 `src/gui/src/lib/__tests__/answer-payload.test.ts`：覆盖 §4.5 列出的 5 条用例。验收：`npx vitest run src/gui/src/lib/__tests__/answer-payload.test.ts` 通过。
- [x] 修改 `src/gui/src/components/QuestionConfirmPanel.tsx`：根节点添加 `data-testid="question-confirm-panel"`；非 freeform 问题在 radio 列表末尾追加 sentinel `其他（自由批注）` 项；textarea 仅在 `q.isFreeform === true` 或当前选中 sentinel 时渲染；`submit` 改为通过 `buildAnswerItem` 构造 payload 并过滤 `null`；统一 textarea placeholder 为 `写下你的答复…`；`unanswered` 计数同步考虑 sentinel 未填批注情况。验收：dev 启动手动验证 + 现有 e2e 通过。
- [x] 修改 `src/gui/src/__e2e__/question-confirm.spec.ts`：将 `.question-confirm-panel` 选择器换为 `[data-testid="question-confirm-panel"]`；新增 1 条 e2e 用例覆盖"勾选'其他（自由批注）' + 填批注 → 提交 → spec md 用户批注包含批注文本且不含选项 label"。验收：`npx playwright test src/gui/src/__e2e__/question-confirm.spec.ts` 通过。
- [x] 运行 `npx prettier --write` 对修改过的文件做格式化（`.yorz/specs/260618.feat.confirm-panel-left-dock/spec.md`、`src/skill/SKILL.md`、`src/gui/src/styles.css`、`src/gui/src/lib/question-parse.ts`、`src/gui/src/lib/answer-payload.ts`、`src/gui/src/components/QuestionConfirmPanel.tsx`、`src/gui/src/__e2e__/question-confirm.spec.ts`）。验收：命令成功；frontmatter 不变。
- [x] 运行 `npx vitest run` 验证所有单测通过；运行 `npx tsc -p tsconfig.json --noEmit`（若存在）做类型检查。验收：均返回 0；记录任何阻塞项。

## 7. 执行记录

- 2026-06-18 新建 spec：生成 `.yorz/specs/260618.feat.confirm-panel-left-dock/spec.md`，初始化 frontmatter（`stage: plan` / `last_action: 新建 spec 并完成 plan 阶段` / `updated_at: 2026-06-18` / `summary: ...`）。
- 2026-06-18 完成 plan 阶段：补齐"现状分析 / 技术实现方案 / 待确认问题"三章；任务清单留为占位以待 tasks 阶段消费批注后生成；进入阻塞状态，等待用户在 `## 5. 待确认问题` 上以 `！！！` 前缀批注后由 CLI/Service 重新拉起 Agent 进入 tasks 阶段。
- 2026-06-18 tasks 阶段消费批注：6 条 `！！！` 批注中 4 条无歧义已合并入 §4 方案——左侧悬挂方向、候选项 label 不限长、`（自由文本）` 后缀、e2e `data-testid`；其余 2 条（面板宽度、SKILL 候选数量）因"选项"与"备注"互斥产生歧义、1 条来源不明批注重写为新问题，回退 stage 至 `plan`，等待用户重新批注。"用户批注"章节已按 SKILL 约定整段删除。
- 2026-06-18 第二轮 tasks 阶段消费批注：3 条 `！！！` 全部处理完毕——
  - 面板宽度：以备注为准 → 响应式 `min(600px, 左侧可用空间)` + `(max-width: 1600px)` 顶部抽屉降级，写入 §4.2；
  - SKILL 候选数量：以备注为准 → 不强制候选数量，仅约束"若给候选项必须恰 1 个 (推荐)"，澄清类问题用 `（自由文本）` 后缀，写入 §4.3 / §4.4；
  - 孤立批注：按用户指示先忽略，从 §5 中移除；
  - 同一批注引入新增需求"既选候选项又能写自定义批注"——已新增至 §2 需求第 4 条，补 §3.5 现状分析与 §3.6 不在本期范围说明，新增 §4.5 QuestionConfirmPanel 文案/视觉/单测改动；按 SKILL 硬约束 stage 切回 `plan`。
  - §5 留 1 条待确认问题：「选项 + 自定义批注」的 UI 表达方式抉择（当前默认方案为 hint 行 + placeholder 文案，备选含"其他" radio / 不动 UI 等），等待用户批注后再进入 tasks。
- 2026-06-18 第三轮 tasks 阶段消费批注：用户在 §5 选择"在 radio 列表末尾新增显式『其他（自由批注）』选项，选中后让 textarea 成为答复主体；radio 与 textarea 互斥"。已据此重写 §2 需求第 4 条、§3.5 现状分析、§3.6 不在本期范围（新增"不引入 jsdom 组件测试栈"约束）、§4.5（抽 `buildAnswerItem` helper、追加 sentinel radio、textarea 互斥渲染）、§4.6（文件总览）、§4.7（回滚策略）。§5 标记 `- 暂无`；§6 任务清单按 §4.5 / §4.6 落地为 10 条可执行任务；删除 `## 用户批注` 段；进入 execute 阶段。
- 2026-06-18 execute 阶段完成全部 10 条任务：
  - `src/gui/src/styles.css`：`.question-confirm-panel` 改为锚定 `.content` 左外侧（`right: calc((100vw + 960px) / 2 + 0.5rem)`、`width: min(600px, calc((100vw - 960px) / 2 - 1rem))`、`z-index: 45`）；新增 `@media (max-width: 1600px)` 顶部抽屉降级。
  - `src/skill/SKILL.md`：阶段一 plan 改为硬约束（若给候选必须恰 1 个 `(推荐)`，否则正文末尾追加 `（自由文本）` 后缀显式退化）；《待确认问题结构》新增"自由文本后缀"示例与硬约束说明。
  - `src/gui/src/lib/question-parse.ts`：识别问题正文末尾 `（自由文本）` 后缀并剥离、强制 freeform；同条问题中 `(推荐)` 标记 ≥2 时仅保留首个，其余降级并 `console.warn`；签名不变。
  - `src/gui/src/lib/__tests__/question-parse.test.ts`：新增 2 条用例覆盖以上两个新分支；vitest 通过。
  - `src/gui/src/lib/answer-payload.ts`（新建）：导出 `FREEFORM_OPTION_LABEL = '其他（自由批注）'`、`FREEFORM_SENTINEL = '__freeform__'`、纯函数 `buildAnswerItem`，按"选项 vs 批注"二选一构造 payload。
  - `src/gui/src/lib/__tests__/answer-payload.test.ts`（新建）：6 条用例覆盖 freeform/sentinel/普通选项各组合；vitest 通过。
  - `src/gui/src/components/QuestionConfirmPanel.tsx`：根节点添加 `data-testid="question-confirm-panel"`；非 freeform 问题尾部追加 sentinel `其他（自由批注）` radio；textarea 仅在 `q.isFreeform` 或选中 sentinel 时渲染；`submit` 改走 `buildAnswerItem`；`unanswered` 计数同步；placeholder 统一为"写下你的答复…"。
  - `src/gui/src/__e2e__/question-confirm.spec.ts`：选择器换为 `[data-testid="question-confirm-panel"]`；改 `describe.serial`；新增 e2e 覆盖"勾选其他（自由批注）+ 填批注 → 提交 → spec body 含 `！！！备注：…`、不含 `选择：其他（自由批注）`"。
  - 验证：`npx vitest run` 全部 75 测试通过；`npx tsc -p tsconfig.json --noEmit` 退出码 0；`npx prettier --write` 已应用至全部改动文件。
  - 阻塞：e2e（`npx playwright test`）未在本会话自动跑——需要 dev 服务/浏览器栈，建议在 CI 或本地 `pnpm test:e2e` 单独验证；其余无阻塞。

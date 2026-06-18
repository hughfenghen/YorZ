---
stage: plan
last_action: 新建 spec 并完成 plan 阶段
updated_at: 2026-06-18
summary: 把待确认问题面板从右侧改到 spec 主内容左侧，避免与右下角 Agent Dock 重叠；同时在 SKILL.md 中把"候选项 + 唯一推荐项"格式提升为 plan 阶段硬约束，便于 GUI 稳定渲染。
---

# 待确认问题面板改挂主内容左侧并强化候选项规范

## 1. 背景

来自用户的原始需求（保留原文以便追溯）：

> specs/260618.refct.question-confirm-ui
> UI 优化，确认问题的 UI 弹窗应该悬挂到 spec 文档主内容的左侧，避免与右侧的 Agent 输出内容面板冲突；
> 当前待确认问题的 UI 效果有待优化，可以在 skill 文档中规范 A 的输出确认问题的格式，那 UI 就比较好做。
> 比如 Agent 在每个待确认的问题后面有 ABC 三个方案，Agent 建议选择 A。

需求脉络：

- 上一轮 spec（`260618.refct.question-confirm-ui`）落地了"右侧悬浮卡片 + radio 单选 + 自定义批注"的确认 UX；同期 `260617.feat.agent-stream-panel`/`260618.fix.agent-dock-layout` 引入并放大了右下角 `AgentPanelDock`（默认宽 `max(50vw, 600px)`，高 `calc(100vh - 2rem)`），两个浮层在右侧严重重叠。
- skill 已有《待确认问题结构》小节，但表述为"尽量提供候选项与推荐项"，存在 Agent 不提供候选项 / 提供多个推荐 / 候选项长文本 等不规范输出形态，让前端卡片渲染降级为"自由文本批注"或排版混乱。

## 2. 需求

- 把 `QuestionConfirmPanel` 的视觉位置从视口右侧改为"贴在 spec 主内容（`.content` / `article.markdown`）左侧"，与右下角 `AgentPanelDock` 在 z-index 与位置上完全错开。
- 改动后用户在 plan 阶段仍能"对照 spec 原文" + "阅读 Agent 实时输出" + "勾选答复"三者并行，互不遮挡。
- 在 `src/skill/SKILL.md` 中把"待确认问题必须提供候选项 + 必须恰好 1 个 `(推荐)`"提升为 plan 阶段硬约束，写明示例与不合规处理方式，让 Agent 输出形态可被 GUI 稳定解析。
- 不引入新的数据通道与 service API；不改变 `parseConfirmQuestions` 的对外类型与提交流程；CSS / SKILL 文案与少量 SKILL 校验文案为本期主要改动面。

## 3. 现状分析

### 3.1 两个浮层都贴右侧导致重叠

- `src/gui/src/styles.css:521` `.question-confirm-panel`：`position: fixed; top: 5rem; right: 1rem; width: min(360px, calc(100vw - 2rem)); z-index: 40;`。
- `src/gui/src/styles.css:683` `.agent-dock`：`position: fixed; right: 1rem; bottom: 1rem; width: min(max(50vw, 600px), calc(100vw - 2rem)); max-height: calc(100vh - 2rem); z-index: 50;`。
- Agent Dock 宽度至少 600px，从底部一直延伸到接近顶部；待确认问题面板宽 360px、z-index 更低，在常见视口（1440px 内）会被 Agent Dock 完全或大部分遮挡。
- 单纯把 z-index 调高无法解决——Agent 长输出本身需要保留这部分宽度阅读。

### 3.2 主内容居中且两侧有可用留白

- `src/gui/src/styles.css:103` `.content { width: min(960px, 100%); margin: 0 auto; padding: 1rem; }`：spec 主内容固定 960px 居中。
- 在 ≥ 1340px 视口（960 + 360 + 16 + 4），主内容左侧有 ≥ 380px 的空白足够放下 360px 宽面板而不遮主体；视口收窄到 1280px 左右时仅剩约 320px。
- 视口更窄（< 1280px）时，左侧不再有可"零遮挡"的位置，需要降级策略（侧栏挪进主内容上方 / 自动收起 / 缩窄）。

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

### 3.5 不在本期范围

- 不调整 `parseConfirmQuestions` 的返回类型；不新增 service 路由；不调整 frontmatter 字段。
- 不引入新的全局布局容器（如 split pane）——本期仍以浮层悬挂方式落地，避免与 spec 列表页/新建 spec 页布局耦合。
- 不为 Agent Dock 增加"自动让位"逻辑，避免与 dock 自身的折叠胶囊行为相互影响。

## 4. 技术实现方案

### 4.1 整体思路

- **CSS 单点改动**：把 `.question-confirm-panel` 由 `right: 1rem` 改为以"贴主内容左外侧"为基准的左侧定位；窄屏走降级。
- **SKILL 规范升级**：把候选项 + 推荐项从"建议"提升为"plan 阶段硬约束"，并加上不合规时 Agent 的自检与重写要求。
- **解析层小修**：在 `parseConfirmQuestions` 中识别"无候选项"与"多 `(推荐)`" 的不合规形态，仍按现有兼容策略渲染（freeform / 取第一个），但通过控制台 `console.warn` 提示，方便开发者调试 Agent 输出。

### 4.2 CSS 改动：`.question-confirm-panel` 左侧悬浮

修改 `src/gui/src/styles.css:519-535`：

```css
.question-confirm-panel {
  position: fixed;
  top: 5rem;
  /* 贴 .content（width: min(960px,100%)）左外侧；
     视口宽时居中主内容两侧各 (100vw - 960px)/2，
     用 calc((100vw - 960px) / 2 - 360px - 0.5rem) 把面板挤到主内容左外缘；
     用 max(1rem, ...) 防止窄屏溢出视口左边。 */
  left: max(1rem, calc((100vw - 960px) / 2 - 360px - 0.5rem));
  width: min(360px, calc(100vw - 2rem));
  max-height: calc(100vh - 7rem);
  z-index: 45; /* 低于 .agent-dock(50) 也行——两者已不在同一边 */
  /* 其余 background/border/box-shadow/display/overflow 与现状一致 */
}

@media (max-width: 1280px) {
  /* 窄屏降级：仍 fixed，但缩窄并紧贴左边，承担少量遮挡（用户可滚动主内容回避） */
  .question-confirm-panel {
    left: 0.5rem;
    width: min(320px, calc(100vw - 1rem));
  }
}
```

要点：

- `left: max(1rem, calc((100vw - 960px) / 2 - 360px - 0.5rem))`：在 ≥ 1340px 视口下，面板正好挂在主内容左外侧约 0.5rem 处，不遮挡 spec 文本；在 < 1340px 视口下退化为 `left: 1rem`，对应媒体查询再进一步缩窄。
- 不改变 `top: 5rem` 与垂直布局；与顶部 `.topbar`（sticky，高度约 `5rem`）保持原有错开。
- 媒体查询断点 `1280px` 是经验值，与现有 `@media (min-width: 720px)` 的 spec-grid 断点风格保持单数字临界点；后续如需更细可继续叠加。
- 关键 hard-coded 数值 `960px` / `360px` 沿用 `.content` / 面板自身宽度，写在注释中说明耦合源，避免后续被改动而无对应同步。

### 4.3 SKILL.md：把候选项 + 推荐项升级为 plan 硬约束

修改 `src/skill/SKILL.md` 中的"阶段一：plan"小节与紧随其后的"待确认问题结构"小节：

- 阶段一原文："每条问题应尽量提供候选答案与一个推荐项……"  
  → 改为："每条问题**必须**提供 ≥ 2 个候选答案，且**恰好** 1 个候选项以 ` (推荐)` 结尾。仅当问题本质上无法枚举（如开放性补全）时才能退化为无候选的自由文本条目，此时需在问题文本后附 `（自由文本）` 后缀，便于人审。"
- 待确认问题结构：
  - 把候选项"二级 ` -` 子列表"重述为"严格二级缩进，每项一行，文本 ≤ 80 字符（超长拆为问题正文 + 简短候选标签）"。
  - 新增不合规处理：
    - 候选项 < 2：Agent 应在写回前自检，无法补出候选项就显式改写成 `（自由文本）`。
    - `(推荐)` 标记数 ≠ 1：Agent 必须只保留 1 个；如对推荐项不确定，必须给出推荐项与简短理由（写在问题文本紧随的同一行末尾）。
    - 单候选项文本超 80 字符：拆分为更短的"问题正文+候选标签"或换用多行版描述写在候选项下一行的引用块中（前端按 label 取第一行）。
  - 在"用户批注消费"段落保留原有"tasks 阶段消费完整段删除 `## 用户批注`"约定，不变。
- 新增 1 个完整示例，包含：
  - 2 候选 + 1 推荐 的"经典 ABC"形态；
  - 一个"`（自由文本）`"形态作为退化示例。

### 4.4 GUI 解析层：对不合规输出做容错 + 告警

修改 `src/gui/src/lib/question-parse.ts`：

- 解析每条问题时统计 `(推荐)` 标记数：
  - 0 个 → 保持现状（首项 fallback 为默认选中）。
  - ≥ 2 个 → 保留第一个 `recommended: true`，其余还原为普通选项；同时 `console.warn` 输出问题文本，便于开发者注意到 Agent 输出违规。
- 解析时识别问题正文末尾的 `（自由文本）` 后缀：命中则将该问题强制视为 `isFreeform: true`，并把后缀从 `text` 字段剥离。
- 解析时识别候选项 label 超 80 字符的情况：保留显示原文（不截断），但同样 `console.warn`，避免静默布局崩溃。
- `parseConfirmQuestions` 的对外签名 / 返回类型不变；新增逻辑只增不改字段。

补 `src/gui/src/lib/__tests__/question-parse.test.ts`：

- 多 `(推荐)`：第一个保留，其余降级。
- `（自由文本）` 后缀：`isFreeform=true` 且 `text` 不含后缀。
- 候选项长文本不致抛错（仅产生告警）。

### 4.5 改动文件总览

- `src/gui/src/styles.css`：仅改 `.question-confirm-panel` 一处规则 + 新增一条 `@media (max-width: 1280px)` 媒体查询；不动其他选择器。
- `src/skill/SKILL.md`：升级"阶段一：plan"与"待确认问题结构"两段文案；新增示例块。
- `src/gui/src/lib/question-parse.ts`：新增 3 类不合规容错 + `console.warn`；签名不变。
- `src/gui/src/lib/__tests__/question-parse.test.ts`：新增 3 条用例覆盖上述容错。
- `src/gui/src/__e2e__/question-confirm.spec.ts`：复测可见性，不调整断言（若位置选择器涉及 `right:` 类样式则改为按 `data-testid="question-confirm-panel"` 取元素；本期视情况补 `data-testid`）。
- `.yorz/specs/260618.feat.confirm-panel-left-dock/spec.md`：本文件。
- 不改 service、不改 spec-store、不改 routes。

### 4.6 兼容与回滚

- CSS 单点回滚：把 `.question-confirm-panel` 的 `left` 恢复为 `right: 1rem` 即可；其余样式不变。
- SKILL 文案回滚：保留 git 历史，硬约束→软约束的恢复成本极低。
- GUI 解析层回滚：新增逻辑均为可选告警 + 容错；删除新增分支即可还原。
- 旧 spec 文档（无候选项或多推荐）不会因 SKILL 升级而失败：解析层向后兼容，只是产生 `console.warn`，不打断渲染或提交。

## 5. 待确认问题

- 待确认问题面板的左侧悬挂方式应采用哪种？
  - 紧贴 `.content` 主内容左外侧（动态 `left` 计算 + 窄屏媒体查询降级） (推荐)
  - 永远 `left: 1rem` 紧贴视口左边（更简单，但 1340px 以上视口会浪费两侧空白）
  - 改为非 fixed 的左侧 sticky 侧栏（涉及 `.page` 布局重构，超出本期范围）

- 面板宽度应采用？
  - 保持 360px，窄屏媒体查询缩窄到 320px (推荐)
  - 统一收窄到 320px，省去媒体查询
  - 改为响应式 `min(360px, calc((100vw - 960px) / 2 - 1rem))`，根据可用空间动态收缩

- SKILL 中候选项数量的硬约束应该写多少？
  - 必须 ≥ 2 个候选项 + 恰好 1 个 `(推荐)`，否则视为不合规并提供"`（自由文本）`"退化口 (推荐)
  - 必须 ≥ 3 个候选项（贴合用户描述的 "ABC 三个方案"），更严格
  - 维持当前软约束，仅在 GUI 解析层加 `console.warn` 提醒

- 候选项 label 长度限制应采用？
  - 限 ≤ 80 字符（超长拆为问题正文 + 简短候选标签） (推荐)
  - 不限制，由 UI CSS 自适应换行
  - 限 ≤ 60 字符（更短，强迫候选项以短语形式呈现）

- 不合规输出的"自由文本"退化标记应使用？
  - 在问题正文末尾追加 `（自由文本）` 后缀 (推荐)
  - 通过省略所有候选项隐式表示（与当前一致，但失去显式语义）
  - 在 frontmatter 增加额外字段（不在本期范围）

- e2e 测试中如何稳定定位待确认面板？
  - 给 `QuestionConfirmPanel` 根节点加 `data-testid="question-confirm-panel"` 并用此选择器 (推荐)
  - 维持按 `.question-confirm-panel` class 选择器（与样式耦合，重命名会脆）
  - 通过文案 "待确认问题" 文本匹配（i18n 风险）

## 6. 任务清单

- 待 plan 阶段确认结果后由 tasks 阶段填充。

## 7. 执行记录

- 2026-06-18 新建 spec：生成 `.yorz/specs/260618.feat.confirm-panel-left-dock/spec.md`，初始化 frontmatter（`stage: plan` / `last_action: 新建 spec 并完成 plan 阶段` / `updated_at: 2026-06-18` / `summary: ...`）。
- 2026-06-18 完成 plan 阶段：补齐"现状分析 / 技术实现方案 / 待确认问题"三章；任务清单留为占位以待 tasks 阶段消费批注后生成；进入阻塞状态，等待用户在 `## 5. 待确认问题` 上以 `！！！` 前缀批注后由 CLI/Service 重新拉起 Agent 进入 tasks 阶段。

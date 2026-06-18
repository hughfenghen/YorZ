---
stage: execute
last_action: 完成任务清单全部任务
updated_at: 2026-06-18
summary: 重构 spec 待确认问题的确认 UX：以悬浮在文档右侧的卡片列表呈现，每张卡片用 radio 选择 AI 推荐答案、不满意可自填批注，批量提交后写回 spec 的 ## 用户批注 章节并自动运行 Agent。
---

# 重构 spec 待确认问题的确认 UI

## 1. 背景

重构 skill / spec 流程中问题确认的交互设计；
我期望通过 radio 或者 check box UI 来确认问题，默认选中提供 AI 的建议方案；
如果用户对所有候选方案都不满意，可以在输入框中输入自己对确认问题的批注；
我希望待确认的问题可以做成卡片列表，放在弹窗中，悬浮在文档的右侧，这样用户就可以对照文档来理解需确认的问题；
多个问题的方案确认最终一次性提交，更新 spec 文档；
如果实现有困难，可以新增一个 Agent 的前序步骤，让 AI 将确认结果合入 spec 文档。

## 2. 需求

- 让用户通过结构化 UI（radio）对 `## 待确认问题` 中的条目一次性给出答复，替代当前"为每个问题手动划选 + 写自由文本批注"的低效流程。
- 默认选中 AI 推荐方案，让"接受默认"的高频路径只剩一次点击。
- 保留"自定义批注"逃生口，候选答案都不满意时仍可输入文字补充；候选项与自定义批注允许并存，用于补齐信息。
- 待确认问题作为始终展开、浮在文档右侧的卡片列表呈现，方便对照原文。
- 多个问题在一次提交内统一更新到 spec md，使下一轮 Agent 能在同一 tasks 轮次内消费所有答复；提交后立即触发运行 Agent。
- 若直写 spec 实现复杂，可由一个轻量 Agent 前序步骤负责把结构化答复合入 spec（首版仅作为规格保留，不实现代码）。

## 3. 现状分析

### 3.1 待确认问题的产出与消费

- skill 在 plan 阶段把每个待确认问题以无序列表 `- 问题文本` 写入 `## 待确认问题`；目前没有候选答案、没有推荐项、没有结构化标记。
- skill tasks 阶段统一扫描全文 `！！！` 批注，再将其意图合入技术方案与任务清单；批注本身并不与具体问题强绑定，只能靠引用文字粗略关联。
- frontmatter `stage` 在追加批注时由 service 强制回退为 `plan`，由 CLI/Service 重新拉起 Agent 推进。

### 3.2 GUI 现有批注链路

- `src/gui/src/pages/SpecDetail.tsx` 渲染 spec md；
- `src/gui/src/lib/selection.ts` 监听文本选区，输出 `{ text, rect, sectionPath }`；
- `src/gui/src/components/SelectionMenu.tsx` 在选区上弹出"批注 / 解释"小工具栏；
- `src/gui/src/components/AnnotatePopover.tsx` 是一次只能填一条批注的浮层，提交后调 `api.appendAnnotation`；
- `src/gui/src/lib/api.ts` 的 `appendAnnotation` POST `/api/specs/:id/inputs`，单条写入。
- 现有 `AnnotatePopover` 只能针对"任意文本选区 + 自由文本批注"使用，不知道哪些选区对应"待确认问题"。

### 3.3 service / 数据写入侧

- `src/service/spec-store.ts` 的 `appendAnnotation` 把单条批注追加为：
  ```
  > <sectionPath> 中 "<quote>"
  >
  > ！！！<note>
  ```
  写在文档最末尾，frontmatter 同步置回 `stage: plan`。
- `src/service/routes/specs.ts` 的 `POST /specs/:id/inputs` 仅支持单条 `annotate`，无批量入口。
- service 当前并不解析 `## 待确认问题` 的结构。

### 3.4 当前痛点

- 用户必须为每条问题手动划选 + 输入文字，N 个问题需要 N 次操作，且无默认值可点。
- AI 推荐答案没有体现，用户被迫从零思考所有选项。
- 多次写入会触发多次 file watcher 事件，体验上"答 1 题、刷一次"。
- 与原文对照困难：浮层挂在选区上，而非贴在文档侧栏，且只能看到一个浮层。

## 4. 技术实现方案

### 4.1 整体思路

引入"结构化的待确认问题"约定 + 右侧悬浮卡片列表 + 批量提交接口，三件套相互支撑：

1. **skill 约定输出结构**：plan 阶段把每个问题写成"问题 + 候选答案（含推荐项）"的嵌套 markdown。
2. **GUI 解析并以卡片列表呈现**：始终 fixed 展开在文档右侧；radio 单选 + 可选自定义批注一次性收集；同时把现有选区批注收敛到该面板中。
3. **批量写回 spec**：service 暴露一个 batch annotate 接口，把结构化结果写入 spec 的 `## 用户批注` 章节，并立即拉起运行 Agent。

### 4.2 待确认问题的 markdown 约定（skill 演进）

在 `## 待确认问题` 章节下，每条问题采用如下结构（候选项为子列表，推荐项以 `(推荐)` 标记）：

```
- 候选答案的展现形式应采用哪种？
  - 嵌套子列表
  - 表格 (推荐)
  - 自定义 YAML 块
```

- 推荐项使用文末 ` (推荐)` 后缀标记，恰好 1 个（不引入"多选"概念，全部按单选处理）。
- 没有候选项的问题视为"自由文本批注"，卡片只渲染输入框，无 radio。
- 兼容：若文档历史只有 `- 问题文本`，前端按"自由文本批注"卡片渲染，保持向后兼容。
- SKILL.md 需补一节《待确认问题结构》说明，且在 plan 阶段强制输出候选项（无可枚举答案时退化为自由文本）。

### 4.3 解析层（首版放在 GUI 侧）

- 在 `src/gui/src/lib/question-parse.ts` 新增 `parseConfirmQuestions(body: string): ConfirmQuestion[]`：
  ```ts
  interface ConfirmQuestion {
    id: string // 由问题文本 hash + index 生成，幂等
    text: string
    options: { id: string; label: string; recommended: boolean }[]
    isFreeform: boolean // 没有候选项时为 true
  }
  ```
- 解析从 `## 待确认问题` 章节正文里抽取一级 `- ` 条目作为问题，其下的二级 ` -` 子列表作为候选项；带 ` (推荐)` 后缀者标记为默认选中。
- 首版只在 GUI 渲染时解析，service 不感知问题结构。
- 后续如需 CLI / 其他客户端复用，再将解析模块上移至 service（接口保持稳定）。

### 4.4 GUI 展示层

- 新增组件 `src/gui/src/components/QuestionConfirmPanel.tsx`：position fixed 在视口右侧，宽 ~360px，最大高度 `calc(100vh - X)`，内部纵向滚动；始终展开，不做收起折叠。
- 渲染条件：spec stage 为 `plan` 且解析出至少 1 个非"暂无"的待确认问题。其他阶段或无问题时不渲染。
- 每张卡片：
  - 标题：问题文本（可附章节锚点链接，点击滚动到对应位置）
  - 候选项：radio 单选；无候选项时不渲染 radio 区
  - 默认勾选：标记 `(推荐)` 的候选项；recommended 缺失时 fallback 为第一项
  - 「不满意？写批注」输入框默认展开为可选区域；勾选候选项与自定义批注允许同时存在（同时存在时一起写入）
- 顶栏：未答题计数 + 「全部使用推荐」快捷按钮 + 「提交全部」主按钮（提交后立即触发运行 Agent）。
- 与现有 `SelectionMenu`/`AnnotatePopover` 协作：保留 `SelectionMenu` 入口；点击"批注"后不再单条 POST，而是把 `{ sectionPath, quote, note }` 作为一张"自由批注卡片"追加到 `QuestionConfirmPanel` 的本地状态中，跟着「提交全部」一起写入。
- 面板状态（卡片答复、自定义批注、追加的选区批注）使用组件内 signal 维护；spec 重新加载（mtime 变更）时若结构未变则保留草稿，否则清空并提示。

### 4.5 提交路径（首选：直写 `## 用户批注` 章节）

新增端点 `POST /api/specs/:id/questions/answers`，请求体：

```json
{
  "answers": [
    {
      "questionId": "...",
      "questionText": "...",
      "selectedOptionLabel": "选项 A",
      "note": "可选自定义批注"
    }
  ],
  "freeformAnnotations": [{ "sectionPath": "...", "quote": "...", "note": "..." }]
}
```

service 行为：

1. 读 spec md。
2. 组装一段 markdown 块：在文档末尾追加（或更新）一个二级标题 `## 用户批注`，并把每条 answer / freeformAnnotation 写成独立段落，统一以 `！！！` 前缀的引用块呈现，例如：

   ```
   ## 用户批注

   > 待确认问题："候选答案的展现形式应采用哪种？"
   >
   > ！！！选择：表格；备注：xxx

   > 现状分析 中 "GUI 现有批注链路"
   >
   > ！！！这里需要补充 SSE 重连逻辑
   ```

3. 一次 IO 写回 spec md；frontmatter 置为 `stage: plan`，`last_action: 用户批量答复待确认问题`。
4. 写入完成后，由 GUI 端紧接着调用既有 `runAgent` 接口拉起一轮运行；service 端不直接做 Agent 拉起，保持职责单一。
5. 该 `## 用户批注` 章节不参与"章节自动编号"——skill 在下一轮 tasks 阶段消费 `！！！` 批注后，应整段删除 `## 用户批注`。

### 4.6 提交路径（兜底：前序 Agent，仅作规格保留，不实现）

若发现 service 直接拼装的批注信息在 tasks 阶段被消费时不够精准，启用兜底：

- service 仅把结构化 answer JSON 写入 spec 同目录的 `answers.json`；
- 拉起一个轻量 Agent（mode: `skill-answers-merge`），让它把 answers.json 内容融合写回 spec 的 `## 待确认问题` / `## 技术实现方案`，不做代码改动；
- 该 Agent 结束后再走原 yorz-spec skill 的 tasks 流程。
- 首版只实现 4.5；4.6 留作 fallback 仅写规格不写代码。

### 4.7 改动文件总览

- `src/skill/SKILL.md`：补充《待确认问题结构》《推荐项标记》小节，强制 plan 阶段输出候选项；并补充：tasks 阶段消费完 `！！！` 后须整段删除 `## 用户批注`。
- `src/gui/src/lib/question-parse.ts`：新建解析器。
- `src/gui/src/components/QuestionConfirmPanel.tsx`：新建右侧卡片面板组件。
- `src/gui/src/pages/SpecDetail.tsx`：挂载 `QuestionConfirmPanel`；改造 `SelectionMenu` 批注入口为"追加到面板"而非直接 POST；提交完成后调用 `runAgent`。
- `src/gui/src/components/AnnotatePopover.tsx`：保留组件用于"追加到面板"前的输入二次确认，回调改为面板侧 push，而非直接调 `api.appendAnnotation`。
- `src/gui/src/lib/api.ts`：新增 `submitQuestionAnswers`；保留 `appendAnnotation` 不删除（其他入口仍可能用到）。
- `src/service/spec-store.ts`：新增 `applyQuestionAnswers(id, payload)`，写入 `## 用户批注` 章节。
- `src/service/routes/specs.ts`：新增 `POST /specs/:id/questions/answers`。
- `src/gui/src/styles.css`：新增侧边卡片浮层样式（与 `.annotate-popover` 风格统一）。
- 单元/集成测试：
  - `src/gui/src/lib/__tests__/question-parse.test.ts`
  - `src/service/__tests__/apply-question-answers.test.ts`
  - `src/service/__tests__/answers-route.test.ts`
  - 现有 e2e 增补一个 case：plan 阶段提交结构化答复并自动运行 Agent。

### 4.8 兼容与回滚

- 老 spec（无候选项）按"自由文本卡片"渲染，提交后写入的批注块结构与现有 `appendAnnotation` 等价，tasks 阶段照常工作。
- 若新流程出现致命问题，GUI 可加 feature flag 暂时关掉 `QuestionConfirmPanel`，回到 `AnnotatePopover` 单条直写路径，无需 service 回滚。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/skill/SKILL.md` 中新增《待确认问题结构》小节，规定候选项语法（`- 选项` 子列表、` (推荐)` 单推荐后缀、无多选概念）以及"tasks 阶段消费完 `！！！` 后整段删除 `## 用户批注`"；附 1 个示例
- [x] 新建 `src/gui/src/lib/question-parse.ts`：实现 `parseConfirmQuestions(body)`；返回 `{ id, text, options:[{id,label,recommended}], isFreeform }[]`；问题 id = `crypto`-free 简易 hash(text)+index
- [x] 新建 `src/gui/src/lib/__tests__/question-parse.test.ts`：覆盖 单候选+推荐 / 多候选+1 推荐 / 无候选退化为 freeform / `- 暂无` 返回空数组 四类用例
- [x] 在 `src/service/spec-store.ts` 新增 `applyQuestionAnswers(id, payload)`：读 spec → 在文档末尾追加（或合并已有）`## 用户批注` 章节，逐条写入 `> 引用 + ！！！备注` 块 → frontmatter 置 `stage: plan`、`last_action: 用户批量答复待确认问题`、`updated_at` 当日
- [x] 新建 `src/service/__tests__/apply-question-answers.test.ts`：验证写入后的章节结构、frontmatter 更新、再次调用是合并到同一 `## 用户批注` 而非重复创建
- [x] 在 `src/service/routes/specs.ts` 新增 `POST /specs/:id/questions/answers` 路由，校验 body schema 并调用 `applyQuestionAnswers`；400/404/500 三档错误处理
- [x] 新建 `src/service/__tests__/answers-route.test.ts`：覆盖正常提交 200、空 body 400、未知 spec 404
- [x] 在 `src/gui/src/lib/api.ts` 新增 `submitQuestionAnswers(id, payload)`，POST 上述路由；保留 `appendAnnotation`
- [x] 新建 `src/gui/src/components/QuestionConfirmPanel.tsx`：position fixed 右侧 360px 始终展开；渲染 radio 卡片（推荐项默认选中）+ 可选「自定义批注」输入；顶栏「全部使用推荐」+「提交全部」；内部维护 freeform 选区批注列表
- [x] 在 `src/gui/src/styles.css` 新增 `.question-confirm-panel` 与卡片、按钮、滚动样式，沿用 `.annotate-popover` 视觉语言
- [x] 改造 `src/gui/src/pages/SpecDetail.tsx`：当 `stage === 'plan'` 且解析出问题时挂载 `QuestionConfirmPanel`；`SelectionMenu` 的 "批注" 不再直接 `appendAnnotation`，改为通过 `AnnotatePopover` 收集后 push 到 `QuestionConfirmPanel` 状态；提交成功后立即调用既有 `runAgent` 流程
- [x] 调整 `src/gui/src/components/AnnotatePopover.tsx`：`onSubmit` 回调签名/语义保持不变，但调用方改为 push 到面板状态而非 POST；保留原有取消/字数校验
- [x] 补充 1 个 e2e 用例（参照 `src/gui/src/__e2e__` 现有结构）：plan 阶段进入 spec、选择推荐 + 追加 1 条选区批注、点击「提交全部」→ 校验 spec md 出现 `## 用户批注` 章节并触发了一次运行 Agent
- [x] 在仓库根运行 `npx prettier --write` 对本 spec 与新增/修改的源码做格式化（若 prettier 不可用则在执行记录中说明）；运行项目自带测试/类型检查命令并记录结果

## 7. 执行记录

- 2026-06-18：SKILL.md 与 `question-parse.ts` / 单测在本轮开始前已存在产物，直接复用；修正 `parseConfirmQuestions` 中编号标题正则（原 `\d+(?:\.\d+)*` 无法匹配 `## 5. 待确认问题` 形态，补 `\.?`），使现有 2 个失败用例转为通过。
- 2026-06-18：在 `src/service/spec-store.ts` 新增 `applyQuestionAnswers` 与 `mergeUserAnnotations` 私有函数；首次调用追加 `## 用户批注` 章节，重复调用合并到同一 H2；frontmatter 重置为 `stage: plan` / `last_action: 用户批量答复待确认问题` / `updated_at: 当日`。新增 `src/service/__tests__/apply-question-answers.test.ts`（5 用例，全部通过）。
- 2026-06-18：在 `src/service/routes/specs.ts` 新增 `POST /specs/:id/questions/answers`，对 body schema 进行严格校验（空答复/缺字段返回 400，spec 不存在返回 404，写入成功 200）。新增 `src/service/__tests__/answers-route.test.ts`（5 用例，全部通过）。
- 2026-06-18：在 `src/gui/src/lib/api.ts` 暴露 `submitQuestionAnswers`，保留 `appendAnnotation`。新增 `src/gui/src/components/QuestionConfirmPanel.tsx`：右侧 fixed 卡片列表，radio 默认选中推荐项，每张卡片附可选批注输入；顶栏「未答题计数 / 全部使用推荐 / 提交全部」；同时渲染追加的选区批注卡片，支持移除。
- 2026-06-18：在 `src/gui/src/styles.css` 新增 `.question-confirm-panel` 等样式，沿用现有视觉语言。
- 2026-06-18：改造 `src/gui/src/pages/SpecDetail.tsx`：plan 阶段且解析出问题或已追加选区批注时挂载 `QuestionConfirmPanel`；`SelectionMenu → AnnotatePopover` 的「批注」在 plan 阶段改为追加到面板而非直接 POST，其他阶段保持原 `api.appendAnnotation` 写入路径，避免破坏既有用例与 e2e。提交全部后自动调用 `runAgent()`。
- 2026-06-18：在 `src/gui/src/__e2e__/fixtures/setup.ts` 新增 `QUESTIONS_SPEC_ID` 种子；新增 `src/gui/src/__e2e__/question-confirm.spec.ts`，验证面板可见、推荐项默认选中、点击「提交全部」走通 200 答复接口、spec 文档新增 `## 用户批注` 与「选择：表格」内容。
- 2026-06-18：验证 — `npx vitest run` 全量 67 用例通过；`npx tsc --noEmit` 无报错；`npx prettier --write` 对 spec 与改动文件成功格式化。e2e (`npx playwright test`) 需要先执行 `pnpm build` 生成 `dist/cli/index.js` 才能由 webServer 启动，本轮未在 CI/沙箱中实际执行 Playwright，仅完成代码与断言搭建；后续在具备完整构建环境时执行 `pnpm build && pnpm test:e2e` 即可补齐验证。

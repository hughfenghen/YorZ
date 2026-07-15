# TODO

## P0

- 类图提供属性注释、新增、删除
- 优化问题确认数量：存在多方案、后续影响大、方案优缺点明显难以抉择
- chat 支持粘贴图片
- yorz serve 检查并自动 install skill
- Agent 更新 spec 文档，会导致滚动条重置到顶部，未输出完成即渲染了问题弹窗，可能导致两个 Agent session 同时更新 spec 文档
- 追加任务、批注，等用户输入内容容易破坏文档结构一致性

```
[fixed] [fix] 2026-07-14 11:58:27 | 1. 初始化之后，在轨道区拖拽素材，使两个素材产生时间区间重合时没有生成新的子轨道，同一子轨道不再允许素材出现时间重叠@editor/app/component
描述：1. 初始化之后，在轨道区拖拽素材，使两个素材产生时间区间重合时没有生成新的子轨道，同一子轨道不再允许素材出现时间重叠@editor/app/components/cut/TrackList.tsx

2. 未渲染到轨道区的素材（elements），不参与初始化子轨道计算，比如mock数据中有许多 shot 已被注释，意味着这些shoot以及对应的素材都不会渲染到轨道，这些素材不参与子轨道计算。@editor/app/components/cut/mock-data.ts:L5-L39
3. 轨道区的素材元素被拖拽，应该立刻更新轨道状态，而不是等到松开鼠标，再切换到新轨道
```

## P1

- [ ] Skill 优化
  - [ ] 不同的流程（spec review 图形化生成）考虑是否需要拆分skill
  - [ ] 方案的影响范围、变更范围；spec review 都可能用到（差异是预估和实际影响）
  - [ ] Skill 的可测试性、效果评估
  - [ ] spec 格式检测机制：图形语法，待确认问题格式（是否能解析通过）
  - [ ] 可选深度、普通、简化版工作流，
    - [ ] 处理简单小问题、多次实施失败转入深度模式
  - [ ] 针对不同触发时机，定制 skill；追加任务、解释、review
- [ ] review 模式
  - [ ] 图形化 diff 变更表达
- [ ] 不建立 spec 的沟通
  - [ ] 小问题咨询/执行
- [ ] 临时问题咨询 Agent？
- [ ] 图形化、可视化
  - [ ] spec 文档需要更丰富的可视化表达
  - [ ] 优先展示图形、默认折叠文字
- [ ] UI / 功能 优化
  - [ ] 按模块或文件依赖图，标记影响范围； review / spec
  - [ ] 管理项目开发服务
    - [ ] 分享服务日志给 Agent
  - [ ] spec 列表，按天分组，降序
    - [ ] 按分类、模块过滤，名称、内容模糊匹配
    - [ ] 列表按时间降序，精确到秒
  - [ ] @ mention spec 或文件、模块
  - [ ] 界面结构、布局、元素的美化
  - [ ] 快捷键系统
- [ ] 外部能力集成
  - [ ] 代码知识库、
    - [ ] 项目模块分析
    - [ ] 模块依赖关系
    - [ ] 模块与源码文件关系
  - [ ] 核心变更逻辑流程图、时序图、数据流图等等

- UI 美化
  - [ ] 优化 spec 文档渲染结果，内容结果优化，图形优先
  - [ ] 优化 Agent 输出效果，终端渲染库

## Bug

- [ ] 图形化语法错误
- [ ] 图形化区域显示纯代码文本，刷新后正常，可能是解析时机存在 bug

---

示例 spec 内容，是否可以 图形化：

```md
## 1. 背景

Story 编辑页支持在左侧 NarrativeTreeView 与右侧 SceneScriptView 并排展开。当前左侧单击节点仅更新父级 `selectedScene` 状态，右侧显示的 sequence 内容不会随之刷新；只有双击（触发 `onSceneEdit`）时右侧才会切换。用户希望"选中即联动"，同时保留右侧未保存变更时的确认拦截，且拒绝切换时左侧选中态回滚保持一致。

## 2. 需求

- 左侧 NarrativeTreeView 中选中的 sequence 节点变化时，右侧 SceneScriptView 内容随之刷新为该 sequence。
- 左侧选中态与右侧内容始终对同一 sequence（即"选中态 ↔ 右侧内容"双向一致）。
- 右侧内容存在未保存变更时，走既有切换确认逻辑提示用户；用户拒绝切换则右侧内容保持不变，同时左侧选中态也不切换到新节点。
- 双击行为（右侧尚未打开 script view 时创建 script view）需保留；上述联动只影响右侧已经存在 script view 的场景。

## 3. 现状分析

### 3.1 左右两侧的父级装配

- 装配位于 `editor/app/console/story/[story_id]/page.tsx:1841`（narrative case）与 `page.tsx:1854`（script case）。
- 左侧 `NarrativeTreeViewWrapper` 接收 `onSceneSelect` / `onSceneEdit` / `selectedSceneId` 三个联动 props。
- 右侧 `SceneScriptView` 通过 `scene={resolvedScene}` 显示内容，`resolvedScene` 由 `resolveViewScene(view)` 计算（`page.tsx:398`），实现位于 `editor/app/console/story/[story_id]/viewScene.ts:11`：当 `view.sceneId` 与 `selectedScene._id` 匹配时用 `selectedScene`，否则回退到 `findSceneById(view.sceneId)`。

### 3.2 单击 / 双击的现有回调链路

- 单击节点：`NarrativeTreeView` 内部触发 `handleSceneSelect(scene)`（组件内 `editor/app/components/NarrativeTreeView.tsx:861`），冒泡到父级 `page.tsx:1555`，仅执行 `setSelectedScene(scene)`。
- 双击节点：触发 `handleSceneEdit(scene)`，父级 `page.tsx:1559` 一次性完成 `setSelectedScene` 与 `setViews`（有 script view 则替换其 `sceneId` / `sceneSnapshot`，否则 push 新 script view）。
- 因此单击只更新 `selectedScene`；但若 script view 的 `view.sceneId` 与 `selectedScene._id` 不一致，`resolveLatestSceneForView` 会走 `findSceneById(view.sceneId)`，右侧仍指向旧 sequence，无法联动。

### 3.3 SceneScriptView 的 dirty 状态与切换现状

- `hasUnsavedChanges = isScriptDirty || isNameDirty || isSynopsisDirty`（`SceneScriptView.tsx:1038`），并以 `hasUnsavedChangesRef` 保持同步引用。
- 存在自动保存：`AUTOSAVE_IDLE_MS = 1500`（`SceneScriptView.tsx:170`），依赖 `hasUnsavedChanges` 触发 `scheduleAutosave`。
- scene 切换 hydration 逻辑在 `SceneScriptView.tsx:2320` 附近，同 scene 且有 unsaved 时会保留本地编辑不被父级刷新覆盖，但**未对切换到另一个 sceneId 做拦截确认**。
- SceneScriptView 内已存在一个 Sequence 下拉切换器（`beatSelectOptions`, `SceneScriptView.tsx:3218`），点击后调用组件内的 `handleSceneSelect(sceneId)`（`SceneScriptView.tsx:2719`），直接 `onSceneEdit(selectedScene)` 上抛，同样未做 dirty 拦截。
- 组件其他位置有 `modal.confirm` 用法（Discard / Lock / Compose，`SceneScriptView.tsx:2803` 起），okText: "Continue"、cancelText: "Cancel"，可复用其风格作为切换确认的既有模式。

### 3.4 结论

- "选中即联动"目前缺失：需要让 `handleSceneSelect` 也更新已存在 script view 的 `sceneId` / `sceneSnapshot`。
- "未保存变更切换提示"目前缺失：需要新增一个 gate（父级或 SceneScriptView 内部）在切换前询问；SceneScriptView 内部下拉切换器也应统一走同一 gate。
- "拒绝切换时选中态回滚"依赖于选中态由父级 `selectedSceneId` prop 单向驱动（`NarrativeTreeView.tsx:1271` 处 `isSelected: selectedSceneId === id`）；父级不 `setSelectedScene` 即可保持不切。需要额外确认 `SceneNode` 内没有本地 optimistic 选中状态覆盖此单向流。

## 4. 技术实现方案

### 4.1 单击联动：父级 handleSceneSelect 同步 script view

- 在 `page.tsx` 中抽出 `syncScriptViewToScene(scene, { openIfMissing })` 辅助函数：
  - `openIfMissing = true`（双击语义）：沿用现有 `handleSceneEdit` 行为，若无 script view 则创建。
  - `openIfMissing = false`（单击语义）：仅当已存在 script view 时更新其 `sceneId` / `sceneSnapshot` / `title`；否则仅更新 `selectedScene`，不主动创建。
- `handleSceneSelect` 改为：先经由 dirty gate（见 4.2）判定是否放行；放行后依次 `setSelectedScene(scene)` + `syncScriptViewToScene(scene, { openIfMissing: false })`。
- `handleSceneEdit` 复用 `syncScriptViewToScene(scene, { openIfMissing: true })`，去掉重复的 setViews 逻辑。

### 4.2 未保存变更 gate：SceneScriptView 暴露命令式 handle

- 将 `SceneScriptView` 用 `forwardRef` 包装，通过 `useImperativeHandle` 暴露：
  - `hasUnsavedChanges(): boolean`
  - `confirmSceneSwitch(): Promise<boolean>`：若 dirty 则以既有 `modal.confirm` 风格弹窗询问，用户 Continue 返回 `true`（同时按需触发 discard / 让 hydration 覆盖），Cancel 返回 `false`；不 dirty 直接返回 `true`。
- 父级新增 `sceneScriptViewRef`，将其传入右侧 `<SceneScriptView ref={sceneScriptViewRef} ... />`。
- `handleSceneSelect` 在改变 `selectedScene` 之前 `await sceneScriptViewRef.current?.confirmSceneSwitch()`；返回 `false` 则整个操作 no-op。
- `SceneScriptView` 内部 Sequence 下拉切换器亦复用此逻辑（内部直接调用 `confirmSceneSwitch()` 后再 `onSceneEdit`），保证所有入口一致。
- 弹窗文案初拟：title "Sequence has unsaved changes. Switch and discard?"，okText "Continue"，cancelText "Cancel"；具体文案交由 4.2 待确认问题确认。

### 4.3 拒绝路径下的选中态一致性

- 左侧节点 `isSelected` 完全由 `selectedSceneId` prop 驱动（`NarrativeTreeView.tsx:1271`），父级不 setState 就不会切换视觉选中。
- 需确认 `SceneNode.tsx` 是否维护 optimistic 本地选中态；若是需要改为受控。
- 双击路径 `handleSceneEdit` 同样接入 gate，避免"右侧 dirty + 用户双击拒绝"时左侧仍强行切换。

### 4.4 双击与自动打开 script view 的取舍

- 双击语义保留"Open editor"意图，即使右侧未打开也主动创建 script view；仍需先 gate 确认。
- 单击语义保守：仅在右侧已有 script view 时联动，不主动创建新 view，避免用户单击左侧就意外弹出编辑区。此行为对应 5.1 待确认问题。

### 4.5 影响面 & 涉及文件

- `editor/app/console/story/[story_id]/page.tsx`：
  - 新增 `sceneScriptViewRef`；
  - `handleSceneSelect` / `handleSceneEdit` 抽公用；
  - 传 `ref` 给 `SceneScriptView`。
- `editor/app/components/SceneScriptView.tsx`：
  - `forwardRef` + `useImperativeHandle` 暴露 dirty gate；
  - 内部 Sequence 下拉切换器复用 gate；
  - 新增切换确认 `modal.confirm` 文案。
- `editor/app/components/SceneNode.tsx`（需二次确认）：如存在本地 optimistic 选中态则改为受控。
- `editor/app/components/NarrativeTreeView.tsx` / `NarrativeTreeViewWrapper.tsx`：不改 props；单击/双击回调保持不变。
- 相关测试：`editor/app/components/__tests__/SceneScriptView*.test.*` 与 `editor/app/console/story/[story_id]/__tests__/viewScene.test.ts` 覆盖回归。
```

目前已经做了一次 mermaid 优化：@.yorz/specs/260705.refct.done-stage-and-mermaid-step/spec.md
现在针对性分析案例： @.yorz/specs/260705.refct.merge-init-into-add/spec.md 文档，不要变更和处理该示例文档；

1. yorz lint 该 spec 没有报错，但实际@.yorz/specs/260705.refct.merge-init-into-add/spec.md:L193-L206 在 GUI 页面选入失败; error message: "Parse error on line 13:\n...[\"返回 RunAddResult\"]</path>\n----------------------^\nExpecting 'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'end', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'AMP', 'COLON', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', 'direction_tb', 'direction_bt', 'direction_rl', 'direction_lr', 'direction_td', got 'TAGSTART'"
2. "3.1 init 命令实现" 典型的流程说明文字，没有使用流程图；
3. “4.1 add.ts 增强” 大量类型定义代码，没有使用 类图，新的实现流程逻辑没有使用 流程图
4. “4.5 兼容性与影响范围” 我期望使用某类型图展示被变更模块的现有组成结构，然时候使用 红色标识 breaking change 区域，使用黄色标识受影响区域

---

分析图形化 skill 未达预期的原因，如何优化 skill ？
我建议的优化方向：

1. spec 文档图形表达的目标是让用户快速建立认知，即：核心逻辑流程、模块结构、模块间的交互；
2. 图形不需要表达极度精确的信息，如文件路径、具体的代码行，具体的实现源码或者伪代码
3. 我建议 spec 文档表层使用图形优先，具体而精确的信息可以折叠起来，比如使用 <details /> 标签
   - 具体而精确的信息在文档中是有必要的，因为 Agent 也需要阅读文档来实施代码；

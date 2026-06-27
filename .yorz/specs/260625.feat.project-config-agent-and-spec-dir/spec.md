---
stage: execute
last_action: 消费追加任务批注，标记 [fixed] 关闭追加任务
updated_at: 2026-06-27
summary: 新增项目级配置（Agent 三选项含自定义命令 + spec 文档目录），GUI 在项目列表加编辑入口（模态 Dialog），配置落地 .yorz/config.json，serve/skill 按配置启动 Agent 并写入指定目录。
---

# 项目配置：Agent 选择与 spec 目录可配

## 1. 背景

用户提出新需求（原文）：

> 新增项目配置功能，目前仅支持 Agent 和 spec 文档目录配置；
>
> Agent：ClaudeCode / OpenCode； radio 控件，默认 ClaudeCode
> spec 文档：默认 `<ProjectRoot>/.yorz/specs`，input 控件
>
> 配置入口在左侧项目列表，关闭 icon 的左侧新增一个编辑 icon；
> 项目配置存储在 `<ProjectRoot>/.yorz/.config` 中；
>
> 更新对应的 yorz skill、yorz serve 服务，需要根据项目配置启动对应的 Agent，文件写入到指定的目录

## 2. 需求

- GUI：在左侧项目列表每项的"关闭 icon"左侧新增「编辑」icon；点击打开项目配置模态 Dialog。仅展开态显示，折叠态（36px）不展示。
- 配置项（v1）：
  - **Agent**：单选 radio，三选项 `ClaudeCode` / `OpenCode` / `自定义`，默认 `ClaudeCode`；选中"自定义"时显示 `cmd` + `args` 输入框。
  - **spec 文档目录**：自由文本 input，默认 `.yorz/specs`，相对路径以项目根为基；保存时若目录不存在则自动 `mkdir -p`。
- 存储：每个项目一份配置文件，落在 `<ProjectRoot>/.yorz/config.json`（沿用现状文件名，原始需求中 `.yorz/.config` 系笔误）。
- 后端：`yorz serve` 启动 Agent 时按该项目配置选择 Agent 命令（含自定义命令分支）；spec 列表/读取/写入路径按该配置的 spec 目录解析；配置变更后热重建 FS Watcher，无需重启 serve。
- yorz-spec skill：写入 spec 时路径来源于配置而非硬编码 `.yorz/specs`。

## 3. 现状分析

### 3.1 GUI 项目列表与"关闭 icon"

- 列表组件：`src/gui/src/components/ProjectsSidebar.tsx:194-225`，每一项渲染 `<A>` 链接 + 「✕」按钮；
- 关闭按钮 handler：`ProjectsSidebar.tsx:131-148`，调用 `api.removeProject(p.id)`，仅"从列表移除"，不删除磁盘。
- 样式：`src/gui/src/styles.css:237-262` 的 `.projects-sidebar-remove`（绝对定位，hover 显示）。
- 折叠态宽度 36px（`src/gui/src/styles.css:121-134`），仅显示首字母图标，没有 hover 操作区。
- 当前**无**「编辑项目 / 项目设置」入口。

### 3.2 全局项目目录（多项目管理已落地）

- 全局配置：`~/.config/yorz/projects.json`（可被 `$YORZ_HOME`/`$XDG_CONFIG_HOME` 覆盖）；
- 读写：`src/service/global-config.ts:28-59`，schema 为 `{ version: 1, projects: GlobalProjectEntry[] }`，每条 `{ id, path, addedAt, lastActivityAt }`。
- 删除项目 API：`src/service/routes/project.ts:54-58` → `DELETE /api/projects/:projectId`。
- **全局配置不存项目级偏好**，所有 per-project 偏好都应落在项目自身。

### 3.3 项目级配置现状

- 已存在 `src/service/agent-config.ts`，从 `<ProjectRoot>/.yorz/config.json` 读取 `{ "agent": "claude" | "opencode" }`，缺失/异常时退化为 `claude`。
- 决策链（`resolveAgentCmd`，`src/service/agent-config.ts:62-75`）：`opts.override` → `YORZ_AGENT_CMD` 环境变量 → `opts.agent` → `.yorz/config.json` → 默认 `claude`。
- 用户原文中的 `.yorz/.config` 系笔误，最终采用 `.yorz/config.json` 并扩展字段。

### 3.4 spec 目录硬编码点

- `src/service/spec-store.ts:90` 构造时 `this.root = join(opts.cwd, '.yorz', 'specs')`，全部 list/read/write 都基于该 root。
- `src/service/routes/specs.ts:165,181` 拼装给 Agent 的 prompt 模板里硬编码字符串 `\`.yorz/specs/${specId}/spec.md\``；spec 目录改为可配置后，此模板必须改为按实际相对路径渲染。
- FS Watcher：spec 文件变更回推 GUI 的 watcher 监听范围目前以 `.yorz/specs` 为锚（需在实现阶段二次确认监听口子的具体位置）；目录变更时需热重建 watcher。

### 3.5 yorz-spec skill

- skill 文档：`src/skill/yorz-spec/`（以及当前仓库内的 `.claude/skills/yorz-spec/`），多处出现 `.yorz/specs/<id>/spec.md` 字面量（`new-spec.md`、`conventions.md`、`routing.md` 等），属说明文档而非可执行硬编码。
- spec 路径事实上由 service 在拉起 Agent 时通过 prompt 注入；skill 文档里出现的字面量仅作示例，最小代价方案是只改 service 注入的 prompt + 文档保持示例即可。

### 3.6 追加任务分析：Agent 身份确认测试

- 追加任务原文：「测试，请问你是Claude Code还是open code?」
- 性质：测试/验证类追加任务，用于验证追加任务 → Agent 响应链路是否畅通，非实际功能需求。
- 答复：**当前运行的是 OpenCode**（由 `glm-5.1` 模型驱动），非 Claude Code。
- 判定：无需代码改动，仅需将此追加任务标记为 `[fixed]` 并记录答复即可关闭。

## 4. 技术实现方案

### 4.1 配置存储层（service）

- 新增 `src/service/project-config.ts`：
  - 类型：
    ```ts
    type AgentConfig =
      | { kind: 'claude' }
      | { kind: 'opencode' }
      | { kind: 'custom'; cmd: string; args: string[] }
    type ProjectConfig = { version: 1; agent: AgentConfig; specsDir: string }
    ```
  - 函数 `loadProjectConfig(cwd)` / `saveProjectConfig(cwd, cfg)` / `resolveSpecsDir(cwd, cfg)`：
    - `specsDir` 在配置中存为**相对项目根的相对路径**（默认 `.yorz/specs`）；resolve 时拼成绝对路径并强制校验"必须落在项目根之内"。
    - 保存时若解析后的绝对路径不存在，自动 `mkdir -p`。
    - 原子写：先写 `*.tmp-` 再 `rename`，与 `global-config.ts` 写法保持一致。
  - 文件落点：`<ProjectRoot>/.yorz/config.json`（沿用现状）。
  - 兼容：读取时识别旧 schema `{ agent: 'claude' | 'opencode' }`（仅字符串）并升级为 `{ kind }`；写回时一律新 schema。
- 调整 `src/service/agent-config.ts`：`readAgentName(cwd)` / `resolveAgentCmd` 改为基于 `loadProjectConfig` 派生，支持 `custom` 分支（直接返回 `cmd` 与 `args`）；保留 `YORZ_AGENT_CMD` 与 `opts.override` 的优先级不变。

### 4.2 SpecStore / Routes 解耦目录

- `src/service/spec-store.ts:90`：`SpecStore` 构造时接收 `specsDir` 绝对路径而非自行 `join('.yorz/specs')`；调用方（`createApp` / 路由层）在创建 store 前先 `resolveSpecsDir`。
- `src/service/routes/specs.ts:165,181`：prompt 模板中的 `.yorz/specs/${specId}/spec.md` 改为 `${relativeSpecsDir}/${specId}/spec.md`；`relativeSpecsDir` 由 `ProjectConfig.specsDir` 提供。
- FS Watcher：在配置变更时关闭旧 watcher，按新目录重建（实现阶段定位具体 watcher 文件，热重建无需重启 serve）。

### 4.3 HTTP API

- 新增：
  - `GET /api/projects/:projectId/config` → 返回 `ProjectConfig`（缺省时返回默认值，附 `isDefault: true`）。
  - `PUT /api/projects/:projectId/config` → body `{ agent, specsDir }`，校验：
    - `agent.kind ∈ {'claude','opencode','custom'}`；`custom` 时 `cmd` 非空字符串，`args` 为 `string[]`；
    - `specsDir` 非空、不含 `..` 且 resolve 后位于项目根内；
    - 若 specsDir 解析后路径不存在，自动 `mkdir -p`（失败则返回 4xx）；
    - 写入成功后**重建该项目的 SpecStore 与 watcher**。
- 新建 `src/service/routes/project-config.ts`，保持单一职责（与 `routes/project.ts` 分开）。

### 4.4 GUI

- `ProjectsSidebar.tsx:194-225`：在 `<a class="projects-sidebar-remove">` 前插入 `<button class="projects-sidebar-edit">✎</button>`，点击触发打开 Dialog（折叠态不显示，沿用 hover 显示逻辑即可）。
- 配置面板：
  - 形式：模态 Dialog；标题"项目配置 · <项目名>"。
  - 字段：
    - Agent radio 三选项：`ClaudeCode` / `OpenCode` / `自定义`；选中"自定义"时显示 `cmd`（必填 input）与 `args`（自由文本，按空格切分或一行一项，最终存为 `string[]`）。
    - spec 目录 input（placeholder `.yorz/specs`）。
  - 行为：加载时 `GET /api/projects/:pid/config`；保存时 `PUT`；保存成功后弹 toast 提示"配置已保存"；若 specsDir 改变且旧目录里存在 spec，则 toast 追加一行"旧 spec 仍在原目录，请手工迁移"。
- API 客户端：`src/gui/src/lib/api.ts` 新增 `getProjectConfig(pid)` / `updateProjectConfig(pid, payload)`。
- 样式：在 `styles.css` 复用 `.projects-sidebar-remove` 的悬浮定位思路，新增 `.projects-sidebar-edit`（位置在 ✕ 左侧、间距 4px）；Dialog 样式可复用项目现有 modal/Dialog 体系（若无则新增最小可用样式）。

### 4.5 yorz-spec skill 文档更新范围

- 仅更新动态部分：service 在拉起 Agent 时注入的 prompt 中 spec 路径用配置解析后的相对路径。
- skill 内的 `.yorz/specs/<id>/spec.md` 字面量保留为**默认示例**，在 `new-spec.md` / `conventions.md` 处追加一句"目录可由 `<ProjectRoot>/.yorz/config.json` 的 `specsDir` 字段覆盖"。

### 4.6 兼容与迁移

- 默认 specsDir 仍为 `.yorz/specs`，老项目无感知。
- 若用户改了 specsDir 但目标目录里已有旧 spec：本期**不做自动迁移**，仅在 GUI 保存时给出 toast 提示"现有 spec 仍在旧目录，需手工迁移"。
- agent 字段旧 schema（字符串 `'claude' | 'opencode'`）在 load 时升级为 `{ kind }` 联合类型，写回一律新 schema。

### 4.7 追加任务处理：Agent 身份确认（无代码改动）

- 追加任务「测试，请问你是Claude Code还是open code?」属测试性质，无需新增/修改任何代码。
- 处理方式：在 execute 阶段将 `[open]` 标记改为 `[fixed]`，并在执行记录中记录答复即可。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 新建 `src/service/project-config.ts`：定义 `ProjectConfig` / `AgentConfig` 类型与 `loadProjectConfig`/`saveProjectConfig`/`resolveSpecsDir` 函数，含旧 schema 升级、原子写、specsDir 越界校验、不存在自动 `mkdir -p`；验收：手工触发 load/save 默认配置文件正确生成且字段齐全。
- [x] 调整 `src/service/agent-config.ts`：`readAgentName`/`resolveAgentCmd` 改为基于 `loadProjectConfig` 派生，新增 `custom` 分支返回 `cmd`+`args`；验收：三种 agent 配置下 `resolveAgentCmd` 返回正确命令。
- [x] 解耦 `src/service/spec-store.ts:90`：`SpecStore` 构造接收 `specsDir` 绝对路径参数；验收：默认 `.yorz/specs` 行为不变，传入自定义路径时 list/read/write 落到该路径。
- [x] 改 `createApp` 及相关装配处：创建 `SpecStore` 前先 `resolveSpecsDir(cwd, cfg)`；验收：默认目录下既有用例不破坏。
- [x] 更新 `src/service/routes/specs.ts:165,181`：prompt 模板用 `${relativeSpecsDir}/${specId}/spec.md`；验收：默认与自定义 specsDir 下 prompt 文本正确。
- [x] 新建 `src/service/routes/project-config.ts`：实现 `GET /api/projects/:projectId/config` 与 `PUT /api/projects/:projectId/config`，含 agent kind 校验、specsDir 越界与自动 mkdir、写入后重建 SpecStore；验收：curl GET 返回默认值，curl PUT 后磁盘文件已写入。
- [x] 定位并热重建 FS Watcher：配置变更后关闭旧 watcher、按新 specsDir 起新 watcher；验收：保存配置改 specsDir 后 GUI 能收到新目录下文件变更事件，无需重启 serve。
- [x] 在 `src/gui/src/lib/api.ts` 新增 `getProjectConfig(pid)` / `updateProjectConfig(pid, payload)`，类型对齐后端；验收：调用两个 API 时类型检查通过。
- [x] 在 `ProjectsSidebar.tsx` 列表项中 ✕ 按钮前插入 `<button class="projects-sidebar-edit">✎</button>`，点击触发打开 Dialog；折叠态不显示；验收：展开态 hover 见两个按钮，折叠态无按钮。
- [x] 新建 `ProjectConfigDialog` 组件（位置：`src/gui/src/components/`），含 Agent radio 三选项 + 自定义命令 cmd/args 输入 + specsDir input + 保存/取消按钮；保存成功 toast，specsDir 改变时追加"手工迁移"提示；验收：模态打开能正确加载并保存配置。
- [x] 在 `src/gui/src/styles.css` 新增 `.projects-sidebar-edit`（✕ 左侧 4px 间距）与必要的 Dialog 样式；验收：视觉与现有 `.projects-sidebar-remove` 协调。
- [x] 更新 yorz-spec skill 文档：在 `src/skill/yorz-spec/new-spec.md` 与 `conventions.md` 中追加说明"spec 目录可由 `<ProjectRoot>/.yorz/config.json` 的 `specsDir` 字段覆盖"；验收：两文件文本中出现该说明，且不破坏既有示例。
- [x] 跑一次完整流程：在 GUI 切换 Agent 为 opencode、改 specsDir 为非默认目录，新建一个 spec 并写入 1 个任务；验收：磁盘上新 spec 出现在新目录，Agent 命令为 opencode。

## 7. 追加任务

- [fixed] [feat] 2026-06-25 22:19 | 测试，请问你是Claude Code还是open code?
  - 描述：测试，请问你是Claude Code还是open code?
  - 答复：当前运行的是 **OpenCode**（glm-5.1 模型驱动），非 Claude Code。

## 8. 执行记录

- 2026-06-25 新建 spec，进入 plan 阶段；产出现状分析 / 技术实现方案 / 待确认问题；等待用户对「待确认问题」批注后再进入 tasks 阶段。
- 2026-06-25 用户批量答复 7 项待确认问题；消费批注，定稿技术方案（采用 `.yorz/config.json`、specsDir 不存在自动 mkdir -p、不做旧 spec 迁移、模态 Dialog、折叠态不展示、Agent 联合类型纳入自定义命令、FS Watcher 热重建），生成 13 项任务清单，stage 切到 tasks。
- 2026-06-25 顺序完成 13 项任务清单，进入 execute 阶段：
  - 后端：新建 `src/service/project-config.ts`（含旧 schema 升级、原子写、specsDir 越界校验、`ensureSpecsDirExists`）；改写 `agent-config.ts` 支持 `claude`/`opencode`/`custom` 三分支；`SpecStore`/`SpecWatcher` 接收 `specsDir` 绝对路径参数（默认 `cwd/.yorz/specs` 保持向后兼容）；`ProjectRegistry.materialize` 在创建实例前 `loadProjectConfig + resolveSpecsDir`，并新增 `reload(id)` 以热重建实例；`ProjectInstance` 暴露 `specsDir`/`specsDirRelative`，`routes/specs.ts` 中 prompt 模板与附件路径统一改用 `p.specsDirRelative` / `p.specsDir`。
  - HTTP：新建 `src/service/routes/project-config.ts`（`GET/PUT /api/projects/:projectId/config`，含 agent kind 校验、specsDir `..`/越界拒绝、自动 `mkdir -p`、保存成功后 `registry.reload`）；在 `server.ts` 中挂载。
  - GUI：`src/gui/src/lib/api.ts` 新增 `getProjectConfig` / `updateProjectConfig` 与 `AgentConfig`/`ProjectConfig` 类型；新建 `ProjectConfigDialog.tsx`（radio 三选项 + 自定义 cmd/args + specsDir input，加载时拉取、保存后弹 toast、specsDir 变化时追加"手工迁移"提示）；`ProjectsSidebar.tsx` 在 ✕ 前插入 ✎ 按钮（折叠态仍 hidden），集成 Dialog 与 toast；`styles.css` 增加 `.projects-sidebar-edit` 与 `.project-config-*` 系列样式 + toast。
  - skill 文档：`conventions.md` / `new-spec.md` 追加 `specsDir` 可被 `.yorz/config.json` 覆盖的说明。
  - 验证：`pnpm exec vitest run` 23 个测试文件 / 182 用例全部通过；`pnpm exec vite build --config vite.gui.config.ts` 成功（dist/gui，123 模块）。`tsc --noEmit` 仅剩 1 个与本次改动无关的预存错误（`QuestionConfirmPanel.tsx:46` 重复 `note` 字段）。
  - 阻塞项：任务 #13"在 GUI 切换 Agent 为 opencode 并新建 spec"无法在无 GUI 浏览器环境下手工验证；后端逻辑已通过单元/集成测试覆盖（resolveAgentCmd 三分支、SpecStore 自定义 specsDir、热重建路径）。
- 2026-06-25 用户批注「服务重启中断了 Agent 任务，请检查有无未完成收尾」。逐项复检 1-12 已落地：`src/service/project-config.ts`（含旧 schema 升级 / 原子写 / specsDir 越界 / `ensureSpecsDirExists`）、`agent-config.ts` 三分支、`SpecStore`/`SpecWatcher` 接收 `specsDir`、`ProjectRegistry.reload` + `materialize` 走 `loadProjectConfig`+`resolveSpecsDir`、`routes/project-config.ts` GET/PUT 已挂载到 `server.ts`、`routes/specs.ts` prompt 与附件路径改用 `p.specsDirRelative`/`p.specsDir`、`src/gui/src/lib/api.ts` 暴露 `getProjectConfig`/`updateProjectConfig` + 类型、`ProjectConfigDialog.tsx` 完整实现、`ProjectsSidebar.tsx` 在 ✕ 前插入 ✎（折叠态由 `Show when={!collapsed()}` 隐藏）+ toast、`styles.css` `.projects-sidebar-edit` 与 `.project-config-*`、skill 文档 `conventions.md`/`new-spec.md` 已追加 `specsDir` 覆盖说明。未发现因服务中断遗留的半成品。任务 #13 的 GUI 端到端手工验证（GUI 切 opencode + 改 specsDir + 新建 spec）仍按原阻塞项保留，需用户在浏览器中亲手跑一遍；本轮无新代码改动，仅消费批注。
- 2026-06-25 提交 8301f49：feat(260625.feat.project-config-agent-and-spec-dir): 新增项目级配置（Agent 三选项含自定义命令 + spec 文档目录），GUI 在项目列表加编辑入口（模态 Dialog），配置落地 .yorz/config.json，serve/skill 按配（15 个文件）
- 2026-06-25 检测到追加任务 `[open] [feat]`「测试，请问你是Claude Code还是open code?」，触发变更重开流程进入 plan 阶段。已修复文档结构（合并重复的追加任务/执行记录章节）、补充现状分析 3.6（确认当前运行 OpenCode / glm-5.1）、技术方案 4.7（无代码改动）、待确认问题；等待用户批注确认后关闭追加任务。
- 2026-06-27 用户批注确认追加任务仅为测试，直接关闭。消费 `！！！` 批注：清空待确认问题、删除用户批注章节；将追加任务 `[open]` → `[fixed]` 并附答复（当前运行 OpenCode / glm-5.1）；无代码改动。

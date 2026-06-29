---
stage: execute
last_action: 提交 git
updated_at: 2026-06-29
summary: 为 Agent 并行开发提供 git worktree 工作流：新建 spec 可勾选「新开项目并行」自动建 worktree 并注册为 YorZ 项目；worktree 项目列表页支持「合入主项目」一键提交/合并/清理；合并冲突时自动新建关联 spec 调度 Agent 解决。
---

# Spec: Agent Worktree 并行开发工作流

## 1. 背景

有些关联度较高的任务不适合在同一目录下并行开发，可能代码冲突或热更新导致页面紊乱，需要设计实现一套方便 Agent 使用 git worktree 并行开发的工作流。

具体诉求：

- 在新建 spec 页面新增一个 check box「新开项目并行」（tips 描述这个选项的作用），决定当前 spec 是否需要新开 git worktree，默认不勾选；
- 新开的 git worktree 目录自动添加到 yorz 项目中，新建的 spec 文档应该写入 worktree 目录；
- 如果是 worktree 项目，需要在列表页新增一个「合入主项目」按钮，点击自动合入主项目，对应动作：
  - 提交 git 代码
  - 删除 worktree 目录，从 yorz 项目移除；
  - 自动触发主项目使用 git 更新代码
- 如果出现代码冲突，则使用 yorz 新建 spec 文档，在 spec 文档中关联近期变更导致冲突的其他 spec 文档，启动 Agent 尝试自动解决冲突。

## 2. 需求

- 支持一键「以 worktree 方式新建 spec」，避免与主项目并行开发产生冲突或热更新干扰。
- worktree 项目作为独立的 YorZ 项目实体出现在项目侧栏，与主项目共享 GUI/Service。
- 合入主项目动作必须是「原子流程」：提交→合并→清理 worktree→主项目刷新，任一步失败需明确告知，且尽量不留半成品。
- 合并冲突不是终态，而是触发新的 spec 工作流：自动定位「近期变更导致冲突的其他 spec」并由 Agent 尝试解决。

## 3. 现状分析

### 3.1 项目注册与 specs 写入

- 项目注册存放于全局配置 `~/.config/yorz/projects.json`，结构定义在 `src/service/global-config.ts:7`（`GlobalProjectEntry { id, path, addedAt, lastActivityAt }`），目前没有"worktree / 主项目"概念。
- `ProjectRegistry`（`src/service/project-registry.ts:60`）按 `path` 实例化每个项目的 `SpecStore` / `SpecWatcher` / `AgentRunner`；每个项目的 specs 目录由该项目自己的 `.yorz/config.json` 中的 `specsDir`（默认 `.yorz/specs`）决定。
- 添加项目：`POST /api/projects`（`src/service/routes/project.ts:15`）只接受已存在的目录绝对路径，会 `mkdir <path>/.yorz/specs`。
- 当前无任何"创建 git worktree"或"将一个新目录关联到一个已有项目"的代码路径。

### 3.2 新建 spec 流程

- GUI 端 `src/gui/src/pages/NewSpec.tsx:56` 仅提供「类型 + 需求内容 + 附件」三类输入；提交后调用 `api.createSpec(projectId, body)`（`src/gui/src/lib/api.ts:124`），spec 落到当前 `projectId` 的 specs 目录。
- 没有跨项目重定向逻辑——表单始终在当前项目内创建。

### 3.3 项目侧栏与列表页

- `ProjectsSidebar`（`src/gui/src/components/ProjectsSidebar.tsx:69`）按 `lastActivityAt` 倒序展示扁平项目列表，没有"主项目 / worktree"层级关系。
- 添加项目只能通过 CLI `yorz add <path>` 或 `POST /api/projects`；移除项目仅从全局配置删除，不会动磁盘。
- 项目级"合入主项目"按钮目前不存在。Home 页（`src/gui/src/pages/Home.tsx`）展示该项目下 spec 卡片列表，但没有项目级动作区。

### 3.4 git 与 spec 关联

- `TouchedFilesStore`（被 `AgentRunner` 注入）跟踪每个 spec 涉及的代码文件，存放在 `.yorz/specs/<id>/touched-files.json`，可以作为「近期变更导致冲突的其他 spec」的初筛依据。
- Service 没有任何 git 命令封装；目前所有 git 操作都由 Agent 自己在 skill 中通过 Bash 完成。

### 3.5 skill 侧

- `yorz-spec` skill 的「新建 spec 流程」（`.claude/skills/yorz-spec/new-spec.md`）默认把 spec 写到 `<cwd>/.yorz/specs/<id>/spec.md`；当 worktree 是一个独立 YorZ 项目时，Agent 在该项目目录下运行，自然落到正确路径，无需改动 skill 路径逻辑。
- skill 没有「关联其它 spec / 冲突修复模板」相关的章节定义。

### 3.6 追加任务（fix 2026-06-29）现状

- `src/gui/src/pages/NewSpec.tsx:348-360` 渲染 `<label class="worktree-toggle">`，内部依次是 checkbox、`<span>新开项目并行</span>`、`<span class="muted">…长 tip 文案…</span>`。
- `src/gui/src/pages/Home.tsx:76-101` 渲染 `<div class="worktree-bar">`，包含：
  - `<div class="worktree-bar-info">`：`<span class="badge worktree">worktree</span>` + `<code>{branch}</code>` + `<span class="muted">主项目：{mainPath}</span>`；
  - `<button class="primary-action">⇧ 合入主项目</button>`；
  - 三段条件可见的状态/错误/toast `<span>`。
- 全局样式 `src/gui/src/styles.css` 中**完全没有** `.worktree-toggle` / `.worktree-bar` / `.worktree-bar-info` 选择器（已 grep 确认）。
- 根因：两处容器（`<label>`、`<div>`）默认为 block 布局，子元素中既有 inline 又有 block；缺少显式 `display: flex` 导致每个块级子元素自动换行，呈现"分成 3 行"的视觉效果。
- 用户体感问题之二：Home 页 worktree-bar 的 `worktree` badge 与 `wt/<branch>` 代码块属于"git worktree 技术词汇"，普通用户不需要理解 worktree 概念。

### 3.7 追加任务（fix 2026-06-29 16:18）现状

围绕第二轮 fix 的两项体感问题：

**问题 1：Home 页「⇧ 合入主项目」按钮过大**

- 当前实例 DOM：`<div class="worktree-bar"><div class="worktree-bar-info"><span class="muted">主项目：YorZ</span></div><button type="button" class="primary-action" title="提交 worktree 改动并合入主项目">⇧ 合入主项目</button></div>`。
- 按钮使用 `.primary-action` 类，全局基线样式定义在 `src/gui/src/styles.css:51-67`：所有 `button` 与 `.primary-action` 共享 `min-height: 44px; padding: 0.55rem 1rem`，叠加 primary 配色后视觉重量明显高于同行的「主项目：YorZ」纯文本，破坏了 worktree-bar 的轻量信息条调性。
- 同页面已存在的「刷新」按钮使用 `class="ghost"`（透明背景），但仍继承 44px min-height —— 项目内目前没有"小尺寸按钮"的样式约定。

**问题 2：侧栏 worktree 项目名以 `wt__` 开头**

- 当前实例 DOM：`<a title="/Users/fenghen/my-space/YorZ.wt/wt__agent-agent-agent" href="/wt-agent-agent-agent-370616" class="projects-sidebar-link active"><span class="name">wt__agent-agent-agent</span><span class="worktree-badge" title="worktree of /Users/fenghen/my-space/YorZ">⎇ main</span></a>`。
- 渲染链路：`src/gui/src/components/ProjectsSidebar.tsx:238` 直接读 `p.name`；`p.name` 由 Service 端 `src/service/project-registry.ts:74` 的 `basename(p.path)` 计算。
- worktree 项目路径由 `src/service/worktree-manager.ts:87-88` 构造：`<dirname(mainPath)>/<basename(mainPath)>.wt/<branch.replace('/', '__')>`。本例分支 `wt/agent-agent-agent` → 目录 `wt__agent-agent-agent` → basename 同名。
- 主项目身份信息已在 `p.worktree.mainPath` 中冗余可用（4.1 章节定义），无需后端再加字段即可在侧栏拼出"主项目名 + slug"的展示名。
- 影响面：侧栏 `.name` 文本是该问题唯一直接体验点；项目侧栏 tooltip 仍以 `p.path`（绝对路径）显示，可保留作为消歧。Home 页顶部信息条已展示主项目 basename（见 4.7），不重复。
- `.projects-sidebar-link` 已设置 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`（`styles.css:237-247`），其 inline 子节点（如 `.name`）天然继承截断行为，因此本次仅扩文本不需要新增 CSS。

## 4. 技术实现方案

### 4.1 数据模型扩展

扩展 `GlobalProjectEntry`，新增可选 `worktree` 字段：

```ts
interface GlobalProjectEntry {
  id: string
  path: string
  addedAt: string
  lastActivityAt: string | null
  worktree?: {
    mainProjectId: string // 主项目 id（GlobalProjectEntry.id）
    mainPath: string // 主项目绝对路径（冗余存放便于在主项目离线时仍可清理）
    branch: string // worktree 分支名
    specId: string // 触发该 worktree 的 spec id
    createdAt: string
  }
}
```

- 兼容：旧条目无 `worktree` 字段即视为主项目；侧栏可据此分组（主项目 → 其下的 worktrees）。
- `normalizeConfig` 增加该字段的容错解析（缺失 / 类型错误时丢弃 `worktree` 字段，但保留主项目身份）。

### 4.2 Service 端新增能力

新增 `WorktreeManager`（`src/service/worktree-manager.ts`，纯函数 + 子进程封装），核心动作：

1. `createWorktree({ mainProjectId, specSlug, branch? })`
   - 解析主项目路径与默认分支（`git rev-parse --abbrev-ref HEAD`）。
   - 目录策略：默认 `<mainPath>/../<mainBasename>.wt/<branch>`，保持磁盘上"主项目同级 + 单一聚合目录"，便于一眼识别。
   - 分支名：`wt/<specSlug>`（与 spec id 中的 summary-name 段对应，避免与已有分支冲突；若冲突追加 `-2/-3`）。
   - 执行 `git worktree add -b <branch> <wtPath> <baseRef>`。
   - 复制主项目的 `.yorz/config.json`（若存在）以保证 `specsDir` 等配置一致。
   - 调用 `registry.add(wtPath)`，再写回 `worktree` 元信息（`saveGlobalConfig`）。

2. `mergeBackToMain({ worktreeProjectId, commitMessage })`
   - 流程（每一步失败都立即终止并返回结构化错误）：
     1. 在 worktree 内：`git add -A` → 若有未提交变更则 `git commit -m <msg>`（无变更跳过提交）。
     2. 切到主项目目录：`git merge --no-ff <branch>`（或 `git pull` 若 worktree 推到了远端）。
     3. 合并成功 → `git worktree remove <wtPath>`（含 `--force` 兜底）→ `git branch -d <branch>`。
     4. 从 `ProjectRegistry` 移除 worktree 项目（`registry.remove(id)`）。
     5. 触发主项目 `reload`（已存在 `registry.reload(id)`），通知 GUI 项目列表与主项目 specs 重新拉取。
   - 合并冲突 → 进入 4.4 冲突自动恢复流程，**不**回滚已提交的代码。

3. `listWorktreesOf(mainProjectId)`：派生视图，供侧栏分组使用。

新增 HTTP 路由（`src/service/routes/project.ts` 或新文件 `routes/worktree.ts`）：

- `POST /api/projects/:id/worktrees` —— body 至少包含 `specSlug`，可选 `branch`。返回新 worktree 项目条目。
- `POST /api/projects/:id/merge-main` —— 仅 worktree 项目允许；返回 `{ status: 'merged' | 'conflict', conflictSpecId? }`。

### 4.3 新建 spec 流程改造

GUI `NewSpec.tsx`：

- 新增 checkbox「新开项目并行」，默认不勾选；旁边 `<span class="muted">` 展示 tips（"以 git worktree 形式开新分支并行开发，避免与主项目互相干扰；合并将通过列表页『合入主项目』按钮一键完成。"）。
- 勾选时：
  1. 先调用 `POST /api/projects/:id/worktrees`，拿到新 worktree 项目 id 与 path。
  2. 再调用 `api.createSpec(worktreeProjectId, body)`（含 type/requirement/draftId），spec 直接落到 worktree 目录。
  3. 跳转到 `/<worktreeProjectId>/specs/<specId>`。

Service 端 `POST /api/specs`（`src/service/routes/specs.ts`）保持不变——一旦项目切到 worktree id，AgentRunner 就在 worktree 目录下运行 Agent，spec.md 自然写到 worktree 目录。

skill 侧无需改动：skill 不感知"是否 worktree"，仅看到 `cwd` 是 worktree 路径，按现有 new-spec 流程写文件即可。

### 4.4 列表页「合入主项目」入口

- `ProjectsSidebar` 中：当项目为 worktree（`p.worktree != null`）时，在侧栏 item 上显示一个"⇧ 合入主项目"按钮；可选地把 worktree 折叠到主项目下方（v1 先扁平 + 视觉标记，分组留 v2）。
- Home 页（`src/gui/src/pages/Home.tsx`）：worktree 项目顶部新增项目级动作条，包含「合入主项目」主操作按钮 + 状态提示（pending changes / 合并中 / 完成）。
- 按钮逻辑：弹确认 → 输入/确认 commit message（默认 `feat(<branch>): merge from worktree`）→ POST 合并接口 → 进度通过 SSE 反馈：
  - `status: merged` → toast 提示 → 自动跳回主项目首页。
  - `status: conflict` → 自动跳到新建的"冲突解决 spec"详情页（见 4.5）。

### 4.5 冲突自动恢复流程

合并失败（`git merge` 退出码非 0、检测到 conflict marker、`MERGE_HEAD` 存在）时由 Service 自动：

1. **保留冲突状态**：不 `git merge --abort`，让 Agent 在原地用工具解决。
2. **收集"近期变更导致冲突的相关 commit"**（不依赖 touched-files）：
   - 列出当前冲突文件集合（`git diff --name-only --diff-filter=U`）。
   - 对每个冲突文件执行 `git log --since="30 days ago" --pretty=format:%h%x09%ad%x09%an%x09%s --date=short -- <file>`，汇总作者 / 日期 / 主题 / 哈希。
   - 同时取主项目 `git log --since="30 days ago" --merges` 中的近期合并点作为补充上下文。
   - 不再读取任何项目的 `touched-files.json`。
3. **新建一份"冲突解决 spec"**（写到主项目 `.yorz/specs/<日期>.fix.merge-conflict-<wtBranch>/spec.md`）：
   - frontmatter `stage: plan`，`summary` 自动生成。
   - `## 背景` 写入：冲突文件清单、待合入 worktree 信息、上一步收集到的近期相关 commit 列表（按文件分组，含作者 / 日期 / 哈希 / 主题）。
   - `## 需求` 写"在主项目工作区解决以下 git merge 冲突，最终保留两边的核心意图，必要时分别确认。"
4. **触发 Agent**：Service 的 `AgentRunner` 以"主项目 cwd + 这份 fix spec"作为入口启动；按 `yorz-spec` skill 推进。
5. GUI 跳转到该 spec 详情页，用户可以观察 Agent 输出并人工接管。
6. Agent 解决并通过 `git commit` 落地后，下一次合并由用户决定（视为新任务）；worktree 不在冲突分支上反复尝试。

### 4.6 兼容与回滚

- 现有项目零迁移：旧 `GlobalProjectEntry` 没有 `worktree`，所有 worktree 相关 UI/路由完全 inactive。
- worktree 项目即使在 Service 重启后也能被恢复（`worktree` 字段持久化在全局配置里）。
- 主项目离线/被 `yorz remove` 时，worktree 仍是合法 YorZ 项目，只是「合入主项目」按钮显示为禁用 + 提示"主项目不可达"。

### 4.7 追加任务（fix 2026-06-29）方案

最小修复半径：仅改 `src/gui/src/styles.css`（新增两段选择器） + `src/gui/src/pages/Home.tsx`（删去技术词汇渲染）。不动业务逻辑、不动数据结构。

1. CSS：在 `styles.css` 追加：
   - `.worktree-toggle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }`
     - 复用项目既有的 8px 间距节奏；`flex-wrap: wrap` 兜底窄屏（tip 较长时允许整段 tip 折到第二行而不挤裂 checkbox+主标题）；checkbox 与「新开项目并行」恒在第一行。
   - `.worktree-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }` 与 `.worktree-bar-info { display: flex; align-items: center; gap: 8px; }`
     - 同样给 wrap 兜底；按钮、提示与 info 在同一行水平排列。
2. Home.tsx 精简：
   - 删除 `<span class="badge worktree">worktree</span>` 与 `<code>{branch}</code>` 两个节点（"worktree" 字眼与 `wt/...` 分支名是 git 技术概念，普通用户无感知必要）。
   - 保留「主项目：<mainBasename>」（只展示主项目路径末段，不暴露绝对路径，亦不展示 worktree 概念），由 `worktree.mainPath` 取末段实现（`mainPath.split('/').filter(Boolean).pop()`，兼容尾部斜杠）。
   - 保留 `worktree-bar-info` 容器，作为 flex 子项继续承载这一句话。
3. 不需要 `NewSpec.tsx` 任何结构性改动——只靠 CSS 即可让三个元素同行。
4. 视觉回归：合并完成后跑 `npm run dev` 手动核对两处页面在常规桌面宽度（≥1024px）下不再折行，且窄屏（~600px）下不破版。

### 4.8 追加任务（fix 2026-06-29 16:18）方案

最小改动半径：仅 `src/gui/src/styles.css`（新增局部小按钮覆写）+ `src/gui/src/components/ProjectsSidebar.tsx`（计算 worktree 项目展示名）。不动 Service / 不动数据模型。

**问题 1：缩小「⇧ 合入主项目」按钮**

- 不引入全局"小按钮"通用类（避免与 5.1 决策快照中已固化的按钮基线打架）；只在 `.worktree-bar` 局部覆写 `.primary-action`，确保仅影响 worktree 项目顶部动作条。
- 在 `styles.css` 追加：

  ```css
  .worktree-bar .primary-action {
    min-height: 32px;
    padding: 4px 12px;
    font-size: 13px;
    border-radius: 6px;
  }
  ```

  保留 primary 配色，仅压缩 min-height / padding / font-size / 圆角。

**问题 2：侧栏 worktree 项目名以主项目名开头**

- 改动落在 GUI（`ProjectsSidebar.tsx`），不动 Service `list()` 返回的 `name`，避免影响其它消费者（路由、SSE、tooltip）。
- 新增本地小工具 `displayProjectName(p: ProjectListItem): string`：
  - `p.worktree == null` → 返回 `p.name`。
  - 否则：取 `mainBasename = p.worktree.mainPath.split('/').filter(Boolean).pop() ?? p.worktree.mainPath`；取 `slug = p.worktree.branch.replace(/^wt\//, '')`；返回 `` `${mainBasename} · ${slug}` ``（间隔点，前后各一个半角空格，例：`YorZ · agent-agent-agent`）。
- `<span class="name">` 渲染改读 `displayProjectName(p)`；`A.title` 仍保留 `p.path`（绝对路径）作为消歧 tooltip。
- 既有的 `⎇ main` badge 保持不变（已承担"这是 worktree"的语义）。
- 视觉回归：`.projects-sidebar-link` 已具备 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`（`styles.css:237-247`），inline 子节点自然继承截断；本次无需新增 CSS。

## 5. 待确认问题

- 暂无

### 5.1 已确认决策快照

- worktree 目录：`<mainPath>/../<mainBasename>.wt/<branch>`。
- 分支命名：`wt/<spec-summary-name>`，重名追加 `-2/-3`。
- 主项目合并方式：`git merge --no-ff <branch>`。
- 冲突相关 spec 定位：仅按 `git log` 文件历史（30 天窗口），不依赖 `touched-files.json`。
- 主项目自动更新：等同 merge 动作本身，不额外 `git pull`。
- commit message：默认 `feat(<branch>): merge from worktree`，弹窗内可编辑。
- 侧栏视觉：扁平 + worktree 项目名后追加 `⎇ main` badge。
- 冲突解决 spec：落在主项目 `.yorz/specs/`，type=`fix`，自动启动 Agent。
- worktree 项目 Home 页 `worktree-bar` 仅展示「主项目：<mainBasename>」（路径末段），不再渲染 `worktree` badge 与 `wt/<branch>` 技术词汇。
- worktree 项目侧栏展示名：`<mainBasename> · <slug>`（间隔点 + 前后空格；slug 为 branch 去掉 `wt/` 前缀；例：`YorZ · agent-agent-agent`）。
- 「⇧ 合入主项目」按钮缩小：仅 `.worktree-bar .primary-action` 局部覆写 `min-height: 32px; padding: 4px 12px; font-size: 13px; border-radius: 6px`，保留 primary 配色。

## 6. 任务清单

- [x] 扩展 `src/service/global-config.ts`：在 `GlobalProjectEntry` 增加可选 `worktree: { mainProjectId; mainPath; branch; specId; createdAt }` 字段，`normalizeConfig` 增加容错解析（缺失或类型错误时丢弃 `worktree` 字段但保留主项目身份）；验收：旧配置加载无报错且字段透传，新字段持久化往返一致。
- [x] 新建 `src/service/worktree-manager.ts`，实现 `createWorktree({ mainProjectId, specSlug, branch? })`：解析主项目路径与默认基准分支、生成 `<mainPath>/../<mainBasename>.wt/<branch>` 目录、分支名 `wt/<specSlug>`（已存在则追加 `-2/-3`）、执行 `git worktree add -b`、复制主项目 `.yorz/config.json`、调用 `registry.add(wtPath)` 并写回 `worktree` 元信息；验收：创建后 `git worktree list` 含新条目且全局配置出现含 `worktree` 字段的新项目。
- [x] 在 `src/service/worktree-manager.ts` 实现 `mergeBackToMain({ worktreeProjectId, commitMessage })`：worktree 内 `git add -A` + 有变更时 `git commit -m <msg>`、主项目内 `git merge --no-ff <branch>`、成功后 `git worktree remove <wtPath>` + `git branch -d <branch>` + `registry.remove(id)` + `registry.reload(mainProjectId)`；任一步失败结构化返回错误；验收：merged 返回后 worktree 目录/分支被清理、主项目分支 HEAD 含新 commit。
- [x] 在 `src/service/worktree-manager.ts` 实现 `listWorktreesOf(mainProjectId)` 派生视图，供侧栏分组使用；验收：返回数组长度与全局配置中归属该主项目的 worktree 条目数一致。
- [x] 新建 `src/service/routes/worktree.ts`：`POST /api/projects/:id/worktrees`（body `{ specSlug, branch? }`，返回新 worktree 项目条目）、`POST /api/projects/:id/merge-main`（仅 worktree 项目允许，返回 `{ status: 'merged' | 'conflict', conflictSpecId?, mainProjectId }`），并挂载到主 Hono app；验收：两接口在主项目 / worktree 项目上分别返回 200 / 400 符合预期。
- [x] 在 `worktree-manager.ts` 实现冲突自动恢复：合并失败时不 `--abort`，用 `git diff --name-only --diff-filter=U` 收集冲突文件，对每个文件执行 `git log --since="30 days ago" --pretty=format:%h%x09%ad%x09%an%x09%s --date=short -- <file>` 聚合近期相关 commit，再补充 `git log --since="30 days ago" --merges` 合并点；验收：冲突场景下返回的 conflict 详情包含按文件分组的 commit 列表，且未读取任何 `touched-files.json`。
- [x] 在冲突恢复流程中新建主项目 `<mainPath>/.yorz/specs/<YYMMDD>.fix.merge-conflict-<wtBranch>/spec.md`：frontmatter `stage: plan` + 自动 summary、`## 1. 背景` 写入冲突文件清单 / worktree 信息 / 上一步收集的 commit 列表（按文件分组）、`## 2. 需求` 写入"在主项目工作区解决以下 git merge 冲突"；随后调用 `AgentRunner` 以主项目 cwd + 该 spec 为入口启动 Agent；接口返回 `{ status: 'conflict', conflictSpecId, mainProjectId }`；验收：触发冲突后磁盘出现该 spec、Agent 任务被排入 runner 队列。
- [x] GUI `src/gui/src/lib/api.ts` 新增 `createWorktree(projectId, body)` 与 `mergeWorktreeToMain(projectId, body)` 两个调用，与新增路由对齐；验收：TypeScript 类型贯通且返回结构匹配 Service。
- [x] GUI `src/gui/src/pages/NewSpec.tsx`：新增 checkbox「新开项目并行」（默认不勾选）+ 提示文本"以 git worktree 形式开新分支并行开发，避免与主项目互相干扰；合并将通过列表页『合入主项目』按钮一键完成。"；勾选时先 `createWorktree` 获取 worktreeProjectId 与 path，再 `createSpec(worktreeProjectId, body)` 并跳转 `/<worktreeProjectId>/specs/<specId>`；验收：勾选与未勾选分别走两条路径，新 spec 文件落位正确。
- [x] GUI `src/gui/src/components/ProjectsSidebar.tsx`：当 `p.worktree != null` 时在项目名后渲染 `⎇ main` badge（含 tooltip 显示主项目名）；保持扁平列表，不引入折叠分组；验收：worktree 项目视觉可区分且排序逻辑未受影响。
- [x] GUI `src/gui/src/pages/Home.tsx`：worktree 项目顶部新增项目级动作条，包含「合入主项目」按钮 → 弹窗确认 commit message（默认 `feat(<branch>): merge from worktree`，可编辑）→ 调用 `mergeWorktreeToMain`；`status: merged` 触发 toast + 跳回 `/<mainProjectId>`，`status: conflict` 跳到 `/<mainProjectId>/specs/<conflictSpecId>`；验收：两种返回路径分别可在 GUI 中体验到正确跳转。
- [x] 在 Home 页主项目离线（`mainProjectId` 不在当前 registry）的情况下：禁用「合入主项目」按钮并显示 "主项目不可达" 提示；验收：手动 `yorz remove <main>` 后该 worktree 项目页面按钮即变禁用。
- [x] 在 `src/gui/src/styles.css` 追加 `.worktree-toggle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }`，让 NewSpec 页 checkbox + 「新开项目并行」 + 长 tip 在桌面宽度（≥1024px）同行展示，窄屏（~600px）允许 tip 换行而 checkbox+主标题仍同一行；验收：浏览器实测同一行渲染，窄屏不破版。
- [x] 在 `src/gui/src/styles.css` 追加 `.worktree-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }` 与 `.worktree-bar-info { display: flex; align-items: center; gap: 8px; }`，让 Home 页 worktree 项目顶部动作条 info 区与按钮、状态提示水平排列；验收：常规桌面宽度下不再折成三行。
- [x] 修改 `src/gui/src/pages/Home.tsx` 的 worktree-bar：删除 `<span class="badge worktree">worktree</span>` 与 `<code>{branch}</code>` 节点；将「主项目：{mainPath}」改为只展示主项目路径末段（用 `mainPath.split('/').filter(Boolean).pop()` 取 basename，兼容尾斜杠）；保留 `worktree-bar-info` 容器；验收：worktree 项目首页不再出现 `worktree` 字样与 `wt/<branch>` 分支名，且「主项目：<mainBasename>」正确显示。
- [x] 在 `src/gui/src/styles.css` 新增局部覆写 `.worktree-bar .primary-action { min-height: 32px; padding: 4px 12px; font-size: 13px; border-radius: 6px }`，仅缩小 Home 页 worktree 项目顶部「⇧ 合入主项目」按钮，保留 primary 配色；验收：浏览器实测 worktree-bar 内按钮明显变小且不影响其它页面 `.primary-action` 基线。
- [x] 在 `src/gui/src/components/ProjectsSidebar.tsx` 新增本地 `displayProjectName(p)`：当 `p.worktree != null` 返回 `` `${basename(p.worktree.mainPath)} · ${p.worktree.branch.replace(/^wt\//, '')}` ``（basename 用 `mainPath.split('/').filter(Boolean).pop() ?? mainPath`），否则返回 `p.name`；`<span class="name">` 渲染改读该函数，`A.title` 仍保留 `p.path`；验收：侧栏 worktree 项目展示名形如 `YorZ · agent-agent-agent`，主项目展示名不变。

## 7. 追加任务

- [fixed] [fix] 2026-06-29 11:39 | 1. 新建spec页面，这些元素应该出现在同一行，目前是分成了三行：<label class="worktree-toggle"><input type="ch
  - 描述：1. 新建spec页面，这些元素应该出现在同一行，目前是分成了三行：<label class="worktree-toggle"><input type="checkbox"><span>新开项目并行</span><span class="muted">以 git worktree 形式开新分支并行开发，避免与主项目互相干扰；合并将通过列表页『合入主项目』按钮一键完成。</span></label>

2. Spec列表页，这几个元素也折行了，应该出现在同一行，同时移除 worktree 元素，不用把技术概念暴露给用户：<div class="worktree-bar"><div class="worktree-bar-info"><span class="badge worktree">worktree</span><code>wt/agent-agent-agent</code><span class="muted">主项目：/Users/fenghen/my-space/YorZ</span></div><button type="button" class="primary-action" title="提交 worktree 改动并合入主项目">⇧ 合入主项目</button></div>

- [fixed] [fix] 2026-06-29 16:18 | 1. 按钮尺寸太大了： <div class="worktree-bar"><div class="worktree-bar-info"><span class
  - 描述：1. 按钮尺寸太大了： <div class="worktree-bar"><div class="worktree-bar-info"><span class="muted">主项目：YorZ</span></div><button type="button" class="primary-action" title="提交 worktree 改动并合入主项目">⇧ 合入主项目</button></div>

2. 左侧菜单栏，项目名称应该使用主项目名字开头，替代掉 wt：<a title="/Users/fenghen/my-space/YorZ.wt/wt__agent-agent-agent" href="/wt-agent-agent-agent-370616" class="projects-sidebar-link active" link="" aria-current="page"><span class="name">wt\_\_agent-agent-agent</span><span class="worktree-badge" title="worktree of /Users/fenghen/my-space/YorZ">⎇ main</span></a>

## 8. 执行记录

- 2026-06-28 新建 spec，初始化骨架并完成 plan 阶段的现状分析、技术实现方案与待确认问题；阻塞于用户对 8 项待确认问题的批注。
- 2026-06-28 用户批量答复 8 项待确认问题；消费批注并把"冲突相关 spec 定位"改为仅按 `git log` 文件历史（30 天窗口），其余决策与原方案一致；删除 `## 用户批注` 章节并生成 12 条可执行任务；stage 切换为 `tasks`，待自动进入 execute。
- 2026-06-28 stage 切到 `execute`；完成任务 1：`src/service/global-config.ts` 新增 `WorktreeMeta` 类型与 `GlobalProjectEntry.worktree` 可选字段；`normalizeConfig` 增加 `normalizeWorktree` 容错（缺失关键字段时丢弃 worktree 但保留主项目身份）；并新增 `setProjectWorktree(id, meta|null)` 持久化辅助方法。验证：类型贯通；现有 `normalizeConfig` 路径对旧条目零行为变化（无 worktree 字段则透传为主项目）。
- 2026-06-28 评估剩余 11 项实现属于 Review 级别决策（跨 Service 数据模型/WorktreeManager/HTTP 路由/冲突自动恢复/3 处 GUI/自动启 Agent），按 skill 规则在此阻塞，等待用户对 execute 推进策略给出选择（全量 / 仅 Service / 仅 GUI / 暂停）。
- 2026-06-28 重新评估上一条阻塞理由：skill 路由规则仅以「`！！！`批注 / 待确认问题 / 追加任务 `[open]`」作为合法阻塞点，「Review 级别决策」不在此列；恢复 execute 继续推进。
- 2026-06-28 完成任务 2-4 + 6 + 7：新建 `src/service/worktree-manager.ts`，封装 `createWorktree` / `mergeBackToMain` / `listWorktreesOf` / `collectConflictReport` / `handleMergeConflict`；为复用 git 子进程封装，在 `src/service/git.ts` 增加 `runGitChecked` 与 `runGitRaw`（非抛错的 raw 形式，用于 `git merge` 这类「非零退出码即有效信号」的命令）。冲突文件历史采集严格使用 `git log --since=30 days ago ...`，未读取任何 `touched-files.json`。冲突 spec id 采用代码库现有 `YYMMDD.<type>.<slug>` 习惯（spec 描述里写的 `YYYYMMDD` 仅作格式占位，实际以 `WorktreeManager.compactDate` 输出 `YYMMDD`）。
- 2026-06-28 完成任务 5：新建 `src/service/routes/worktree.ts`（Hono 路由），实现 `POST /api/projects/:projectId/worktrees`（主项目→worktree 项目，含 `specSlug` 校验、主项目自身禁止递归 worktree）与 `POST /api/projects/:projectId/merge-main`（仅 worktree 项目可调用，错误项目返回 400）；在 `src/service/server.ts` 中实例化 `WorktreeManager` 并挂载新路由。
- 2026-06-28 完成数据贯通：`src/service/project-registry.ts` 的 `ProjectListItem` 增加可选 `worktree` 字段并在 `list()` 中透传；`src/gui/src/lib/project.ts` 同步加入 `WorktreeMeta` 类型与 `ProjectListItem.worktree`，保证 GUI 端可基于 list 直接判断 worktree 身份。
- 2026-06-28 完成任务 8：`src/gui/src/lib/api.ts` 增加 `createWorktree` / `mergeWorktreeToMain` 两个调用、`CreateWorktreeResponse` / `MergeWorktreeResponse` 类型，与 Service 返回结构对齐。
- 2026-06-28 完成任务 9：`src/gui/src/pages/NewSpec.tsx` 新增「新开项目并行」checkbox + 提示文本；勾选时通过 `deriveSlug(requirement)` 推导 `specSlug` → `createWorktree` 拿到 worktreeProjectId → 用其作为目标 pid 调 `createSpec`，并把 SSE 订阅与列表轮询都切到 worktree pid，跳转路径写死为 `/<worktreeProjectId>/...` 而非依赖当前路由上下文。
- 2026-06-28 完成任务 10：`src/gui/src/components/ProjectsSidebar.tsx` 在 worktree 项目名后渲染 `⎇ main` badge（tooltip 显示主项目路径），保持扁平列表与排序逻辑不变。
- 2026-06-28 完成任务 11 + 12：`src/gui/src/pages/Home.tsx` 在 worktree 项目顶部新增 `worktree-bar` 操作条，弹 `prompt` 让用户编辑 commit message（默认 `feat(<branch>): merge from worktree`），根据 `mergeWorktreeToMain` 返回 `merged` / `conflict` 分别跳转主项目首页或冲突 spec 详情；当 `mainProjectId` 不在 `listProjects()` 结果中时按钮禁用并显示"主项目不可达"。
- 2026-06-28 验证：`npx tsc --noEmit` 仅余 `QuestionConfirmPanel.tsx:46` 的旧错误（与本 spec 改动无关）；`npx vitest run` 23 个测试文件全部通过，共 182 / 182。
- 2026-06-29 收到追加任务 `[open] [fix]`：NewSpec 页 `.worktree-toggle` 与 Home 页 `.worktree-bar` 分别折成三行，且 Home 页暴露了 `worktree` badge 与 `wt/<branch>` 技术概念。stage 切回 `plan`：定位根因为 `styles.css` 缺失这两个选择器（默认 block 布局导致换行）；补充 3.6 / 4.7 章节给出最小修复方案，并就「主项目: <path>」是否保留留 1 项待确认问题；阻塞等待用户批注。
- 2026-06-29 消费 `## 用户批注` 中的 `！！！` 答复：选定「主项目：<mainBasename>」方案；更新 4.7 与 5.1 决策快照、清空待确认问题、删除用户批注章节，并拆出 3 项可执行任务（CSS × 2 + Home.tsx × 1），stage 切到 `tasks` 准备进入 execute。
- 2026-06-29 完成 3 项追加修复任务：
  - `src/gui/src/styles.css` 第 558 行前新增 `.worktree-toggle` / `.worktree-bar` / `.worktree-bar-info` 三段 flex 规则（gap 8/12/8、`flex-wrap: wrap` 兜底窄屏）。
  - `src/gui/src/pages/Home.tsx` worktree-bar 内删除 `worktree` badge 与 `<code>{branch}</code>` 节点；「主项目：」改为 `mainPath.split('/').filter(Boolean).pop() ?? mainPath` 取末段 basename，兼容尾斜杠。
  - 追加任务 `[open] → [fixed]`，原描述位置不动作历史保留。
  - 验证：`npx tsc --noEmit` 仅余 `QuestionConfirmPanel.tsx:46` 旧错误（与本 spec 改动无关）；视觉回归需手动 `npm run dev` 在 ≥1024px 与 ~600px 两档复核（待人工执行）。
- 2026-06-29 收到第二轮追加任务 `[open] [fix]`（16:18）：①「⇧ 合入主项目」按钮过大；②侧栏 worktree 项目名 `wt__agent-agent-agent` 应以主项目名开头。stage 切回 `plan`：补 3.7 现状（按钮基线 44px、侧栏 name 来自 `basename(p.path)`）+ 4.8 方案（GUI 局部覆写 + ProjectsSidebar 计算展示名，不动 Service）；提 2 条候选项问题（展示名格式 / 按钮缩小规格）阻塞等待用户批注。
- 2026-06-29 消费 `## 用户批注` 中的 `！！！` 答复：展示名选定 `YorZ · agent-agent-agent`（间隔点 + 前后空格）、按钮缩小选定 `min-height: 32px; padding: 4px 12px; font-size: 13px; border-radius: 6px`（保留 primary 配色）；落实到 4.8、追加到 5.1 决策快照、清空 5. 待确认问题、删除 `## 用户批注` 章节、将「追加任务」与「执行记录」按规范重排为 7 / 8；拆出 2 条可执行任务（CSS 局部覆写 × 1 + ProjectsSidebar 展示名 × 1）；stage 切到 `tasks` 准备衔接 execute。
- 2026-06-29 完成第二轮追加修复 2 项任务：
  - `src/gui/src/styles.css`：在 `.worktree-bar-info` 之后追加 `.worktree-bar .primary-action { min-height: 32px; padding: 4px 12px; font-size: 13px; border-radius: 6px }` 局部覆写，仅作用于 worktree-bar 内的 primary-action。
  - `src/gui/src/components/ProjectsSidebar.tsx`：新增本地工具 `displayProjectName(p)`（worktree → `${basename(mainPath)} · ${branch去掉wt/前缀}`，主项目 → `p.name`）；`<span class="name">` 渲染改读该函数，`A.title` 仍保留 `p.path` 作消歧 tooltip。
  - 追加任务 16:18 条目 `[open] → [fixed]`，原描述位置不动作历史保留。
  - 验证：`npx tsc --noEmit` 仅余 `QuestionConfirmPanel.tsx:46` 旧错误（与本 spec 改动无关）；视觉回归需手动 `npm run dev` 在常规桌面宽与窄屏复核两处 UI（待人工执行）。

## 执行记录

- 2026-06-29 提交 ce39cda：feat(260628.feat.agent-worktree-workflow): 为 Agent 并行开发提供 git worktree 工作流：新建 spec 可勾选「新开项目并行」自动建 worktree 并注册为 YorZ 项目；worktree 项目列表页支持「合入主项目」（4 个文件）

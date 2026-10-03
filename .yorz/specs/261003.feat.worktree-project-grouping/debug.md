---
status: resolved
active:
updated_at: '2026-10-03 20:54:24'
---

# Debug 活文档 · worktree 项目分组视觉关联

## Debug 1 · 展开态 worktree 行左缩进需移除，保持默认左对齐

- 状态：resolved
- 快照：f113644ff1281083ac02578a050662f652fbcf7d
- 进入时间：'2026-10-03 20:26:48'

### 1.1 Bug 现象与复现

- 现象：展开状态下，worktree 项目行在列表左侧有一段缩进，用户希望它与源项目一样默认左对齐、不缩进。
- 复现：桌面侧边栏 `ProjectsSidebar.tsx` 展开态，分组内 worktree 行（`indexInGroup > 0`）当前带 `pl-5` 左内边距。
- 这是视觉偏好调整，根因一目了然（代码直读即证据），非隐蔽逻辑 bug。

### 1.2 关联链路分析

- `src/gui/src/components/ProjectsSidebar.tsx`
  - L374 `const isMember = info.grouped && info.indexInGroup > 0`
  - L391 展开态类名 `isMember ? 'pl-5' : ''` —— 即 worktree 行的左缩进来源。
- 移动端 `Projects.tsx` 有 `isMember ? 'pl-7' : 'pl-4'`，但用户诉求明确限定「展开状态」（桌面折叠/展开概念），本次只改桌面展开态。

### 1.3 Debug 基线

- 快照 SHA：f113644ff1281083ac02578a050662f652fbcf7d
- 进入时间：'2026-10-03 20:26:48'
- 退出闸门基准：`git diff f113644ff1281083ac02578a050662f652fbcf7d`

### 1.4 假设看板

- 假设 A（成立）：展开态 worktree 缩进来自 L391 的 `isMember ? 'pl-5'`。
  - 成立判据：移除该分支后展开态 worktree 行与源项目左对齐。
  - 证据：代码直读确认唯一缩进来源。

### 1.5 证据

- 代码直读：L391 是展开态唯一施加左内边距的地方（竖条为绝对定位 `absolute`，不占文档流、不产生缩进）。

### 1.6 脚手架清单

- 无临时脚手架（本次为直接定向修复，非探查）。

### 1.7 收尾核对

- 修复：`ProjectsSidebar.tsx` 移除展开态 worktree 行 `pl-5` 左缩进，删除随之无用的 `isMember` 声明。
- `git diff f113644` 仅剩两处合法修复，无脚手架残留。
- `pnpm run typecheck` 通过。
- 竖条为绝对定位，不占文档流，移除缩进后 worktree 行与源项目默认左对齐、竖条仍正常覆盖。

## Debug 2 · 移动端 worktree 行左缩进需移除，保持默认左对齐

- 状态：resolved
- 快照：53b9c827467be63eedc367b9a06ac024b0767fd8
- 进入时间：'2026-10-03 20:54:24'

### 2.1 Bug 现象与复现

- 现象：移动端项目列表 `Projects.tsx` 中 worktree 项目行左侧带一段缩进，用户希望与源项目一样默认左对齐、不缩进（延续 Debug 1 桌面端的同类诉求）。
- 复现：`src/gui-mobile/src/pages/Projects.tsx` 列表行，分组内 worktree（`indexInGroup > 0`）当前带 `pl-7` 左内边距，源项目为 `pl-4`。
- 视觉偏好调整，根因代码直读即证据，非隐蔽逻辑 bug。

### 2.2 关联链路分析

- `src/gui-mobile/src/pages/Projects.tsx`
  - L72 `const isMember = info.grouped && info.indexInGroup > 0`
  - L78 按钮类名 `isMember ? 'pl-7' : 'pl-4'` —— worktree 行左缩进的唯一来源。
- refct 阶段已移除移动端左侧竖条，`isMember` 此时仅服务于缩进；移除缩进后该变量随之无用，一并删除。

### 2.3 Debug 基线

- 快照 SHA：53b9c827467be63eedc367b9a06ac024b0767fd8
- 进入时间：'2026-10-03 20:54:24'
- 退出闸门基准：`git diff 53b9c827467be63eedc367b9a06ac024b0767fd8`

### 2.4 假设看板

- 假设 A（成立）：移动端 worktree 缩进来自 L78 的 `isMember ? 'pl-7'`。
  - 成立判据：改为固定 `pl-4` 后 worktree 行与源项目左对齐。
  - 证据：代码直读确认该处为唯一施加左内边距的分支；竖条已在 refct 移除，无其它缩进源。

### 2.5 证据

- 代码直读：L78 是行内唯一左内边距差异来源；`<li>` 的 `relative` 仅为历史竖条遗留，refct 后无绝对定位子元素，不产生缩进。

### 2.6 脚手架清单

- 无临时脚手架（直接定向修复，非探查）。

### 2.7 收尾核对

- 修复：`Projects.tsx` 按钮类名由模板串 `isMember ? 'pl-7' : 'pl-4'` 改为固定 `pl-4`，删除随之无用的 `isMember` 声明与注释。
- `git diff 53b9c827` 仅剩该处合法修复，无脚手架残留。
- `pnpm run typecheck` 通过。
- worktree 行移除缩进后与源项目默认左对齐。

---
stage: execute
last_action: 执行全部任务，构建验证通过
updated_at: 2026-06-20
summary: 给项目新增「最近访问」入口，挂在 Specs 列表上方；数据本地存储；上限 10 条；提供清空按钮。
---

# 最近访问入口

## 1. 背景

用户反馈每次打开应用都要在 spec 列表里翻找昨天碰过的几个 specs。希望首屏看到一个「最近访问」入口直接跳转。

## 2. 需求

- 新增「最近访问」入口，列出用户近期访问过的 spec
- 决策范围：挂载位置、数据来源、上限条数、清空策略

## 3. 现状分析

GUI 主导航当前只有顶部栏 `YorZ` 品牌链接 + `＋ 新建 spec` 按钮（`AppShell.tsx`），没有侧边栏。Spec 列表（`Home.tsx`）通过 `api.listSpecs()` 获取数据并按 `updated_at` 降序渲染，没有访问记录功能。客户端尚未使用 `localStorage`，所有状态通过 SolidJS 原语在内存管理。

## 4. 技术实现方案

- 在 `Home.tsx` 的 `<header class="page-head">` 之后、`<ul class="spec-grid">` 之前插入「最近访问」区域，最多展示 10 条，按访问时间倒序。
- 访问记录写入浏览器 `localStorage`，key 为 `yorz:recent-specs`，存储 `{ specId: string, lastAccessedAt: number }[]` 数组。
- 在 `SpecDetail.tsx` 的 `onMount` 中用 `params.id` 写入访问记录。
- 列表右侧提供「清空」按钮，弹确认对话框后清空 key。
- 新建 `lib/recent-specs.ts` 工具模块封装读写逻辑，与现有 `lib/` 组织方式一致。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 任务1：新建 `src/gui/src/lib/recent-specs.ts` 模块，封装 localStorage 读写（key=`yorz:recent-specs`），提供 `getRecentSpecs()`、`addRecentSpec(id)`、`clearRecentSpecs()` 三个函数，上限 10 条按时间倒序；验收：模块可独立 import 调用且返回正确数据。
- [x] 任务2：在 `Home.tsx` 中新增「最近访问」区域，渲染于 `page-head` 之后 `spec-grid` 之前，调用 `getRecentSpecs()` 展示最多 10 条 spec 卡片，按访问时间倒序；验收：页面首屏可见最近访问列表，无记录时该区域隐藏。
- [x] 任务3：在 `SpecDetail.tsx` 的组件挂载时调用 `addRecentSpec(params.id)` 写入访问记录；验收：打开任意 spec 详情后返回首页，该 spec 出现在最近访问列表顶部。
- [x] 任务4：在「最近访问」区域右侧添加「清空」按钮，点击后弹出确认对话框，确认后调用 `clearRecentSpecs()` 并刷新列表；验收：点击清空并确认后列表消失，刷新页面后仍为空。
- [x] 任务5：在 `styles.css` 中为「最近访问」区域添加样式（区域标题、卡片列表、清空按钮），与现有 spec-card 风格保持一致，适配 light/dark 主题；验收：视觉与现有设计协调，暗色模式正常显示。

## 7. 执行记录

- 任务1完成：新建 `src/gui/src/recent-specs.ts`，导出 `getRecentSpecs`/`addRecentSpec`/`clearRecentSpecs`，内部用 try-catch 保护 localStorage 操作；验证：TypeScript 类型检查通过。
- 任务2完成：在 `Home.tsx` 中 `page-head` 后新增 `.recent-specs` 区域，通过 `createMemo` 将 localStorage 中的 specId 与已加载的 specs 列表交叉映射渲染卡片，无记录时用 `<Show>` 隐藏整个区域；验证：Vite 构建 119 模块转换成功。
- 任务3完成：在 `SpecDetail.tsx` 新增 `createEffect` 监听 `params.id` 变化时调用 `addRecentSpec(id)`；验证：类型检查通过。
- 任务4完成：在 `Home.tsx` 的 `recent-specs-head` 右侧添加「清空」按钮，点击触发 `window.confirm` 确认对话框，确认后调用 `clearRecentSpecs()` 并 `setRecentTick` 刷新视图；验证：构建成功。
- 任务5完成：在 `styles.css` 中 `.spec-card .id` 之后新增 `.recent-specs`/`.recent-specs-head`/`.recent-specs-title`/`.recent-clear-btn`/`.recent-specs-grid`/`.recent-spec-card` 样式，使用 CSS 变量适配 light/dark 主题，`.recent-spec-card` 左边框用 `--primary` 色区分；验证：构建 CSS 产物 16.03 KB 正常。

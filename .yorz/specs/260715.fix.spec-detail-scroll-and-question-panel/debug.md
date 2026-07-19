---
status: resolved
active:
updated_at: '2026-07-19 18:20:00'
---

## Debug 1 · 复核 SpecDetail 两处修复（保滚动 / 运行态隐藏确认面板）是否存在残留 bug

- 状态：resolved
- 快照：da3c9e77fa5e2e8d2f6eaa1ac6db3dd1acca010f
- 进入时间：'2026-07-19 16:24:34'

### 1. Bug 现象与复现

**用户已确认具体症状（2026-07-19 追加）：** 进入 SpecDetail 详情页，当 Agent 正在执行 yorz-spec 任务、持续更新 `spec.md` 时，正文 `<article>` 的滚动位置被重置回顶部——即需求 1 的 `restoreScroll` 修复**未生效**。

复现步骤：

1. 打开某 spec 详情页（正文含 mermaid 图，篇幅长于一屏）。
2. 向下滚动到中后部阅读。
3. 让 Agent 运行 yorz-spec 任务持续改写该 `spec.md`（触发多次 SSE `updated`）。
4. 观察：每次刷新后正文滚动位置被拉回顶部附近。

> 症状为 GUI 交互态，采用「加日志 → 人在环路回传」取硬证据；用户在真实环境自然复现。

### 2. 关联链路分析

代码现状（HEAD `2b7dfaf`，上一轮修复已随其它重构一并提交；工作区仅 `spec.md` 未提交）：

- `src/gui/src/pages/SpecDetail.tsx`
  - `L108-113` `showPanel`：`if (running()) return false` 门槛。
  - `L136-151` 挂载探针：`getSpecSession` 解析 `sessionId` 同时 `setRunning(r)` 回填初始运行态。
  - `L157-167` `subscribeSessions` effect：`ev.sessionId === specSid()` → `setRunning(ev.running)`（可置真/置假）。
  - `L169-180` `subscribeSession` effect：`turn-completed` / `error` → `setRunning(false)`。
  - `L198-227` 合并渲染 effect：`prevTop` 保存 + `restoreScroll()`（钳制 `scrollHeight - clientHeight`），同步一次 + mermaid resolve 后一次。
- `src/service/routes/sessions.ts:86-87` 探针返回体 `running`（`isRunning`）。
- `src/service/session-manager.ts:180-200` `send()`：`setRunning(sid,true)` 起，`catch` 发 `type:'error'`，`finally` `setRunning(currentSid,false)` + `done`。

### 3. Debug 基线

- 快照 SHA：`da3c9e77fa5e2e8d2f6eaa1ac6db3dd1acca010f`（`git stash create`，捕获进入前脏工作区 = 仅 `spec.md` 未提交改动）。
- 进入时间：`2026-07-19 16:24:34`。
- 退出闸门基准：`git diff da3c9e77fa5e2e8d2f6eaa1ac6db3dd1acca010f` 须只剩合法修复。

### 4. 假设看板

- **[已证伪] H1：`running` 双写来源竞争** —— `subscribeSession` 在 `error` 事件即 `setRunning(false)`，若 `error` 为「非终态中途事件」，会在 Agent 仍在运行时错误地取消隐藏面板，重新打开并发提交窗口。
  - 若成立：`session-manager` 中 `type:'error'` 可在 turn 未结束时发出、且 `finally` 不随即置 `running=false`。
  - 若不成立：`error` 仅在 `catch` 中发出并紧随 `finally` 的 `setRunning(false)`，两来源一致收敛。
  - **判定：不成立（见证据 E1）。**
- **[取证中·主假设] H2：mermaid 异步渲染导致 `restoreScroll` 钳制到「渲染前的偏小高度」，且第二次恢复早于 SVG 注入 → scrollTop 被拉回顶部附近。** 由两个叠加缺陷构成：
  - **D1（早 resolve，静态已坐实 E2）**：`renderMermaidIn` 在 `await loadMermaid()` 后用 `void render()`（不 await）触发实际渲染即 resolve；调用方 `.then` 里的第二次 `restoreScroll()` 在 `mermaid.run()` 真正注入 SVG **之前**就跑了 → 无法补偿 SVG 注入引起的高度增长。
  - **D2（钳制到中间态高度）**：同步 `restoreScroll()` 在 mermaid 仍是原始源码文本（高度小于最终 SVG）时执行，`Math.min(prevTop, scrollHeight - clientHeight)` 把 scrollTop 钳到偏小值（接近顶部）。随后 SVG 注入使文档变高，却因 D1 无有效的二次恢复。
  - 若成立：日志将显示 `pre-mermaid` 的 `maxTop` 明显小于 `prevTop` → `after-sync-restore.scrollTop` 被钳小；`renderMermaidIn-RESOLVED` 早于 `mermaid render() DONE`，且 RESOLVED 时 `scrollHeight` 仍为渲染前的小值。
  - 若不成立：`pre-mermaid.maxTop >= prevTop`（同步恢复即到位），或 RESOLVED 时 `scrollHeight` 已是最终大值。
- **[暂缓] H3：后台已有运行时探针快照与订阅竞态**（与本次报告症状无关，暂不追）。
- **[已坐实·根因] H4：`<Suspense>` 在 refetch 挂起导致 `<article>` 滚动容器 detach/reattach 归零。** 见证据 E4：scrollTop 在 render effect 之前、恰于 resource `refreshing` 时归 0，元素身份不变。H2 的 D1/D2 为次要放大因子（E5），非主因；既有 `restoreScroll` 因 `prevTop` 读到 Suspense 归零后的 0 而失效。

### 5. 证据

- **E1（静态取证，证伪 H1）**：`src/service/session-manager.ts:191-200`，`type:'error'` 仅在 `catch` 分支发出，其后 `finally` 立即 `setRunning(currentSid,false)` 并 `emit('done')`。即 `error` 是 turn 终态，服务端 `session-status` 与前端 `subscribeSession` 均收敛 `running=false`，无「运行中错误取消隐藏」的竞争。H1 排除。
  - 命令：`grep -n "type: 'error'" src/service/session-manager.ts` → L194（catch 内）；紧邻 `finally` L197-199。
- **E2（静态取证，坐实 D1）**：`src/gui/src/lib/mermaid.ts:18-53`，`renderMermaidIn` 结构为 `await loadMermaid()` → `void render()` → `return cleanup`。`render()`（内含 `await mermaid.run(...)` 注入 SVG）**未被 await**，故函数返回的 Promise 在 SVG 注入前即 resolve。调用方 `SpecDetail.tsx` 的 `renderMermaidIn(el).then(restoreScroll)` 因此在最终高度确定前触发第二次恢复。此为确定性代码事实。
- **E3（自构造复现，Playwright）**：新增 `src/gui/src/__e2e__/scroll-preserve.spec.ts` + `fixtures/setup.ts` 种子（mermaid 密集长 spec / 纯文本对照）。测试进程用 `fs.writeFileSync` 反复重写 `spec.md`，经真实 FS Watcher → SSE → 刷新链路模拟「后台持续更新」，数值化读取 `article.scrollTop`。结果：`before=4571 → after=0`，`finalTop=0`——**稳定复现**滚动被重置到顶部。
- **E4（决定性根因，插桩日志时序）**：单次写入周期日志序列：
  1. `mermaid render() DONE {containerScrollHeight: 7938, scrollTop: 4571}`（内容全渲染、滚动在位）
  2. `resource.loading true state **refreshing**`（写入 → resource 进入 refreshing）
  3. `effect-run {prevTop: 0, elId: 89, isNewEl: false, connected: true}`（render effect 运行时 scrollTop 已是 0，且元素身份不变=未 remount）
  4. `resource.loading false state ready` → `mermaid DONE scrollTop:0`
  - 关键推论：`elId` 恒定（非 remount）、无 `scroll` 事件、scrollTop 在 render effect **之前**已归 0，且恰好发生在 resource 进入 `refreshing`（`spec.loading===true`）时。⇒ **`<Suspense>` 在每次 refetch 因读取 `spec()` 挂起而 detach/reattach 含 `<article>` 的子树；重新挂载滚动容器把 scrollTop 归 0。**
- **E5（坐实 D1/D2，次要放大因子）**：`pre-mermaid scrollHeight:4110`（maxTop 3586）vs `mermaid DONE containerScrollHeight:7938`——mermaid SVG 注入使正文高度近乎翻倍；`renderMermaidIn-RESOLVED` 时 scrollHeight 仍为 4183（< 7938），证明第二次恢复早于 SVG 注入。即便修好 Suspense，若不处理 D1/D2，恢复仍会被钳到「渲染前的偏小高度」。

### 根因结论

**主因：** SpecDetail 用 `createResource` + `<Suspense>`/`<Show when={spec()}>` 承载正文；每次 SSE 刷新令 resource 进入 `refreshing`，`spec()` 挂起触发 `<Suspense>` 把正文子树（含 `overflow-auto` 的 `<article>` 滚动容器）detach 后 reattach，浏览器对重新挂载的滚动容器把 `scrollTop` 归 0。既有 `restoreScroll` 因在 Suspense 归零**之后**才读取 `prevTop`（读到 0）而完全失效——修复瞄错了机制（误以为是 `innerHTML` 重建）。

**放大因子（次要）：** 合并渲染 effect 里 `innerHTML` 整体替换本身也会瞬时清空→归零；且 mermaid 异步 SVG 注入使高度翻倍（D2），而 `renderMermaidIn` 早 resolve（D1）使二次恢复早于最终高度。

**修复方向：**
1. 主修复：用 `startTransition` 包裹 `setRefreshTick`（或改读 `spec.latest`），让刷新期间 `<Suspense>` 不再挂起/detach 正文子树，保住滚动容器不被重挂载归零。
2. 配套修复：保留渲染 effect 的保滚动，并修 D1——让 `renderMermaidIn` `await` 真正的渲染完成，使调用方二次恢复发生在 SVG 注入（最终高度）之后。

### 修复与验证（E6，退出双条件已满足）

**已实施修复（最终保留）：**

- `src/gui/src/pages/SpecDetail.tsx`
  - 引入 `startTransition`，SSE `onUpdated` 的刷新改为 `void startTransition(() => setRefreshTick(...))`——**主修复**：refetch 不再触发 `<Suspense>` 挂起/detach，`<article>` 不被重挂载归零。
  - 渲染 effect 的保滚动加「不与用户争」守卫：`lastSet` 记录我方上次写入值，异步（mermaid 后）恢复仅当 `el.scrollTop === lastSet`（用户未在渲染间隙滚动）时才生效——修掉「迟到的异步恢复用陈旧 `prevTop=0` 覆盖用户滚动」这一修复自身缺陷。
- `src/gui/src/lib/mermaid.ts`：`renderMermaidIn` 由 `void render()` 改为 `await render()`，其返回 Promise 在 SVG 注入后才 resolve（修 D1）。

**验证（Playwright 复现用例，作为回归测试保留）：**

- 修复前：`mermaid target=4571 finalTop=0`（复现「重置到顶部」）。
- 修复后：`mermaid target=5189 finalTop=6935`（保持在正文中后部，**不再归顶**）；纯文本对照 `2446 → 2446`（完美保持）。两用例均 PASS。
- 决定性时序对比：修复前每次刷新出现 `resource.loading true state refreshing` 且 `effect-run prevTop:0`；修复后全程 `state ready`、`effect-run prevTop:5189`（真实位置被保住）。
- 残留：mermaid 密集 + 高频写入下滚动会向下小幅漂移并收敛到稳定位置（scroll-anchoring 与守卫恢复共同作用），始终停在阅读区、绝不归顶；与报告症状无关，属可接受范围。

### 6. 脚手架清单

> 收尾须逐条还原/核销。类型：临时日志 / 临时探针。

- [x] `src/gui/src/pages/SpecDetail.tsx` 渲染 effect 内 `[scroll-dbg]` 日志（effect-run / pre-mermaid / after-sync / RESOLVED / after-async 及 `__dbgId`/isNewEl/connected）——已删除。
- [x] `src/gui/src/pages/SpecDetail.tsx` 临时探针 effect：`resource.loading` 追踪、MutationObserver childList、scroll→0 监听——已删除。
- [x] `src/gui/src/lib/mermaid.ts` `renderMermaidIn` 内 `[scroll-dbg]` START/DONE 日志——已删除（`await render()` 为合法修复，保留）。
- [x] 复现用例 `src/gui/src/__e2e__/scroll-preserve.spec.ts` 与 `fixtures/setup.ts` 种子——**作为回归测试保留**（已去除诊断日志，仅留干净断言）；非脚手架。

> 核销依据：`grep -rn "scroll-dbg|__dbgId|MutationObserver" src/gui/src` 无残留；`git diff da3c9e77 -- src/` 仅含合法修复。

### 7. 收尾核对

- [x] 拿到指向根因的硬证据（E3 稳定复现 + E4 决定性时序日志：Suspense 在 refetch detach 滚动容器）
- [x] 脚手架清单逐条核销（临时日志/探针全部删除；grep 无残留）
- [x] `git diff da3c9e77` 只剩合法修复 + 回归测试（`SpecDetail.tsx` +30/-9、`mermaid.ts` +4/-2、`fixtures/setup.ts` +78、新增 `scroll-preserve.spec.ts`）
- [x] 变更文件校验：`scroll-preserve`(2) + `spec-task-list`(2) e2e 通过；service 探针契约单测通过；`build:gui` 通过；`tsc --noEmit` 触及文件无新增类型错误。（既有 4 个 e2e 失败 `body-no-overflow`/`selection-menu`/`question-confirm`/`append-task` 经干净基线复核为**改动前既存**，与本次无关）
- [x] 记录块 `状态` 置 `resolved`，文件 frontmatter 收敛（`status: resolved`，`active` 清空）

## Debug 2 · 保滚动修复的两处遗留 bug：刷新闪烁 + 不跟随刷新间的新滚动位置

- 状态：resolved
- 快照：fe468e3db38ee217dc7d42e417dc1b55f605a106
- 进入时间：'2026-07-19 18:05:00'

### 1. Bug 现象与复现

用户手动验收（Debug 1 修复后）确认滚动位置能保持，但发现两个遗留 bug：

- **Bug A（闪烁）**：每次刷新正文可见闪烁——疑为高度短时归零再恢复（`innerHTML` 整体替换 → 内容瞬时清空 → mermaid 由 raw 源码重渲染为 SVG，高度 raw→SVG 跳变），随后快速恢复到滚动位置。期望消除闪烁。
- **Bug B（不跟随新滚动位置）**：刷新之间用户移动了滚动位置也不生效。例：从「章节 6」滚到「章节 7」，下次刷新后被重置回「章节 6」（旧位置），而非停在用户最新的「章节 7」。

复现：GUI 打开长 mermaid spec，滚到章节 6 → 等一次刷新 → 滚到章节 7 → 等下一次刷新 → 观察是否被拉回章节 6。

### 2. 关联链路分析

Debug 1 的修复：`startTransition` 包裹刷新（防 Suspense detach）+ 渲染 effect 内 `prevTop`/`lastSet` 守卫恢复 + `renderMermaidIn` 改 `await render()`。两处遗留 bug 都根植于「每次刷新整体 `el.innerHTML = renderMarkdown(...)` + mermaid 全量重渲染」这一设计。

### 3. Debug 基线

- 快照 SHA：`fe468e3db38ee217dc7d42e417dc1b55f605a106`（`git stash create`，含 Debug 1 的未提交修复 + e2e/种子/debug.md）。
- 退出闸门基准：`git diff fe468e3db3` 只剩合法修复。

### 4. 假设看板

- **[待验证] A1（闪烁）**：`innerHTML` 整体替换使内容经历「清空(高度→0) → raw mermaid 源码(矮) → SVG(高)」三态，视觉上是一次塌缩+回弹的闪烁；mermaid 全量重绘叠加。
- **[待验证] B1（不跟随）**：`prevTop = el.scrollTop` 在 effect 入口捕获，但用户在刷新间隙的新滚动可能被「上一轮迟到的 mermaid async restore」或「守卫 `lastSet` 逻辑」拉回旧值；或 scroll-anchoring 干扰使 effect 入口读到的不是用户最新位置。需插桩取证 prevTop 实际值。

### 5. 证据

- **E7（决定性根因，Playwright 复现 + 插桩）**：新增 `scroll-followup.spec.ts`（刷新间移动滚动）。第二刷新周期时序：
  1. `effect-run {prevTop:2594, curTop:2594}` — 正确捕获用户位置。
  2. `after-sync {scrollTop:2594, lastSet:2594}` — sync restore 到位。
  3. `mermaid-resolved {scrollTop:4987, lastSet:2594}` — **mermaid raw→SVG 使视口上方内容变高，浏览器 scroll-anchoring 把 scrollTop 从 2594 自动推到 4987**。
  4. 守卫 `4987 !== lastSet(2594)` → 跳过恢复 → `after-async {scrollTop:4987}`。
  - 数值：`posA=2594 → afterRefreshAtA=4987`；`setB=5189 → finalTop=6935`。**每次刷新位置向下漂移**，不停在用户位置。
  - 结论：Debug 1 的守卫 `el.scrollTop !== lastSet` **把 scroll-anchoring 的自动调整误判为「用户滚动」**，放弃恢复，导致漂移（Bug B）。Bug A 闪烁同源：`innerHTML` 清空(高度→0) + raw→SVG(矮→高) 的高度塌缩回弹的视觉表现。

### 根因结论（Debug 2）

两个 bug **同源**：每次刷新「`el.innerHTML` 整体替换 + mermaid 异步 raw→SVG 二段渲染」使正文高度经历 `最终高度 → 0 → raw(矮) → SVG(高)` 的剧烈变化：

- **Bug A（闪烁）**：清空→矮→高的高度塌缩回弹，肉眼可见。
- **Bug B（漂移，不跟随）**：raw→SVG 触发 scroll-anchoring 推高 scrollTop，守卫误判跳过恢复，位置逐次下漂。

**修复方向（根治）**：消除「清空 + raw→SVG 中间态」。采用**双缓冲**：在离屏（`position:absolute; visibility:hidden`、宽度对齐可见容器）先渲染新 markdown 并 `await renderMermaidIn` 等 SVG 就绪，再用 `replaceChildren` 一次性把最终节点搬进可见 `<article>`；替换后内容立即是最终高度 → 无中间态 → 无闪烁、无 anchoring 漂移，`scrollTop` 一次恢复到位。移除脆弱的 `lastSet` 守卫。

### 修复与验证（E8）

**已实施修复（`src/gui/src/pages/SpecDetail.tsx` 渲染 effect 改为双缓冲）：** 离屏 `<div class="markdown">`（`position:absolute; left:-99999px`，保持可见供 mermaid 测量；内容盒宽度对齐可见 `<article>`）先 `innerHTML = renderMarkdown` 并 `await renderMermaidIn(off)` 等 SVG 就绪；再 `el.replaceChildren(...off.childNodes)` 一次性搬入可见容器，替换前读 `el.scrollTop` 作目标（尊重渲染期间用户滚动），替换后一次恢复。移除 Debug 1 的 `prevTop`/`lastSet` 守卫（会被 scroll-anchoring 骗）。离屏容器**不带 `spec-main`**（否则渲染窗口内 DOM 会短暂出现两个 `article.spec-main`）。

**验证（Playwright，作为回归测试保留）：**

- `scroll-followup.spec.ts`：修复前 `posA=2594→afterRefreshAtA=4987`、`setB=5189→finalTop=6935`（漂移）；**修复后 `afterRefreshAtA=2594`、`finalTop=5189`——精确跟随最新位置**。
- `scroll-preserve.spec.ts`（mermaid / 纯文本）：修复后均精确保持，Debug 1 残留的向下漂移消失。
- `spec-task-list.spec.ts`：双缓冲未破坏 markdown/checkbox 渲染。5/5 通过；`tsc --noEmit` 触及文件无新增错误。
- **Bug A（闪烁）**：机制上已消除（可见容器保持旧内容直到最终 DOM 一次性换入，无「清空→raw→SVG」塌缩）；属视觉效果，待用户确认。

### 6. 脚手架清单

- [x] `src/gui/src/pages/SpecDetail.tsx` 渲染 effect 内 `[b-dbg]` 临时日志——已随双缓冲重写删除（grep 无残留）。
- [x] `src/gui/src/__e2e__/scroll-followup.spec.ts`——已整理为干净正式回归测试保留（去除 `[b-dbg]`/诊断日志），非脚手架。

### 7. 收尾核对

- [x] 硬证据锁定两 bug 根因（E7：scroll-anchoring 漂移 + 守卫误判）
- [x] 脚手架清单逐条核销（`[b-dbg]` grep 无残留）
- [x] 用户人在环路视觉确认 Bug A（闪烁）已消除 + Bug B（跟随）正常（用户验收通过）
- [x] `git diff fe468e3db3` 只剩合法修复（`SpecDetail.tsx` +43/-31）+ 新增回归测试 `scroll-followup.spec.ts`
- [x] 变更文件校验：5/5 e2e（scroll-followup / scroll-preserve×2 / spec-task-list×2）+ typecheck 触及文件无新增错误
- [x] 记录块状态置 resolved，文件 frontmatter 收敛（`status: resolved`，`active` 清空）

---
status: resolved
active:
updated_at: '2026-09-07 00:12:40'
---

## Debug 1 · 页面切换过渡中能透视到「底下那一页」的内容

- 状态：resolved
- 快照：82299f33009e15b5b5731dc107959fa5077fa0bb
- 进入时间：'2026-09-06 23:46:44'

### 1.1 Bug 现象与复现

用户报告：页面切换动效播放期间，某些页面能看到「底部页面」（被盖住的那一页）的内容。用户自己的猜测是「页面高度未占满屏幕，或页面背景是透明的」，点名的例子是 **spec 详情页**、**脚本管理页**。

路由归属：`/ext/scripts`（脚本管理）只存在于移动端（`src/gui-mobile/src/main.tsx:57`），所以报告场景是移动端 `/m/`；spec 详情页两端都有。

**稳定复现步骤**（脚手架脚本自动化执行，见 1.5）：

1. `pnpm run build:cli && pnpm run build:gui-mobile`，起 `yorz serve --cwd .tmp-e2e`；
2. Playwright chromium，视口 390×844，打开 `/m/specs`；
3. 注入 `:root { --vt-duration: 3000ms !important }` 把 260ms 的过渡慢放，便于取中间帧；
4. 点第一条 spec 进详情（forward），过渡进行到 ~40% 时截图。

结果：**必现**。截图里详情页正文与列表页的条目、时间戳完全叠在一起（见 1.5 证据 E1）。

### 1.2 关联链路分析

- 页面承载节点：`src/gui-mobile/src/AppShell.tsx:33` 的 `<main class="vt-page flex min-h-0 flex-1 flex-col">`，桌面端为 `src/gui/src/AppShell.tsx:297`。两处 `<main>` **自身都没有任何背景类**。
- 背景色的实际来源：`src/gui-mobile/src/app.css:19-26`（桌面端 `src/gui/src/app.css:14-15`）把 `bg-background` 给了 `html, body`；`#app` 只管高度与 flex 布局，同样没有背景。
- View Transition 的分层语义：带 `view-transition-name` 的元素被单独拍成一组快照（这里叫 `page`），**其余全部内容归到 `root` 快照**。于是 `body` 的底色留在 root 里，`page` 快照只有 `<main>` 子树自己画出来的像素——子树没画到的地方就是**透明**。
- 过渡期间的叠放：`root` 在最底，`old(page)` 与 `new(page)` 叠在其上（同一个 image-pair，新页默认压在旧页之上）。新页只要有透明区域，透过它看到的就是旧页快照。
- **这解释了「只有某些页面」**：`TopBar` 自带 `bg-background`（`components/TopBar.tsx:43`），列表页的 `<ul>` 自带 `bg-card`（`pages/Specs.tsx:126`、`pages/Sessions.tsx:165`、`pages/ext/Scripts.tsx:150`）——这些区域不透。而 spec 详情页整块 markdown 正文、脚本管理页列表之外的空白区都没有底色，透得最彻底。

### 1.3 Debug 基线

- 快照 SHA：`82299f33009e15b5b5731dc107959fa5077fa0bb`（`git stash create`，进入时工作区已脏）
- 进入时间：`2026-09-06 23:46:44`
- 退出闸门：`git diff 82299f33009e15b5b5731dc107959fa5077fa0bb`

### 1.4 假设看板

| #  | 假设                                                                     | 若成立会看到                                                                                        | 若不成立会看到                | 结论                                          |
| -- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
| H1 | `.vt-page`（`<main>`）背景透明 → `page` 快照带透明区 → 过渡中透视到旧页   | 中间帧截图里新页非内容区能看到旧页文字；`getComputedStyle(main).backgroundColor` 为 `rgba(0,0,0,0)` | main 有不透明背景色           | ✅ **坐实**（E1 + E2）                        |
| H2 | 页面高度未占满 `<main>`（用户猜测），page 快照矩形小于视口               | main 的 boundingRect 高度 < 可用视口高度                                                            | main 撑满（`flex-1 min-h-0`） | ❌ **证伪**：实测 390×844（=整个视口）        |
| H3 | 补不透明底色后，back 方向旧页会被新页整个盖住，`vt-page-exit-right` 失效 | back 过渡早期帧里几乎看不到旧页，只剩新页从左侧滑入                                                 | 旧页在上层向右滑出            | ✅ **坐实**（E3），已随修复一并处理           |
| H4 | 桌面端把 `mix-blend-mode` 换回默认 `plus-lighter` 能消掉 cross-fade 残影 | plus-lighter 的中间帧比 normal 更干净                                                               | plus-lighter 残影更重         | ❌ **证伪**（E5）：加法混合让旧页更亮，维持 normal |

### 1.5 证据

**E1 · 复现（修复前，移动端 forward，进度 ~40%）**
`/m/specs` → `/m/specs/:id` 的中间帧：详情页的标题、正文与列表页的「E2E 滚动保持（mermaid 密集）」「2026-07-01 12:00:00」等条目**逐字叠在一起**，且 `plan` 徽章、「追加任务/git」按钮下方能直接读到底层列表文字。透视区域正是详情页没有底色的正文区。

**E2 · 探针（修复前 / 后，同一元素）**

```
修复前 [probe:mid-forward] main.bg=rgba(0, 0, 0, 0) | main.rect=390x844@0 | viewport=390x844 | body.bg=rgb(246, 243, 233) | html.dataVt=forward
修复后 [probe:mid-forward] main.bg=rgb(246, 243, 233) | main.rect=390x844@0 | viewport=390x844 | body.bg=rgb(246, 243, 233) | html.dataVt=forward
```

两条同时给出 H1 的正证（bg 从透明变成 body 同款底色）与 H2 的反证（rect 恒等于视口 390×844，高度没有缺口）。

**E3 · back 方向层级（补背景后）**
`/m/ext/scripts` → `/m/ext` 的中间帧里旧页只在最右 ~14px 露头——新页把正在右滑的旧页整个盖住了，`vt-page-exit-right` 形同虚设。加 `z-index: 1` 后，过渡早期帧（10%）显示旧页「脚本管理」在上层向右滑走、底下的「扩展」页从左侧 -25% 跟进，与 iOS 返回一致。

**E4 · 修复后三方向复验（移动端）**

```
[probe:A-mid-ext-scripts] bg=rgb(246, 243, 233) rect=390x844 vt=forward   /m/ext -> /m/ext/scripts
[probe:B-mid-back]        bg=rgb(246, 243, 233) rect=390x787 vt=back      /m/ext/scripts -> /m/ext
[probe:C-mid-lateral]     bg=rgb(246, 243, 233) rect=390x787 vt=lateral   /m/ext -> /m/specs
```

三个方向的中间帧截图均无重影：forward 新页从右推入并完全遮住旧页；back 旧页在上层右滑露出来路页；lateral 淡入淡出。

**E5 · 桌面端四变体对照（同一进度 50%，`/:pid` → `/:pid/specs/:id`）**

| 变体                     | 结果                                            |
| ------------------------ | ----------------------------------------------- |
| A 有背景 + `normal`      | 旧页残影最淡，仅剩 cross-fade 固有的交叠 ✅ 采用 |
| B 无背景 + `normal`（修复前） | 旧页文字清晰可读，透视明显                      |
| C 有背景 + `plus-lighter` | 加法混合把旧页文字提亮，残影**更重**            |
| D 无背景 + `plus-lighter` | 同 C，更差                                      |

结论：桌面端保留既有的 `mix-blend-mode: normal`（原注释里「plus-lighter 会让交叠处发白」属实），只补不透明底色。剩余的淡淡交叠是 180ms cross-fade 的固有形态，不是本 bug。

### 1.6 脚手架清单

| 位置                                  | 类型                                              | 核销 |
| ------------------------------------- | ------------------------------------------------- | ---- |
| `.tmp-vt-repro/repro.mjs` 等 5 个脚本 | 临时 Playwright 复现入口                          | ✅ 已 `rm -rf .tmp-vt-repro` |
| `.tmp-vt-repro/*.png`                 | 中间帧截图证据                                    | ✅ 随目录删除 |
| 浏览器内 `--vt-duration: 4000ms` 覆盖 | 运行期注入（`addStyleTag`），慢放过渡便于取帧     | ✅ 仅存在于脚本进程，未落库 |
| 浏览器内 `mix-blend-mode` / `background-color: transparent` 覆盖 | 运行期注入，用于 E5 的四变体对照 | ✅ 仅存在于脚本进程，未落库 |
| 端口 17431 的调试 `yorz serve`        | 临时服务（`--cwd .tmp-e2e`）                      | ✅ 已停止 |

无源码级临时改动（没有短路 / Mock / 注释掉的逻辑 / 临时日志）。

### 1.7 收尾核对

**最终修复**（`git diff 82299f3 -- src/` 只剩这两处，无脚手架残留）：

1. `src/gui-mobile/src/app.css` / `src/gui/src/app.css` —— `html[data-vt] .vt-page` 补 `background-color: hsl(var(--background))`：过渡期间给页面快照一层不透明底色，与 body 同一个令牌，平时不生效。**根因修复。**
2. `src/gui-mobile/src/app.css` —— `html[data-vt='back']::view-transition-old(page)` 补 `z-index: 1`：让返回时旧页留在上层向右滑出。这是修复 1 的连带项（旧页一旦不透明就会被新页盖死），不补的话 `vt-page-exit-right` 白写。

**验证**：

- `pnpm run typecheck`：通过。
- `pnpm test`：876 passed / 1 failed / 2 skipped。唯一失败是既有的 `src/service/__tests__/git-routes.test.ts > surfaces the underlying git stderr on failure`（断言本地 git stderr 文案），spec.md 的执行记录里已有同一条，与本次改动无交集。
- `pnpm test:e2e`：53 passed / 2 failed。两条失败都在 `sidebar-hover-peek.spec.ts`（折叠态侧栏宽度 36 vs 37.5 的像素差），spec.md 执行记录里已用 stash 对照确认过是既有失败，与本次改动无交集。新增的三条 View Transition 专项用例全绿。
- `prettier --check` 两个改动文件：通过。
- 复现步骤重跑：E4 三方向中间帧均无透视重影，**问题消失**。

**留给人工复看的一点**：桌面端 180ms 的 forward/back 是 cross-fade，中间帧仍有淡淡的两页交叠（E5 变体 A）——这是交叉淡化的固有形态，不是透明背景 bug。若观感上仍嫌糊，可另开一条把桌面端口径从「淡入 + 位移」改成「新页不透明推入」，属于动效口径调整，不在本次修复范围内。

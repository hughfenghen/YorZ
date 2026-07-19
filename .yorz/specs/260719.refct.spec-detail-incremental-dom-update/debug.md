---
status: debugging
active: 1
updated_at: '2026-07-19 21:58:48'
---

## Debug 1 · 从 spec 列表进入详情页时 mermaid 渲染 namespaceURI 报错

- 状态：debugging
- 快照：2901b7b5b48069403a42bdee37541891027bd4b5（降级基线；`git stash create` 因沙箱无法写 `.git/index` 返回 `error: could not write index`，未生成快照对象）
- 进入时间：'2026-07-19 21:50:08'

### 1. Bug 现象与复现

用户反馈：

- 从 spec 列表页进入详情页时报错：`[mermaid] render error: Cannot read properties of null (reading 'namespaceURI')`，mermaid 图表渲染不出。
- 在详情页刷新页面后，图表渲染正常，没有错误。

待本地构造稳定复现：

- 路径 A：列表页客户端路由进入详情页。
- 路径 B：详情页直接刷新或直接打开。

### 2. 关联链路分析

- `src/gui/src/pages/SpecDetail.tsx` 使用 Solid resource 取 spec，并在 article ref 存在后用 `renderMarkdown` + `morphdom(..., { childrenOnly: true })` 注入正文。
- `morphdom` 的 `toNode` 当前是字符串 `<article>${html}</article>`。若目标 `el` 是真实 `<article>`，但 `childrenOnly: true` 时仍让 morphdom 从 HTML 字符串构造对照节点，需要验证它在客户端路由首次进入时是否出现 `toNode`/parent 文档上下文不一致。
- `src/gui/src/lib/mermaid.ts` 对 `.mermaid:not([data-processed])` 调用 `mermaid.run({ nodes })`。报错位于 mermaid 内部读取 `namespaceURI`，常见诱因是传入节点已脱离 DOM、ownerDocument/namespace 不符合预期，或并发 cleanup 与 rerender 交错。
- 刷新详情页正常说明 markdown 内容与 mermaid 语法大概率无关，差异更可能来自客户端导航时 article 挂载、morphdom 字符串解析或异步 render 时序。

### 3. Debug 基线

- 基线：`HEAD` = `2901b7b5b48069403a42bdee37541891027bd4b5`。
- 进入前既有脏改：`.yorz/config.json`。
- 快照异常：`git stash create` 失败，原因是当前沙箱只读 `.git/index`，无法创建 stash 快照对象。退出闸门改用 `git diff HEAD`，并明确排除进入前既有 `.yorz/config.json`。

### 4. 假设看板

| 编号 | 假设 | 若成立会看到 | 若不成立会看到 | 状态 |
| --- | --- | --- | --- | --- |
| H1 | `morphdom` 以 HTML 字符串作为 `toNode`，在客户端路由首次进入时生成的对照节点上下文导致 mermaid 内部拿到异常 SVG/DOM 节点 | 列表页进入时报错；改为显式 `document.createElement('article')` + `innerHTML` 后错误消失 | 显式 DOM 对照节点后仍报同错 | 未采用，证据不足 |
| H2 | `renderMermaidIn` 在旧 effect cleanup 与新 render Promise 之间交错，或同容器连续批次并发调用 mermaid 单例，导致 mermaid 渲染时节点已被另一批次改写/移除 | 构造同容器并发 `renderMermaidIn` 时，旧批次会与新批次竞争；加容器批次 token 后旧批次被跳过且只剩最新批次调用 `mermaid.run` | 加批次 token 后同容器仍有多次并发 `mermaid.run` | 单元证据支持 |
| H3 | 列表页进入时 article effect 早于真实布局稳定，mermaid 对隐藏/未布局容器渲染失败 | 报错时 article 已存在但尺寸为 0 或不可见；等待一帧后消失 | 尺寸正常仍报错 | 已防御，浏览器待验 |

### 5. 证据

- 已读代码：`SpecDetail.tsx` 渲染 effect 当前直接 `morphdom(el, `<article>${html}</article>`, { childrenOnly: true, ... })`，随后异步 `renderMermaidIn(el)`。
- 已读代码：`mermaid.ts` 初始只渲染 `.mermaid:not([data-processed])`，渲染前将 `data-mermaid-source` 写入 `textContent` 并移除 `data-processed`。
- 浏览器级 E2E 复现被当前沙箱阻断：`pnpm test:e2e mermaid-list-navigation` 的 Playwright webServer 启动失败，`listen EPERM: operation not permitted 0.0.0.0:17430`；Node REPL 直接监听 `127.0.0.1:0` 也返回 `EPERM`，说明本环境禁止本地端口监听。
- 已新增回归用例 `src/gui/src/__e2e__/mermaid-list-navigation.spec.ts`：路径为先打开 `/${pid}` 列表页，再点击 `SCROLL_SPEC_ID` 进入详情页，捕获 `[mermaid] render error` 并断言首个 SVG 可见。该用例因端口限制暂无法在本环境跑到浏览器阶段。
- jsdom + mermaid 探针受 mermaid 浏览器依赖限制，先后卡在 `CSSStyleSheet is not defined` 与 `Cannot read properties of undefined (reading 'length')`，未能形成有效 connected/disconnected 分化证据。
- 修复实现：`src/gui/src/lib/mermaid.ts` 增加同容器 render epoch，旧批次在 `loadMermaid()` 后或等待一帧后若已过期则退出；进入 `mermaid.run` 前只保留 `node.isConnected && container.contains(node)` 的 live 节点；全局串行化 `mermaid.run`，避免 mermaid 单例重入。
- 单元证据：`src/gui/src/lib/__tests__/mermaid.test.ts` 构造同一 article 连续两次 `renderMermaidIn(article)`，断言最终只调用一次 `mermaid.run`；另构造 detached article，断言脱离 DOM 的 mermaid 节点不会进入 `mermaid.run`。
- 类型缺口修补：`src/gui/src/__e2e__/fixtures/seed.d.mts` 为现有 `seed.mjs` 增加声明，使 `pnpm typecheck` 可完整通过。
- 浏览器绕过验证尝试：用 Playwright route fulfill `dist/gui` 与 mock API，避免 webServer 监听；但 Chromium 启动失败，`bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`。因此本环境仍无法完成真实浏览器验证。
- 已通过验证：
  - `pnpm test src/gui/src/lib/__tests__/mermaid.test.ts src/gui/src/lib/__tests__/markdown.test.ts`
  - `pnpm typecheck`
  - `pnpm build:gui`
  - `pnpm test`

### 6. 脚手架清单

- 无临时脚手架。
- 保留的正式回归资产：
  - `src/gui/src/__e2e__/mermaid-list-navigation.spec.ts`：覆盖列表页客户端导航进入详情页的 mermaid 渲染。
  - `src/gui/src/lib/__tests__/mermaid.test.ts`：覆盖同容器并发批次与 detached 节点过滤。

### 7. 收尾核对

- [ ] 稳定复现路径 A 并确认路径 B 正常（本环境浏览器/监听权限阻断，待用户侧验证）。
- [x] 用证据确认根因方向（同容器连续渲染导致旧批次被新批次 supersede；单元测试覆盖）。
- [x] 移除所有临时脚手架。
- [x] `git diff` 只剩合法修复（另有进入前 `.yorz/config.json`）。
- [x] 跑关联单测/typecheck/build；E2E 因环境权限阻断。

---
status: resolved
active:
updated_at: '2026-10-04 16:24:21'
---

# Debug 活文档 · 移动端 PWA 配对鉴权

## Debug 1 · 移动端刷新/重进被踢回 /m/pair（设备令牌被误清）+ 移除配对页「手动输入」按钮

- 状态：resolved
- 快照：1dcf6f3e2f3543fe6ed1a63914be41437428ad58
- 进入时间：'2026-10-04 16:20:11'

### 1.1 Bug 现象与复现

两个追加问题：

1. 移动端每次刷新或关闭页面重进都会跳转 `http://localhost:7424/m/pair`，期望已配对后持久化授权（设备令牌）。
2. 配对页「手动输入」按钮无意义，应移除。

**复现环境**：`pnpm dev:cli`（`node dist/cli/index.js serve --port 7424`）提供构建后的移动端静态资源；手机/浏览器访问 `/m`。

**自动化复现**（Playwright 驱动构建产物，端口 7931，临时 YORZ_HOME）：

- 服务端 curl 验证：主令牌签发配对码 → claim 换设备令牌 → 带设备令牌连续两次 `GET /api/global-config` 均 200，`auth.json` 持久化。**服务端无问题**。
- 浏览器端复现：配对成功后 `localStorage['yorz.m.token']` 已写入、url=`/m`；**刷新后**首个请求 `GET /api/projects` 请求头 `x-yorz-pair-token=NONE` → 401，随即 `localStorage` 被清为 null，url 跳回 `/m/pair`。稳定复现。

### 1.2 关联链路分析

- 令牌注入链：`gui-shared/api/index.ts:authedFetch` → `withAuthHeaders`/`appendAuthToken`（`gui-shared/api/auth.ts`）读取 `tokenProvider()`；401 时 `notifyUnauthorized()` → `unauthorizedHandler()`。
- 移动端在 `main.tsx` 函数体调用 `initPairingAuth()`（`lib/pairing.ts`）注册 `tokenProvider = () => deviceToken()` 与 `onUnauthorized = () => setDeviceToken(null)`。
- `deviceToken` 信号在 `pairing.ts` 模块求值时由 `readStored()`（localStorage）初始化。
- **关键**：`lib/active-project.ts:68` 在**模块顶层**创建 `createResource(async () => api.listProjects())`，SolidJS 对无 source 的 resource 会**在创建时立即触发 fetcher**。该模块由页面导入，在 `main.tsx` 的 import 阶段即被求值。

### 1.3 Debug 基线

快照 SHA：`1dcf6f3e2f3543fe6ed1a63914be41437428ad58`；进入时间 `2026-10-04 16:20:11`。`git diff <SHA>` 为退出闸门基准。

### 1.4 假设看板

- **H1（成立·已坐实根因）**：ES import 先于函数体执行。`main.tsx` 的 import 阶段 `active-project.ts` 顶层 `createResource` 立即发出 `GET /api/projects`，此时 `initPairingAuth()`（在函数体）尚未运行 → `tokenProvider` 仍是默认 `() => null` → 请求不带令牌。该请求的 **401 响应异步返回时**，`initPairingAuth()` 已配好 `onUnauthorized` → `setDeviceToken(null)` 清掉刚持久化的有效设备令牌 → 守卫跳 `/m/pair`。
  - 证伪条件：若请求带了令牌或 401 不清 token 则不成立。
  - 证据见 1.5：刷新首个 `/api/projects` 头 `NONE`+401，随后 localStorage 变 null。
- H2（已排除）：服务端设备令牌不持久化/校验失败。证据：curl 带设备令牌两次 200，auth.json 存在。排除。
- H3（已排除）：localStorage 未写入。证据：配对后 Playwright 读到 token 值，刷新开始时仍在，排除。

### 1.5 证据

```
配对后: url=/m  localStorage yorz.m.token=owm53ZKeOF...（已持久化）
=== RELOAD ===
REQ GET /api/projects tokenHdr=NONE
REQ GET /api/events/stream?clientId=... tokenHdr=NONE
RES 401 /api/projects
RES 401 /api/events/stream
REQ POST /api/events/subscribe tokenHdr=NONE
RES 401 /api/events/subscribe
after reload, url=/m/pair  token=null  ← 有效令牌被 401→onUnauthorized 清除
```

服务端对照（设备令牌本身有效）：带设备令牌 `GET /api/global-config` 连续两次均 200。

### 1.6 脚手架清单

- [x] 临时文件 `repro-pair.mjs`（项目根）：Playwright 复现脚本 —— 已删除。
- [x] 临时文件 `check-pair-ui.mjs`（项目根）：配对页 UI 校验 —— 已删除。
- [x] 临时启动的 service 进程（端口 7931，临时 YORZ_HOME，pid 63316）—— 已 kill。
- [x] 临时文件 `/tmp/repro-pair.mjs`、`/tmp/yorz-repro.log`、`/tmp/pw-install.log` —— 已清理。
- 说明：全程未在产品源码中留临时短路/Mock/日志；修复代码本身即最终形态。

### 1.7 收尾核对

- [x] 问题 1 修复验证：Playwright 驱动构建产物，配对后**刷新**，`GET /api/projects`/`/api/events/stream`/`/api/events/subscribe` 全部携带设备令牌并 200，`localStorage['yorz.m.token']` 保留，url 停在 `/m/`（不再跳 `/pair`）。
- [x] 问题 2 修复验证：`/m/pair` 按钮仅剩 `扫码`/`配对`（提交），无「手动输入」切换按钮；`#pairing-code` 手动输入框常驻。
- [x] `npx tsc -b` 通过；`pnpm build:gui-mobile` 通过；`vitest run src/gui-mobile src/gui-shared` 32 passed。
- [x] 退出闸门：`git diff 1dcf6f3e` 仅剩 `src/gui-mobile/src/lib/pairing.ts` 与 `src/gui-mobile/src/pages/Pair.tsx` 两处合法修复，脚手架全部核销。

### 1.8 修复方案

- 问题 1：在 `pairing.ts` **模块求值期**（import 副作用）即调用 `configureAuth` 注册 provider/onUnauthorized，保证早于 `active-project.ts` 顶层 eager resource 的首个请求。`pairing.ts` 在 `main.tsx` 中先于 AppShell/页面导入，时序成立。
- 问题 2：`Pair.tsx` 移除「扫码/手动输入」模式切换按钮；手动输入表单常驻，扫码作为可选的「开启摄像头」入口。

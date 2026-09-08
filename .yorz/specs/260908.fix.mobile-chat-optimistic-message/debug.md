---
status: resolved
active:
updated_at: '2026-09-08 19:30:00'
---

## Debug 1 · codex 草稿首发后先「加载中」再「还没有消息」，最后才显示正确内容

- 状态：resolved
- 快照：397c5db9ce72d16636405c04adbfa3272caa004e
- 进入时间：'2026-09-08 19:19:34'

### 1.1 Bug 现象与复现

复现路径（移动端 GUI）：

1. 进入 `/sessions/new` 空白草稿页；
2. 项目默认 Agent 为 **codex**；
3. 输入一句话点发送。

观察到的三段状态（按时间顺序）：

1. 用户消息**未直接上屏**，整屏是「加载中...」；
2. 跳到「这个会话还没有消息」（`chat.empty` 空状态）；
3. 再跳到正确状态：第一条用户消息 + 第二条 codex 输出。

对照组：**claude 正常**（首发即上屏，无中间态）。

### 1.2 关联链路分析

claude / codex 的唯一分叉点是 `session-started` 事件里的 id 是否变化：

- `@src/service/agent-sdk/claude-adapter.ts:242` `yield { type:'session-started', sessionId: this.id }`
  —— id 与当前 sid 相同，前端 `ev.sessionId !== sid` 为 false，整个换 id 分支不执行；
- `@src/service/agent-sdk/codex-adapter.ts:236` `yield { type:'session-started', sessionId: ev.thread_id }`
  —— codex 在 `thread.started` 时才给出真实 thread id，与前端建号拿到的 `A` 不同，
  服务端 `session-manager.ts:419` 走 `reconcile(A → B)`，前端 `chat-transcript.ts:471`
  走换 id 分支。

所以问题必然落在 `chat-transcript.ts:471-482` 这段换 id 处理，以及它对
`planHistoryLoad` 输入一致性的影响。

### 1.3 Debug 基线

- 快照 SHA：`397c5db9ce72d16636405c04adbfa3272caa004e`（`git stash create`）
- 进入时间：`2026-09-08 19:19:34`
- 退出闸门：`git diff 397c5db9ce72d16636405c04adbfa3272caa004e`

### 1.4 假设看板

#### H1（**已坐实**）：换 id 期间 `displayedSid` 与 `o.sessionId()` 短暂不一致，被中间的 `onSessionsChanged` 同步触发的 effect 撞上，误判为「切换会话」→ `load{clear:true}` → 清屏 + 加载态

`session-started` 处理顺序为：

```
freshSids.add(B)
displayedSid = B          ← 屏上归属提前改成 B
onRunningChange(A,false)
onRunningChange(B,true)
onSessionsChanged()       ← 移动端 = refetchSessions()，同步置 sessions.loading=true
onSessionIdChange(B)      ← 这之后 o.sessionId() 才变成 B
```

这些 setter 都在 SSE 回调里、**不在 batch 内**，Solid 会逐个同步 flush effect。
于是 `onSessionsChanged()` 那一步就会让 history effect 在
`sid=A, displayedSid=B` 的**不一致输入**下重跑一次。

- 若成立会看到：该次 `planHistoryLoad` 返回 `{action:'load', clear:true}`，
  effect 执行 `resetParts()`（乐观气泡被清空）并 `setHistoryLoading(true)`。
- 若不成立会看到：该次重跑返回 `fresh`/`keep`/`hold`，`parts` 不被清空。

#### H2（**已坐实**）：三段状态的完整因果

- 第 1 段「加载中」= H1 的 `resetParts()` + `historyLoading=true`；
- 第 2 段「还没有消息」= H1 发出的 `getSessionMessages(pid, A)` 返回 `[]`
  （A 已被服务端 reconcile 走、盘上无 transcript），且 `historyGate` 未被后续
  `hold` 分支顶掉（`hold` 不调用 `begin()`），于是 `setHistoryLoading(false)`
  落在空 `parts` 上 → 渲染空状态；
- 第 3 段「正确」= 列表 refetch 回来后 `known(B)=true`，effect 走
  `load{clear:true}` 读 B 的 transcript，此时盘上已有内容 → 整份替换。

### 1.5 证据

#### 证据 0：单测里 solid 是「假的」——先修测量仪器

`solid-js` 的 `exports` 里 `node` 条件指向 `dist/server.js`，那份构建的
`createEffect` 就是 `function createEffect(fn, value) {}`（实测打印函数源码确认）。
vitest 的 `environment: 'node'` 因此让共享逻辑层的**全部 effect 不变量都测不到**。
在 `vite.config.ts` 的 `resolve.alias` 里把 `^solid-js$` 精确指向
`node_modules/solid-js/dist/solid.js` 后，响应式才真正跑起来——这是取证的前提。

#### 证据 1：最小复现用例（`chat-transcript-codex-swap.test.ts`）

按移动端 ChatDetail 的真实接线搭宿主（sid 覆盖信号领先路由 / 列表提供
`known` 与 `listPending` / `onSessionsChanged` 立刻置 `listPending=true` /
`onRunningChange` 按当前 active id 路由），mock 掉 `api` 与 `subscribeSession`，
然后手工投递 codex 的 `session-started(sid-A → sid-B)`。

**修复前**，逐步快照（`{loading, blocks}`）：

| 步骤                          | 快照                                | 对应用户所见         |
| ----------------------------- | ----------------------------------- | -------------------- |
| 首发后（sid-A）               | `{loading:false, ["user:你好"]}`     | ✅ 正常（= claude）   |
| `session-started(B)` 同步之后 | `{loading:true, []}`                | 「加载中...」        |
| A 的 transcript（`[]`）落地   | `{loading:false, []}`               | 「这个会话还没有消息」 |
| B 的列表 + transcript 落地    | `{loading:false, []}`（真实环境为盘上内容） | 正确内容（第 3 段）  |
| B 上流式 `嗨`                 | `["assistant:嗨"]`                  | 用户气泡已被永久抹掉 |

三段状态与用户描述的顺序**逐字吻合**。

**第二条用例**同时暴露了一个并发存在的记账丢失：换 id 后
`expect(tx.running()).toBe(true)` 失败——`onRunningChange(B, true)` 在
`sid()` 还是 A 时被宿主丢弃，Abort 按钮中途消失。

#### 证据 2：根因

`session-started` 分支要把**四份账**从旧 id 搬到新 id：

```
displayedSid（hook 内部） / o.onSessionIdChange（宿主 active id）
o.onRunningChange（运行态）  / o.onSessionsChanged（会话列表）
```

这段代码跑在 SSE 回调里、**不在任何 batch 内**，Solid 对 batch 外的每次写信号
都会**同步 flush 一遍 effect**。原顺序里 `o.onSessionsChanged?.()`（移动端 =
`refetchSessions()` → `listPending=true`）排在 `o.onSessionIdChange()` **之前**，
于是 history effect 在**半搬完的账**上跑了一次：

```
sid = A（还没换）        displayedSid = B（已经换了）
→ planHistoryLoad: sameSession = false
→ { action:'load', clear:true }
→ resetParts()            ← 乐观用户气泡被清空
→ setHistoryLoading(true) ← 整屏「加载中」
→ getSessionMessages(A)   ← A 已被服务端 reconcile 走，盘上无 transcript → []
```

紧随其后的 `onSessionIdChange(B)` 让 effect 再跑一次，此时 `known(B)=false` 且
`listPending=true` → `hold`。`hold` 分支**不调用 `historyGate.begin()`**，所以上一步
那个针对 A 的读取没有被顶掉；它带着 `[]` 落地，`samePartTail([],[])` 成立 → `keep`
→ `setHistoryLoading(false)`，屏上是空的 → 渲染「这个会话还没有消息」。

claude 不受影响的原因：`claude-adapter.ts:242` 的 `session-started` 携带的就是当前
sid，`ev.sessionId !== sid` 为 false，整个分支根本不执行。

#### 证据 3：修复后同一用例转绿

把整段搬账包进 `batch()`，并把 `o.onSessionIdChange` 提到运行态转交之前：

- `batch` 让「`displayedSid` 与 `o.sessionId()` 不一致」的窗口宽度归零——effect 只在
  四份账全部落定后跑一次，输入自洽（`sid=B, displayedSid=B, fresh(B)=true` → `fresh`），
  既不清屏也不进加载态；
- `onSessionIdChange` 前置：batch 内读信号取的是**新值**，所以
  `onRunningChange(B, true)` 不再被宿主丢掉。桌面端 `ChatPanel` 的
  `onRunningChange` 是按 sid 建 map、不看 active id，顺序调整对它无影响。

两条用例全部通过；且已确认修复前它们是失败的（先红后绿）。

### 1.6 脚手架清单

| 文件 / 位置                                       | 类型               | 状态                                     |
| ------------------------------------------------- | ------------------ | ---------------------------------------- |
| `src/gui-shared/lib/__solid-probe.test.ts`        | 临时探针（solid 构建判定） | ✅ 已删除                                 |
| 复现用例内的 `console.log('TRACE ...')` × 4        | 临时日志           | ✅ 已还原为断言                           |
| `/tmp/codex-swap.bak.ts`、`/tmp/solid-probe.test.ts` | 临时备份         | ✅ 已删除                                 |
| `vite.config.ts` 的 `^solid-js$` 别名              | 测试基建           | ⬜ **有意保留**（见证据 0，无它则该测试形同虚设） |

### 1.7 收尾核对

- 退出闸门：`git diff 397c5db9ce72d16636405c04adbfa3272caa004e` 只剩
  `src/gui-shared/lib/chat-transcript.ts`（修复）与 `vite.config.ts`（测试基建），
  外加新增文件 `src/gui/src/lib/__tests__/chat-transcript-codex-swap.test.ts`（回归用例）。
  `console.log` / `TRACE` 全量 grep 无残留。
- `npx vitest run`：**888 passed / 1 failed**。唯一失败为
  `src/service/__tests__/git.test.ts > ignores a stale selection entry`，
  已用 `git stash push -- vite.config.ts src/gui-shared/lib/chat-transcript.ts`
  回到基线单跑同一用例，**同样失败**，确认为预存在、与本次无关。
- `npx tsc -b`：通过（exit 0）。
- `npx vite build --config vite.gui-mobile.config.ts`：构建通过。
- `npx prettier --check` 三个改动文件：全部符合。

#### 修复文件

- `@src/gui-shared/lib/chat-transcript.ts`：`session-started` 换 id 分支整体
  `batch()` 包裹；`o.onSessionIdChange` 提到两次 `o.onRunningChange` 之前；
  旁注改写为「为什么必须原子」。
- `@src/gui/src/lib/__tests__/chat-transcript-codex-swap.test.ts`（新增）：
  codex 换 id 的两条回归用例。
- `@vite.config.ts`：`resolve.alias` 改数组形式（`@shared` 必须排在 `@` 前），
  新增 `^solid-js$` → 浏览器构建。

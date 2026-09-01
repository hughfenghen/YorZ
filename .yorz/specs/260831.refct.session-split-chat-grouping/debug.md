---
status: resolved
active:
updated_at: '2026-09-01 15:24:30'
---

## Debug 1 · 新建第二个 spec session 时 Chat 面板被清空、只显示新 session 内容

- 状态：resolved
- 快照：734c8fd5efe3ceb1ced5e58b76d90320416871ce
- 进入时间：'2026-09-01 10:55:44'

### 1.1 Bug 现象与复现

来源：spec 追加任务 `[fix] 2026-09-01 10:55:29`。

复现路径：

1. 新建 spec（`new-spec`）→ 服务端创建 session A（带 `specId`）。
2. plan 阶段在文档上提交批注 → `submitAnswers()` → `runAgent()` → 服务端 `createSessionForSpec()` 新建 session B。
3. **现象 1**：Chat 面板消息区被清空。
4. **现象 2**：随后只显示 session B 的内容，A 的历史与分割线始终不出现。
5. **现象 3**：切换到别的会话行再切回该 spec 行，才正确加载整组（A + divider + B）。

期望：切到 B 后消息区应展示该 spec 组的全部历史（A + divider + B）。

### 1.2 关联链路分析

```
SpecDetail.submitAnswers()
  → runAgent()                                    src/gui/src/pages/SpecDetail.tsx:270-282
  → api.runAgent() 返回新 sessionId B
  → requestChatSession(B)                          SpecDetail.tsx:277
ChatPanel
  → requestedChatSessionId effect                  ChatPanel.tsx:440-449
  → selectSession(B) : setActiveSid(B) + void refetchSessions()   ChatPanel.tsx:433-437
  → 「session selection → load history」effect      ChatPanel.tsx:548-596
       specId = activeSpecId() = findGroupBySession(visibleGroups(), activeSid())?.specId
       visibleGroups ← groupSessions(sessions())    ChatPanel.tsx:414
       sessions ← createResource(api.listSessions)  ChatPanel.tsx:334-337
```

关键点：`selectSession()` 里 `refetchSessions()` 是 **异步** 的，而 `setActiveSid()` 触发的历史 effect 是 **同步** 执行的。

### 1.3 Debug 基线

- 快照 SHA：`734c8fd5efe3ceb1ced5e58b76d90320416871ce`（`git stash create`，进入时工作区含 `spec.md` / `TODO.md` 的既有未提交改动）
- 进入时间：`2026-09-01 10:55:44`
- 退出闸门基准：`git diff 734c8fd5efe3ceb1ced5e58b76d90320416871ce`

### 1.4 假设看板

| # | 假设 | 成立会看到 | 不成立会看到 | 结论 |
| - | ---- | ---------- | ------------ | ---- |
| H1 | `selectSession(B)` 时 `sessions()` 列表尚未含 B，`findGroupBySession()` 返回 `undefined`，`activeSpecId()` 为 `undefined`，历史加载走单 session 分支 | 首次加载调用 `getSessionMessages(B)` 而非 `getSpecMessages(spec-1)` | 首次即调用 `getSpecMessages` | **成立**（见 E1） |
| H2 | 列表 refetch 落地、`activeSpecId()` 变为已知后，effect 重跑却被 `running && sameSession` 守卫（ChatPanel.tsx:573）提前 return，纠正性加载永不发生 | 重跑时命中 `SKIP(running+same)`，之后再无 `getSpecMessages` | 重跑时执行 `getSpecMessages(spec-1)` | **成立**（见 E1） |
| H3 | 切走再切回能恢复，是因为 `displayedSid` 被改写导致 `sameSession=false`，绕开了守卫 | 切到 C 再切回 B 后出现 `getSpecMessages(spec-1)` | 切回后仍 `SKIP` | **成立**（见 E2） |
| H4 | 服务端 `getSpecMessages` / 聚合端点返回有误 | 服务端用例失败 | 服务端用例全绿 | **已排除**：现象与服务端无关——同一 session 切走再切回即可正确加载整组（E2），说明服务端数据完好，问题纯在 GUI 的加载时序 |
| H5 | `groupSessions()` 分组逻辑漏掉了新 session | 列表落地后 `activeSpecId()` 仍为 undefined | 列表落地后 `activeSpecId()` 正确 | **已排除**：E1 中列表落地后 effect 确实以已知 specId 重跑（否则不会命中 `SKIP` 分支——该分支要求 `specId` 为真才会把 `running` 取真） |

### 1.5 证据

**E1 — 复现（脚手架 `tmp-repro-chatpanel-history.test.ts`，复刻 ChatPanel.tsx:404-596 的响应式图）**

按「列表=[A] 停在 A → setActiveSid(B) → SSE 标记 B running → refetch 落地列表=[A,B]」回放，实测调用序列：

```
CURRENT=["resetParts(clear:sid-B)","getSessionMessages(sid-B)","SKIP(running+same:sid-B)"]
```

三条与三个现象逐一对应：

1. `resetParts(clear:sid-B)` → **现象 1：消息区被清空**
2. `getSessionMessages(sid-B)` → **现象 2：只加载 B 单个 session**（此刻 `activeSpecId()` 为 `undefined`）
3. `SKIP(running+same:sid-B)` → **根因**：列表落地、`specId` 已知后的纠正性加载被 `running && sameSession` 守卫吞掉

**E2 — 恢复路径（现象 3）**

```
RECOVER=[...,"resetParts(clear:sid-C)","getSessionMessages(sid-C)","resetParts(clear:sid-B)","getSpecMessages(spec-1)"]
```

切到 C 再切回 B，`displayedSid` 被改写使 `sameSession=false`，绕开守卫后正确调用 `getSpecMessages(spec-1)`。证实服务端数据完好（H4 排除），问题纯在 GUI 时序。

**根因定论**

`ChatPanel.tsx` 的历史加载 effect 有一个**未被识别的第三态**：

- 已知是普通 chat（`activeGroup()` 存在且无 `specId`）
- 已知是 spec 组（`activeGroup()` 存在且有 `specId`）
- **列表还不认识这个 session（`activeGroup()` 为 `undefined`）** ← 被错误地当成第一种处理

`selectSession()` 中 `setActiveSid()` 同步、`refetchSessions()` 异步，所以「服务端刚新建、GUI 立刻切过去」的 session 必然先经历第三态。effect 在第三态里按普通 chat 加载了单 session 历史并写脏 `displayedSid`；等列表落地进入正确状态时，`running && sameSession` 守卫（本意是保护流式内容不被覆盖）恰好把唯一的纠正机会堵死。

这条路径对 **每一轮 run / append / git-ops 新建 session** 都成立，不限于批注场景。

**E3 — 候选修复验证（同脚手架）**

在守卫之前补一个第三态分支：列表已加载但不认识该 session → 按兵不动（不清空、不加载、不写 `displayedSid`），等 refetch 落地后自然进入正确分支。

```
FIXED=["DEFER(unknown:sid-B)","resetParts(clear:sid-B)","getSpecMessages(spec-1)"]
PLAIN=["resetParts(clear:sid-C)","getSessionMessages(sid-C)"]            # 普通 chat 切换不受影响
NOLIST=["resetParts(clear:sid-B)","getSessionMessages(sid-B)"]           # 列表未加载/拉取失败时退回原行为，不卡死
```

**E4 — 顺带发现的第二个缺陷：`latestBySpec()` 同毫秒并列取到最旧的一轮**

全量 `pnpm test` 出现一例失败（单独重跑却通过，典型时间敏感）：

```
FAIL src/service/__tests__/session-manager.test.ts
  latestSessionForSpec reuses the most recent session, creating one if absent
  -   "sessionId": "created-2"
  +   "sessionId": "created-1"
```

用冻结时钟做确定性复现（两条 `updatedAt` 完全相同）：

```
TIE_LATEST=round-1     # 期望 round-2
```

根因：`session-store.ts:latestBySpec()` 用严格 `>` 比较 `updatedAt`，而 `updatedAt` 来自 `Date.now()`（毫秒粒度）。本 spec 把「一个 spec 一个 session」改成「一轮一个 session」后，连续两轮 **常常落在同一毫秒**，并列时严格 `>` 会把第一个遍历到的（**最旧的**）留作 latest。

生产影响不止测试抖动：`latestSessionForSpec()` 被 `explain` / chat / `findSessionForSpec()`（→ `getSpecSession` 路由 → SpecDetail 绑定）使用，取错会让用户驱动的轮次落到**用户已经离开的那一轮**上。

### 1.6 脚手架清单

| # | 文件 / 位置 | 类型 | 状态 |
| - | ----------- | ---- | ---- |
| S1 | `src/gui/src/lib/__tests__/tmp-repro-chatpanel-history.test.ts` | 临时复现用例（全新文件） | ✅ 已删除 |
| S2 | `src/gui/src/lib/__tests__/tmp-solidprobe.test.ts` | 临时探针（确认 solid effect 在测试环境是否执行） | ✅ 已删除 |
| S3 | `tmp-vitest-debug.config.ts`（仓库根） | 临时 vitest 配置（`resolve.conditions` 指向浏览器构建，否则 solid-js 走 SSR 构建、`createEffect` 为 no-op） | ✅ 已删除 |
| S4 | `src/service/__tests__/tmp-repro-latest-tie.test.ts` | 临时复现用例（E4，冻结时钟） | ✅ 已删除 |

> 无临时短路 / Mock / 注释掉的业务代码——本次全部取证都靠**新增**的独立复现文件完成，未改动被调查的生产代码路径。

### 1.7 最终修复

**修复 1 — Chat 面板历史加载的第三态（对应 1.5 根因）**

- 新增 `src/gui/src/lib/chat-history-load.ts`：把加载决策抽成纯函数 `planHistoryLoad()`，返回 `idle | fresh | hold | keep | load` 五态。新增的 **`hold`** 就是此前缺失的第三态：列表已加载但还不认识该 session 时按兵不动——不清空、不加载、不写 `displayedSid`，把纠正机会留给 refetch 落地后的那次重跑。
- `ChatPanel.tsx`：新增 `activeSessionKnown` / `sessionsLoaded` 两个**布尔** memo（布尔化是为了让 effect 只在状态翻转时重跑，而不是跟着每次 SSE 边沿重建的 group 对象重跑），effect 改为消费 `planHistoryLoad()` 的结果。
- 兜底：`listLoaded` 为假（首次请求在飞行中或请求失败）时退回原行为，避免拉取失败把面板永久卡在旧内容上。

**修复 2 — `updatedAt` 的单调时钟（对应 E4）**

- `session-store.ts` 新增私有 `stamp()`：`Math.max(Date.now(), lastStamp + 1)`，五处时间戳写入点（`create` / `reconcileId` / `updateTitle` / `bindSpec` / `touch`）统一改走它。
- 选择「让顺序全序」而不是「在 `latestBySpec` 里加并列打破规则」：并列打破只能二选一，会与同文件另一条用例（`touch(first)` 后 latest 应为 first）的语义冲突；单调时钟从源头消灭并列，两条语义同时成立。`latestBySpec` 的严格 `>` 因此得以保留。

### 1.8 收尾核对

| 项 | 结果 |
| -- | ---- |
| 脚手架还原 | ✅ S1–S4 全部删除，无临时短路 / Mock / 注释残留 |
| 退出闸门 `git diff 734c8fd` | ✅ 仅剩 3 个文件的合法修复：`ChatPanel.tsx`、`session-store.ts`、`session-manager.test.ts`（+2 个新增文件 `chat-history-load.ts` 与其单测） |
| `pnpm typecheck` | ✅ 无错 |
| `pnpm test` | ✅ 73 文件 / 690 通过 + 2 skipped（修复前为 1 失败 / 688 通过） |
| `pnpm build:gui` | ✅ 构建成功 |
| 回归测试 | ✅ 新增 `chat-history-load.test.ts`（11 例，含两条 `hold` 回归断言）；`session-manager.test.ts` 新增同毫秒全序断言 |
| 复现步骤重跑 | ✅ 以真实响应式时序回放「列表=[A] → setActiveSid(B) → SSE running → refetch 落地」，调用序列由 `["resetParts(clear:B)","getSessionMessages(B)","SKIP"]` 变为 `["hold(B)","resetParts(clear:B)","getSpecMessages(spec-1)"]` |

**遗留（需用户确认，不属于本次 Debug 收尾范围）**：`spec.md` `## 7. 追加任务` 中该 `[fix]` 条目仍为 `[open]`。`[open]` 的关闭由 yorz-spec 状态机在收敛到 `done` 时处理（其 SKILL 明确「plan 阶段消费追加任务条目时不修改 `[open]` 状态标记」，且任何 `spec.md` 写入都要求过 `yorz lint`），故本次未代为改写。

## Debug 2 · 推动 spec 状态 / 追加任务新建 session 时仍会清空 session 组消息、只显示最新 session

- 状态：resolved
- 快照：30da69458e06fbaa2fbac1666e96ab332d121257
- 进入时间：'2026-09-01 15:06:55'

### 2.1 Bug 现象与复现

来源：spec 追加任务 `[fix] 2026-09-01 15:06:30`。

> 推动 spec 状态、追加任务而创建 session 时，会清空 session 组内的消息，只显示最新 session 内容；
> 刷新页面，或切换其他 session 再切换回来，才能获取 session 组完整消息。

与 Debug 1 的现象三元组一致（清空 / 只显示最新 session / 切走再切回才恢复），但发生在 Debug 1
的修复（`planHistoryLoad` + `hold` 第三态）**已经落地之后**——说明 `hold` 只堵住了一扇门。

### 2.2 Debug 基线

- 快照 SHA：`30da69458e06fbaa2fbac1666e96ab332d121257`（`git stash create`；进入时工作区含 Debug 1 的未提交修复 + `spec.md` / `TODO.md` 既有改动）
- 进入时间：`2026-09-01 15:06:55`
- 退出闸门基准：`git diff 30da694`

### 2.3 关联链路分析

```
SpecDetail 挂载
  → GET /specs/:id/session（探针）        实测 1.5 ms
  → requestChatSession(A)
ChatPanel 挂载
  → createResource(api.listSessions)      GET /sessions 实测 1.1 s（要扫 adapter 侧 transcript）
  → sessionsLoaded() = sessions() !== undefined
  → planHistoryLoad({ listLoaded, known, ... })   chat-history-load.ts:55
```

关键点：探针比会话列表快 **约 750 倍**，所以「整页加载」后存在一个 **~1.1 s 的
`listLoaded === false` 窗口**；`planHistoryLoad` 在这个窗口里刻意退回「按单 session 加载」的
旧行为，于是把 `displayedSid` 写脏——正是 Debug 1 认定的中毒路径，只不过入口从
`known === false` 换成了 `listLoaded === false`。

### 2.4 假设看板

| # | 假设 | 成立会看到 | 不成立会看到 | 结论 |
| - | ---- | ---------- | ------------ | ---- |
| H1 | 服务端聚合端点 / 会话列表有误 | `GET /specs/:id/messages` 缺轮次；列表缺 session | 两者都完整 | **已排除**（见 E1） |
| H2 | Solid `createResource` 在 `refetch()` 期间把值置回 `undefined`，导致 `listLoaded` 抖动 | `read()` 里有重置逻辑 | 重置只发生在 source 变更 | **已排除**（见 E2） |
| H3 | 「温路径」（面板已停在 A，点推动新建 B）仍然出错 | 回放出现 `getSessionMessages(B)` | 回放为 `hold → getSpecMessages` | **已排除**（见 E3 · R1/R1b/R1c） |
| H4 | 冷路径：会话列表首个请求在飞行中时切到新 session，`listLoaded=false` 退回单 session 加载并写脏 `displayedSid`，之后被 `running && sameSession` 守卫吞掉 | 回放出现 `resetParts + getSessionMessages(B)` 后连续 `KEEP` | 出现 `hold` | **成立**（见 E3 · R2 / R5） |
| H5 | `hold` 本身会永久卡死：服务端有、但被 `SESSION_LIST_LIMIT=30` 截断出列表的 session，`known` 永远为假 | 回放只剩一条 `HOLD` 且不再前进 | 最终退回单 session 加载 | **成立**（见 E3 · R6，Debug 1 引入的新缺陷） |

### 2.5 证据

**E1 — 服务端数据完好（H1 排除）**

对运行中的服务（`node dist/cli/index.js serve --port 7424`，15:04 启动）直接取证：

```
GET /projects/yorz-6f1f9f/specs/260831.refct.session-split-chat-grouping/messages
5bb27e03 claude 22:36:24 msgs=301
7dcc3621 claude 22:56:51 msgs=17
7b01a972 claude 10:55:29 msgs=162
1e1db67e claude 15:06:30 msgs=56          ← 15:06:30 追加任务新建的这一轮
```

会话列表同样完整（`1e1db67e` running=true 排第 0，`7b01a972` 排第 1，同 spec 四条都在）。
聚合与分组的原料没问题，问题在 GUI 侧时序。

**E2 — `createResource` 在 refetch 期间不会置空（H2 排除）**

`solid-js@1.9.13/dist/solid.js:318` `read()` 直接 `return value()`；`load()` 只在 promise 落地时
`completeLoad → setValue`，refetch 期间不重置。所以 `sessionsLoaded()` 不会在 refetch 中抖动。
（顺带记录：`load()` 第 337 行 `if (refetching !== false && scheduled) return` ——**同一个
microtask 内的第二次 `refetch()` 会被静默丢弃**，见 E3·R3。）

**E3 — 复现（脚手架 `tmp-repro-round2.test.ts`，用真实 Solid 图 + 真实 `planHistoryLoad`/`groupSessions` 回放）**

```
R1  温路径（面板已停在 A，点推动新建 B）
    ["HOLD(sid-B)","resetParts(clear:sid-B)","getSpecMessages(spec-1)","KEEP(sid-B)"]          ✅ 正确

R1b 幽灵过滤（B 尚未 running，第一次 refetch 的响应里没有 B）
    ["HOLD(sid-B)"] → running 边沿后 ["…","getSpecMessages(spec-1)"]                            ✅ 能自愈

R1c selectSession 与 SSE 的两次 refetch 落在同一 tick
    实际只发出 1 个列表请求（Solid 的 scheduled 合流），最终仍 getSpecMessages                  ✅ 正确

R2  冷路径：列表首个请求仍在飞行中就切到新 session
    ["resetParts(clear:sid-A)","getSessionMessages(sid-A)",
     "resetParts(clear:sid-B)","getSessionMessages(sid-B)","KEEP(sid-B)","KEEP(sid-B)"]         ❌ 复现

R5  整页加载时该 spec 正好有一轮在跑（完全不需要点任何按钮）
    ["resetParts(clear:sid-B)","getSessionMessages(sid-B)","KEEP(sid-B)","KEEP(sid-B)"]         ❌ 复现
    本轮结束后才出现 getSpecMessages —— 整个观看过程中都只显示最新 session

R6  session 在服务端存在、但被 SESSION_LIST_LIMIT=30 截断出列表（本项目共 162 条）
    ["HOLD(sid-OLD)"]                                                                            ❌ 永久卡在 hold
```

R2 / R5 的调用序列与三个现象逐一对应：

1. `resetParts(clear:sid-B)` → **现象 1：消息区被清空**
2. `getSessionMessages(sid-B)` → **现象 2：只显示最新 session 的内容**
3. `KEEP(sid-B)` → **现象 3：列表落地后的纠正性加载被 `running && sameSession` 守卫吞掉**，
   只有刷新页面或切走再切回（改写 `displayedSid` 令 `sameSession=false`）才恢复

**E4 — 窗口有多大（为什么这条路径日常可达）**

对运行中的服务实测（同一进程、本地）：

```
GET /specs/:id/session   0.0015 s      ← SpecDetail 探针，决定 requestChatSession
GET /sessions            1.10   s      ← ChatPanel 的会话列表，决定 listLoaded/known
GET /specs/:id/messages  0.017  s
GET /sessions/:sid/messages 0.004 s
```

列表端点比探针慢 **约 750 倍**（`listSessions()` 要合并 claude/codex/opencode adapter 的
transcript 扫描）。所以每次整页加载后都有 **~1.1 s** 的 `listLoaded === false` 窗口，
R2（窗口内点推动/追加）与 R5（窗口内该 spec 正在跑）都落在这个窗口里。

**根因定论**

Debug 1 把「列表还不认识这个 session」认成第三态并加了 `hold`，但只覆盖了
`listLoaded && !known`。真正的不变量是「**在能确认 session 归属之前，绝不写 `displayedSid`**」，
而 `listLoaded === false` 同样不能确认归属——`planHistoryLoad` 却在那里刻意退回旧行为，
于是把 `displayedSid` 写脏，`running && sameSession` 守卫再一次把唯一的纠正机会堵死。

同时 `hold` 缺一个逃生口：它假设「refetch 一定会带回这个 session」，而
`SESSION_LIST_LIMIT = 30` 截断（本项目 162 条会话）会让这个假设永久不成立（R6）。

### 2.6 脚手架清单

| # | 文件 / 位置 | 类型 | 状态 |
| - | ----------- | ---- | ---- |
| S1 | `src/gui/src/lib/__tests__/tmp-repro-round2.test.ts` | 临时复现用例（真实 Solid 图回放 R1–R6） | ✅ 已删除 |
| S2 | `tmp-vitest-debug2.config.ts`（仓库根） | 临时 vitest 配置（`resolve.conditions` 指向浏览器构建，否则 solid-js 走 SSR 构建、`createEffect` 为 no-op） | ✅ 已删除 |

> 无临时短路 / Mock / 注释掉的业务代码；E1 / E4 的服务端取证是对**运行中的服务**直接发 HTTP 请求，
> 未改动任何生产代码路径。

### 2.7 最终修复

修复围绕一条不变量：**在能确认 session 归属之前，绝不写 `displayedSid`；已经写下的内容，
必须留有被纠正的余地。**

**修复 1 — `hold` 覆盖「列表尚未确认」的全部情形（对应 R2 / R5）**

`chat-history-load.ts` 把 `listLoaded` 换成 `listPending`，判据由
`listLoaded && !known` 改为 `!known && listPending`：只要列表还欠一个关于该 session 的答复
（首个请求在飞行中 **或** refetch 在飞行中），一律 `hold`，不清空、不加载、不写 `displayedSid`。
这堵住了 Debug 1 遗漏的那扇门——`listLoaded === false` 的 ~1.1 s 窗口。

**修复 2 — `hold` 必须是等待，不是归宿（对应 R6，Debug 1 引入的缺陷）**

`listPending` 落地后若 `known` 仍为假，说明这个 session 永远不会出现在列表里
（被 `SESSION_LIST_LIMIT = 30` 截断，或列表请求失败），此时退回单 session 加载而不是继续挂着。

**修复 3 — 记住「屏幕上是什么」，而不只是「屏幕上是哪个 session」（让修复 2 安全）**

新增 `displayedSpecId`：消息区当前呈现的是哪个 spec 的聚合历史（单 session 时为
`undefined`）。守卫由 `running && sameSession` 收紧为 `running && sameSession && sameScope`。
于是「在猜测下按单 session 加载过」的内容，等列表补齐后**即便本轮仍在运行**也能被重新按整组读取
（`clear: false`，内容到达时替换，不闪空）。这正是 Debug 1 里被守卫吞掉的那次纠正。
R1b（新 session 因 `createdAt === updatedAt` 被服务端幽灵过滤掉、第一次 refetch 带不回它）
就是靠这条自愈的。

**修复 4 — `selectSession()` 的调用顺序**

`refetchSessions()` 必须在 `setActiveSid()` **之前**：历史 effect 在 `setActiveSid` 时同步执行，
`sessions.loading` 是它判断「列表还欠答复」的唯一依据。顺序写反会让 effect 看到一个已落定的列表、
把新 session 当普通 chat 加载。`session-started`（codex 中途换 id）处同理。

**顺带**：`activeSessionPending` 把 `known` 折进 memo（而非直接传 `sessions.loading`），
使其在选中已知 session 期间恒为 `false`——否则每个 SSE 状态边沿触发的列表 refetch 都会让历史
effect 多跑两次、多发两次 `getSpecMessages`。

### 2.8 收尾核对

| 项 | 结果 |
| -- | ---- |
| 脚手架还原 | ✅ S1–S2 全部删除，无临时短路 / Mock / 注释残留 |
| 退出闸门 `git diff 30da694` | ✅ 仅剩 `ChatPanel.tsx` 一个已跟踪文件的合法修复（+36/−5）；另有两个未跟踪文件 `chat-history-load.ts` 与其单测的改动（未跟踪文件不进 `git diff`） |
| `pnpm typecheck` | ✅ 无错 |
| `pnpm test` | ✅ 73 文件 / 693 通过 + 2 skipped（Debug 1 收尾时为 690 通过） |
| `pnpm build:gui` | ✅ 构建成功 |
| prettier | ✅ 三个改动文件已格式化 |
| 回归测试 | ✅ `chat-history-load.test.ts` 由 11 例增至 14 例，新增三条：首个列表请求在飞行中要 `hold`、列表落定仍不认识则退回单 session 加载、屏幕上是单 session 而该行已知属于某 spec 时**即便运行中**也要重读整组 |
| 复现步骤重跑 | ✅ 见下表 |

以真实 Solid 响应式图回放，修复前后的调用序列：

| 场景 | 修复前 | 修复后 |
| ---- | ------ | ------ |
| R1 温路径：面板停在 A，点推动新建 B | `HOLD → clear → getSpecMessages` ✅ 本就正确 | 同左，且少发一次冗余请求 |
| **R2 冷路径**：列表首个请求在飞行中就切到新 session | `clear+getSessionMessages(A)` → `clear+getSessionMessages(B)` → `KEEP` → `KEEP` ❌ | `HOLD(A) → HOLD(B) → clear → getSpecMessages` ✅ |
| **R5 整页加载时该 spec 正在跑**（不需点任何按钮） | `clear+getSessionMessages(B)` → `KEEP` → `KEEP`，整轮只显示最新 session ❌ | `HOLD → clear → getSpecMessages → KEEP` ✅ |
| R1b 幽灵过滤：第一次 refetch 带不回 B | `HOLD` → running 边沿后自愈 ✅ | 先退回单 session，再靠 scope 检查自愈为 `getSpecMessages` ✅ |
| **R6 session 被 `SESSION_LIST_LIMIT=30` 截断出列表** | `HOLD` 永久卡死 ❌ | `HOLD → clear → getSessionMessages` ✅ 不再卡死 |

**残留（不属于本次根因，未扩大改动面）**：

1. `runningSids` 是整对象 signal，任何 SSE 状态边沿都会换掉它的引用，使历史 effect 在
   本轮结束后重复发两次 `getSpecMessages`（本地 17 ms，`clear: false`，不闪屏、不改内容）。
2. `GET /sessions` 实测 1.1 s（`listSessions()` 要合并三个 adapter 的 transcript 扫描），
   是本次两扇门的时间成因；本次以「不在窗口内乱猜」规避，未优化端点本身。
3. `spec.md` `## 7. 追加任务` 中该 `[fix] 2026-09-01 15:06:30` 条目仍为 `[open]`，
   与 Debug 1 同理，交由 yorz-spec 状态机在收敛到 `done` 时处理。

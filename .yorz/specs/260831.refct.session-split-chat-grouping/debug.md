---
status: resolved
active:
updated_at: '2026-09-02 20:05:12'
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

## Debug 3 · 追加任务新建 session 执行中，来回切换 session 时正在执行的 session 有几率空白

- 状态：resolved
- 快照：a9f506fcc422bd6f8240b0827e4ea703e6b51282
- 进入时间：'2026-09-02 19:45:04'

### 3.1 Bug 现象与复现

来源：spec 追加任务 `[fix] 2026-09-02 19:44:47`。

> spec 追加任务创建 session 重新执行时，来回切换 session，当前正在执行的 session
> 有几率显示空页面，无法加载该 session 组中的历史消息。
> 类似问题修复了好几次，需要用日志作为判断依据。

与 Debug 1 / 2 的区别：这次带**概率性**（"有几率"），且明确绑定「当前正在执行的 session」
与「来回切换」——指向竞态而非固定的状态判定错误。

### 3.2 Debug 基线

- 快照 SHA：`a9f506fcc422bd6f8240b0827e4ea703e6b51282`（`git stash create`；进入时工作区含
  `spec.md` / `TODO.md` 既有未提交改动，Debug 1/2 的修复已提交进 HEAD `84f29b5`）
- 进入时间：`2026-09-02 19:45:04`
- 退出闸门基准：`git diff a9f506f`

### 3.3 关联链路分析

```
selectSession(sid)                                   ChatPanel.tsx:465-474
  → void refetchSessions()        GET /sessions              实测 ~250ms–1.1s
  → setActiveSid(sid)             历史 effect 同步执行
历史 effect                                          ChatPanel.tsx:585-635
  → planHistoryLoad(...) = load(clear:true, specId)
  → resetParts()                  ★ 消息区立即被清空
  → api.getSpecMessages(...)      GET /specs/:id/messages    实测 ~17ms
  → .then(next => { if (!disposed) resetParts(next) })
  → onCleanup(() => disposed = true)   ★ effect 每次重跑都会执行
```

两条互相独立的时间线在这里交叉：

1. **加载线**：`resetParts()` 先把消息区清空，内容要等 `GET /specs/:id/messages` 回来才补上。
2. **重跑线**：`GET /sessions` 的响应落地 → `createEffect`（ChatPanel.tsx:363-378）把
   `runningSids` **整体重建成一个新对象** → 历史 effect 读了 `isRunning(sid)`，跟着重跑。

重跑落到 `keep` 分支时（`running && sameSession && sameScope`）不发起任何新加载，
但 `onCleanup` 已经把加载线作废了——**清空生效、内容被丢弃、没人接手**。

### 3.4 假设看板

| # | 假设 | 成立会看到 | 不成立会看到 | 结论 |
| - | ---- | ---------- | ------------ | ---- |
| H1 | `planHistoryLoad` 又漏了一个状态，把整组读成了单 session | 日志出现 `getSessionMessages` 而非 `getSpecMessages` | 日志里就是 `getSpecMessages(spec-…)` | **已排除**（E2）：真实浏览器日志显示计划正确、请求正确、URL 正确 |
| H2 | 服务端聚合端点返回空 | `load-done parts=0` | `load-done parts=891` | **已排除**（E2）：服务端返回 891/898/925 条，数据完好 |
| H3 | 历史 effect 的 `onCleanup` 在「重跑但不重新加载」时也会作废 in-flight 加载，导致清空后无人补内容 | `CLEANUP dispose` → `plan=keep parts=0` → `load-done … disposed=true` | `load-done … disposed=false` | **成立**（E1 / E2） |
| H4 | 触发重跑的是 `runningSids` 整对象 signal（每个列表响应/SSE 边沿都换引用） | 重跑前紧邻一条 `REBUILD runningSids (list response landed)` | 重跑与列表响应无关 | **成立**（E1 / E3） |
| H5 | 「有几率」= `GET /sessions`（慢）与 `GET /specs/:id/messages`（快）的响应赛跑 | 同一次会话里，先落地者不同则结果不同 | 每次都空白 / 每次都正常 | **成立**（E3）：同一次运行中，首次点击 `disposed=false` 正常，切走再切回 `disposed=true` 空白 |

### 3.5 证据

**E1 — 复现（脚手架 S1，真实 solid-js 运行时 + 真实 `planHistoryLoad` / `groupSessions` 回放）**

按「停在普通 chat 行 → 切到正在执行的 spec 行 → 列表响应落地」回放，实测调用日志：

```
--- selectSession(sid-B) ---
REQ list#2
plan=load(sid=sid-B,spec=spec-1,run=true)
resetParts(EMPTY)                                              ← 现象：消息区被清空
REQ getSpecMessages(spec-1)
REBUILD runningSids (deps: sessions + activeSid=sid-B) -> NEW object   ← 触发器
plan=keep(sid=sid-B,spec=spec-1,run=true)                      ← 重跑落到 keep，不发起加载
RES spec:spec-1
DROPPED spec:spec-1                                            ← 根因：加载结果被 onCleanup 作废
R1 PARTS = ""                                                  ← 空页面
```

**E2 — 真实浏览器 / 真实服务端取证（脚手架 S2 + S3，`node dist/cli/index.js serve --port 7431`）**

在真实 GUI 里加 `[dbg3]` 探针（S2），用 Playwright 驱动真实 Chromium 点击真实会话行（S3），
唯一被 stub 的只有 `GET /sessions` 响应里那一个 `running` 标记（本机没有真在跑的 agent）。

> 第一版探针在 effect 内直接读了 `parts()`，把探针自己变成了 effect 的依赖、制造出被测的重跑。
> 已改为 `untrack(() => parts().length)` 后重新取证；下方日志是**未被污染**的版本。

```
===== 3) 切回正在执行的 spec 行 =====
REQ  /api/projects/yorz-6f1f9f/sessions
[dbg3] plan=load sid=2a674da8… spec=260831.refct.session-split-chat-grouping run=true
       dispSid=5e2157c2… dispSpec=- known=true pending=false parts=81
[dbg3] load-start spec:260831.refct.session-split-chat-grouping clear=true      ← 清空
[dbg3] REBUILD runningSids (list response landed) n=30 sid=2a674da8…            ← 触发器
REQ  /api/projects/yorz-6f1f9f/specs/260831.refct.session-split-chat-grouping/messages
[dbg3] CLEANUP dispose spec:260831.refct.session-split-chat-grouping            ← 作废加载
[dbg3] plan=keep … parts=0                                                     ← 空页面，且不再加载
RES  /api/projects/yorz-6f1f9f/specs/260831.refct.session-split-chat-grouping/messages
[dbg3] load-done spec:260831.…/messages parts=898 disposed=true                ← 898 条到货被丢弃
[dbg3] plan=keep … parts=0                                                     ← 此后恒为 keep
```

`parts=0` 与 `load-done parts=898 disposed=true` 同时出现，是这条根因的**决定性证据**：
内容拿到了、URL 对了、服务端没问题，纯粹是被 GUI 自己扔掉的。

**E3 — 为什么「有几率」（同一次运行内的对照）**

同一次浏览器会话里，两次点击同一个 spec 行结果相反：

```
===== 1) 点击正在执行的 spec 行 =====            ← 正常
[dbg3] load-start spec:… clear=true
RES  /specs/…/messages
[dbg3] load-done spec:… parts=891 disposed=false   ← 加载先到货，之后的 CLEANUP 无害
[dbg3] plan=keep … parts=891

===== 3) 切回正在执行的 spec 行 =====            ← 空白
[dbg3] load-start spec:… clear=true
[dbg3] CLEANUP dispose spec:…                      ← 列表响应先到货
[dbg3] plan=keep … parts=0
[dbg3] load-done spec:… parts=898 disposed=true
```

差别只在 `GET /sessions`（Debug 2 实测 ~1.1s）与 `GET /specs/:id/messages`（~17ms）
**谁先落地**。「来回切换」恰好制造这种交错：每次切换都会补发一个 `/sessions`，
上一次切换的响应就很容易落在这一次的读取窗口里——这就是「有几率」的来源。

**根因定论**

历史 effect 用 `onCleanup` 作废 in-flight 加载，等价于假设「effect 重跑 ⇒ 要换内容」。
这个假设不成立：effect 会因为**与内容无关**的原因频繁重跑（列表在每个 SSE 状态边沿刷新，
每个响应都把 `runningSids` 重建为新对象）。当这样的重跑落到 `keep` / `hold` 这些
**不发起新加载**的分支时，被作废的加载没有任何人接手；而消息区已经被 `clear: true` 清空。

于是三件事同时成立，就是用户看到的空页面：

1. `clear: true` 已经清空了消息区；
2. `onCleanup` 丢掉了唯一在飞的加载；
3. 之后每次重跑都返回 `keep`（本轮一直 running），永远不会再发起加载。

Debug 1 / 2 修的都是**同步的"该读什么"**（`planHistoryLoad` 的状态判定），
这次是**异步的"读回来的东西还要不要"**——同一个 effect 的另一半，此前从未被检视。

### 3.6 脚手架清单

| # | 文件 / 位置 | 类型 | 状态 |
| - | ----------- | ---- | ---- |
| S1 | `src/gui/src/lib/__tests__/tmp-repro-round3.test.ts` + `tmp-vitest-debug3.config.ts` | 临时复现用例 + 临时 vitest 配置（`resolve.conditions` 指向浏览器构建） | ✅ 已删除 |
| S2 | `ChatPanel.tsx` 内 5 处 `// TMP-DBG3` `console.log`（历史 effect 的 plan / load-start / load-done / CLEANUP，以及 runningSids 重建）与随之引入的 `untrack` import | ✅ 已还原 |
| S3 | `tmp-dbg3-drive.mjs`（仓库根） | 临时 Playwright 驱动脚本（真实浏览器取证；stub 了 `GET /sessions` 里的一个 `running` 标记） | ✅ 已删除 |
| S4 | `/tmp/ChatPanel.fixed.tsx` | 修复版备份（做「修复前 / 只有 gate / 两者齐全」三组对照时来回切换代码） | ✅ 已删除（仓库外） |

> 无临时短路 / Mock 业务逻辑 / 注释掉的生产代码；S3 唯一的 Mock 是把某个 session 的
> `running` 置真（本机没有真在执行的 agent），不改变任何被调查的代码路径。


### 3.7 最终修复

修复围绕一条新的不变量：**「effect 重跑」不等于「要换内容」——只有真正接管消息区的动作
才有权作废在飞的加载。**

**修复 1 —— 用令牌取代 `onCleanup` 作废（对应根因，`chat-history-load.ts` + `ChatPanel.tsx`）**

新增 `createHistoryLoadGate()`：`begin()` 领取一个令牌并返回「我是否仍然拥有消息区」的判定，
`invalidate()` 用于「接管消息区但不加载」的场合。历史 effect 改为
`const isCurrent = historyGate.begin()` + `.then(next => { if (isCurrent()) resetParts(next) })`，
删掉 `onCleanup(() => disposed = true)`。

于是作废只发生在**真的有人接手**的时候：

- 新的一次 `load`（`begin()` 抢走令牌，旧结果自然作废——原来的取消语义完整保留）；
- `historyGate.invalidate()` 的四个接管点：切换项目、`newSession()` 回到草稿、
  `sendFromDraft()` 写入乐观用户消息、组件卸载。

而 `keep` / `hold` / `fresh` / `idle` 这些**不发起加载**的重跑，不再动在飞的加载。

**修复 2 —— 消除与内容无关的重跑（对应触发器 H4，也顺带清掉 Debug 2 的残留 1）**

历史 effect 里 `isRunning(sid)` 改为读已有的布尔 memo `activeRunning()`。
`runningSids` 是整对象 signal，每个列表响应都把它换成新引用；直接读它等于让 effect
跟着每个 SSE 状态边沿重跑。改成布尔 memo 后只有「运行态真的翻转」才重跑。

实测（真实浏览器日志）：修复前一次「切回」要跑 3 次历史 effect，修复后只跑 1 次；
Debug 2 记录的「本轮结束后重复发两次 `getSpecMessages`」也随之消失。

> 单独验证过：**只有修复 1** 时新增的 e2e 回归用例即可通过——修复 1 是充分且必要的那一条，
> 修复 2 是把竞态窗口本身关掉的加固。

### 3.8 收尾核对

| 项 | 结果 |
| -- | ---- |
| 脚手架还原 | ✅ S1–S4 全部清理，`grep TMP-DBG3` 无残留，无临时短路 / Mock / 注释掉的业务代码 |
| 退出闸门 `git diff a9f506f` | ✅ 仅剩 3 个已跟踪文件的合法修复（`ChatPanel.tsx` +19/−7、`chat-history-load.ts` +42、`chat-history-load.test.ts` +45/−1）+ 1 个新增 e2e 用例；`spec.md` / `TODO.md` 是进入前就有的既有改动 |
| `pnpm typecheck` | ✅ 无错 |
| `pnpm test` | ✅ 74 文件 / 724 通过 + 2 skipped（Debug 2 收尾时为 73 文件 / 693 通过） |
| `pnpm build` | ✅ CLI + GUI 均构建成功 |
| `playwright test` | ✅ 41 例；新增用例通过。`sidebar-hover-peek` 有一次抖动（折叠宽度 34.45 vs 36，CSS 过渡计时），单独重跑 3/3 通过，与本次改动无关 |
| prettier | ✅ 改动文件已格式化 |
| 回归测试 | ✅ `chat-history-load.test.ts` 由 14 例增至 **20 例**（新增 `createHistoryLoadGate` 4 例）；新增 e2e `chat-spec-group-switch.spec.ts` |
| 复现步骤重跑 | ✅ 见下表 |

**修复前后对照（真实浏览器 `[dbg3]` 日志，同一操作序列）**

| 阶段 | 修复前 | 修复后 |
| ---- | ------ | ------ |
| 1) 点击正在执行的 spec 行 | `load-start clear=true` → `load-done parts=891 disposed=false` ✅（加载侥幸先到） | 同左 ✅ |
| 2) 切走到普通 chat 行 | `load-done parts=81` ✅ | 同左 ✅ |
| **3) 切回正在执行的 spec 行** | `load-start clear=true` → `CLEANUP dispose` → `plan=keep parts=0` → `load-done parts=898 disposed=true` → 此后恒为 `keep` ❌ **永久空白** | `load-start clear=true` → `load-done parts=925 current=true` ✅ **内容落地**，且 `REBUILD runningSids` 后不再有多余重跑 |

**e2e 回归用例的有效性验证**（`chat-spec-group-switch.spec.ts`，把 `/sessions` 压到 250ms、
`/specs/:id/messages` 压到 700ms 让竞态必现）：

| 代码版本 | 结果 |
| -------- | ---- |
| 修复前（`onCleanup` 作废 + `isRunning(sid)`） | ❌ failed —— `ROUND-A-CONTENT` 从未出现 |
| 只有修复 1（gate，保留 `isRunning(sid)`） | ✅ passed |
| 修复 1 + 修复 2 | ✅ passed |

**残留（不属于本次根因，未扩大改动面）**：

1. `GET /sessions` 依旧慢（e2e 那个只有 1 个 spec 的空项目上，服务端自己都打了
   `slow request … durationMs=1239` 的 warn）。它是本次竞态的时间成因；本次以
   「不作废无人接手的加载」化解，未优化端点本身。
2. `spec.md` `## 7. 追加任务` 中该 `[fix] 2026-09-02 19:44:47` 条目仍为 `[open]`，
   与 Debug 1 / 2 同理，交由 yorz-spec 状态机在收敛到 `done` 时处理。

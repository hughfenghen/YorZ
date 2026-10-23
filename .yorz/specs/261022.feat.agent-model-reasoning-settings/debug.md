---
status: resolved
active:
updated_at: '2026-10-23 12:44:08'
---

## Debug 1 · 设置页级联 Select 首次切换失效与全局配置加载阻塞

- 状态：resolved
- 快照：2d9b973d3141b51bdb5c25be28f80c20ef180c88
- 进入时间：'2026-10-22 22:06:33'

### 1.1 Bug 现象与复现

- 桌面端设置中切换模型或推理强度时，首次操作经常不生效，第二次选择基本成功。
- 中英文的空值选项“由 Agent 决定”需统一显示为“--”。
- 打开全局配置时长时间显示“加载中”；模型目录与推理强度应异步补齐，不应阻塞弹窗主 UI 渲染。
- 复现结果：用可控 Promise 构造两次连续配置写入；旧请求完成时，旧实现会直接把响应中的旧配置 `mutate` 回 UI，稳定覆盖第二次乐观选值。

### 1.2 关联链路分析

- 移动端全局/项目设置在每次选择后都执行“乐观 `mutate` → 并发 PUT → 响应再 `mutate`”；连续选择模型与推理强度时，先发响应会把后选值回退，服务端整体覆写也存在后完成的旧请求覆盖新请求的风险。
- 桌面端全局设置同样以 fire-and-forget 方式并发整体配置 PUT，需与移动端一起收敛为按用户操作顺序落盘。
- 桌面端 `SettingsSelect` 是另一套原生 `<select>` 封装，未复用 `src/gui/src/components/ui/select.tsx`；为统一受控选值、Portal 和键盘交互，已迁移到现有 Kobalte Select。
- 桌面端全局弹窗在并行获取基础配置和 Agent 列表后，又 `await loadCatalog`，而整个表单受 `loading` 门禁控制；因此 Agent SDK 探测多慢，主 UI 就被阻塞多久。

### 1.3 Debug 基线

- 快照 SHA：`2d9b973d3141b51bdb5c25be28f80c20ef180c88`
- 进入时间：'2026-10-22 22:06:33'
- 退出闸门：`git diff 2d9b973d3141b51bdb5c25be28f80c20ef180c88`

### 1.4 假设看板

- H1（排除为主因）：原生 SettingsSelect 的 `onChange` 会立即把值交给上层，其内部没有会二次清空值的 effect；回退发生在上层异步保存响应落地时。不过该封装与项目现有 UI Select 重复，已按需求合并到 Kobalte Select。
- H2（排除）：目录请求仅更新 catalog/catalogLoading，没有根据过时配置清空 model/reasoningEffort；并且用 request id 已阻止过时目录响应落地。
- H3（确认）：全局弹窗把配置请求与慢模型目录请求绑定在同一 loading 门禁。直接证据是初始化函数在 `finally { setLoading(false) }` 之前执行 `await loadCatalog(...)`。
- H4（确认，根因）：整体覆写型 PUT 并发，且每个响应都无条件回写 UI，导致旧值覆盖新值。可控 Promise 测试中，只放行第一次任务时能稳定构造 `old-config` 先返回的窗口；修复后第二次写入仅在第一次结束后启动，且 `old-config` 不触发 UI 回写。

### 1.5 证据

- 新增 `latest-mutation-queue.test.ts`，用两个手动决议的 Promise 锁定时序：第二次 task 在第一次未完成时不启动；第一次结果不回写；只有最新结果回写。测试 2/2 通过。
- 修复采用共享 `createLatestMutationQueue`：桌面全局、移动全局、移动项目的配置写入均按操作顺序落盘，仅最新 revision 可以应用成功/失败结果。
- 桌面全局与项目弹窗的 catalog 请求均改为启动后不 await；基础配置就绪即渲染主 UI，模型/推理强度在自身的 `catalogLoading` 期间单独禁用。
- 桌面 `SettingsSelect` 已复用 `ui/select.tsx`；两端中英文四组 `agentDefaultOption` 均改为 `--`。
- 验证：`pnpm typecheck` 通过；`pnpm build:gui` 通过；`pnpm build:gui-mobile` 通过；`pnpm test` 通过（102 个测试文件，1007 个用例通过，2 个跳过）。

### 1.6 脚手架清单

- 无；取证用例作为永久回归测试保留，不属于临时脚手架。

### 1.7 收尾核对

- [x] 根因有硬证据。
- [x] 修复后重跑复现步骤，问题消失。
- [x] 脚手架全部核销。
- [x] `git diff <SNAP>` 与 `git status --short` 联合检查仅剩合法修复、回归测试和 Debug 活文档；进入前的 `spec.md` 改动仍在快照基线内。
- [x] 关联测试、类型检查与构建通过。

## Debug 2 · 桌面设置 Select 无法重开、推理强度选值丢失与长模型名折行

- 状态：resolved
- 快照：972290c342a8c45bb47099a9013ed9deb95e3a58
- 进入时间：'2026-10-22 22:34:14'

### 2.1 Bug 现象与复现

- 选择模型后，再次点击模型 Select 无反应，无法重新弹出模型选项。
- 选择推理强度、关闭设置弹窗再打开后，UI 未选中此前保存的值。
- 模型名较长时，Select 触发器中的选中值发生折行；期望单行并以省略号截断。
- 待通过组件级测试或可控交互入口稳定复现后，才进入最终修复。

### 2.2 关联链路分析

- 待检查桌面 `SettingsSelect` 对现有 Kobalte Select 的受控值、Portal 生命周期、触发器布局封装。
- 待检查全局与项目弹窗关闭/重开时配置初始化、catalog 异步返回、reasoningEffort 候选及受控选值之间的时序。
- 待检查 Select trigger/value 的 flex、宽度、`white-space`、overflow 与 text-overflow 样式链。

### 2.3 Debug 基线

- 快照 SHA：`972290c342a8c45bb47099a9013ed9deb95e3a58`
- 进入时间：'2026-10-22 22:34:14'
- 退出闸门：`git diff 972290c342a8c45bb47099a9013ed9deb95e3a58`

### 2.4 假设看板

- H1（确认，根因）：Kobalte 的 `SelectBase` 在选中项时先同步执行 `local.onChange`，随后才执行 `close()`；当前 `SettingsSelect` 的回调又同步触发上层 Solid 状态更新。上游同组件已有“选中后第二次 Portal 不再挂载”的一致问题与 DOM 证据，延后业务回调到 microtask 可让 Kobalte 先完成 close/Portal 清理。隔离到 Dialog 后还确认 Select Portal 被外层 modal 标成 `aria-hidden=true`，且与 Dialog 同为 `z-50`，重开菜单实际存在但落在遮罩后方，视觉上等同“无反应”。
- H2（确认，根因）：全局弹窗重开初始化直接发起 GET，不等待上一轮 `configSaveQueue`；若 reasoning PUT 尚在队列中，GET 会稳定读到旧配置并由 `applyConfig` 清空本地 reasoning。初始化请求也没有 revision 门禁，快速关开时过期响应可后落地。
- H3（确认，根因）：隔离页面选中长模型名后，value 计算样式为 `white-space: normal`、`overflow: visible`、`text-overflow: clip`；在约 101px 可用宽度下高度达到约 149px，截图稳定复现多行文字溢出固定 36px trigger。

### 2.5 证据

- 临时隔离页复现长模型名折行，计算样式与尺寸为：`whiteSpace=normal`、`overflow=visible`、`textOverflow=clip`、`width≈101px`、`height≈149px`。
- Kobalte `select-base.tsx` 的 selection change 顺序是 `local.onChange(...)` 后执行 `close()`；当前 `SettingsSelect` 在该同步回调内直接 `props.onChange(...)`，与已知 Portal 生命周期故障的触发条件一致。
- Dialog 隔离复现中，第二次打开后 trigger 为 `aria-expanded=true` 且 listbox 在 DOM 中，但 Portal 祖先为 `aria-hidden=true`，截图中菜单被 Dialog 遮罩压暗；`SelectContent` 与 Dialog 都使用 `z-50`。
- 全局设置 `persistPatch` 返回的保存 Promise 没有被重开初始化消费；`createEffect` 每次打开直接 `getGlobalConfig()`，因此“选值 → 立即关闭 → 重开”的读取可先于队列中最新 PUT。
- 修复后隔离复测：选中长模型再点击 trigger，`aria-expanded=true`，listbox 可见且 3 个选项可交互；Portal 不再有 `aria-hidden`，positioner 层级为 60。
- 修复后长模型 value 计算样式为 `white-space: nowrap`、`overflow: hidden`、`text-overflow: ellipsis`，高度约 25px；`scrollWidth≈506px > width≈120px`，确认以省略号截断而非折行。
- 最终修复：`SettingsSelect` 将上层选值更新推迟到 microtask；Select Portal 内容标记为 Kobalte top layer 并提升到 `z-[60]`；value 增加完整单行省略约束，图标禁止收缩，空值通过 placeholder 正常显示 `--`。
- 最终修复：mutation queue 增加 `whenIdle()`；全局弹窗重开先等待已排队保存，再读取配置，并用 request revision 拦截快速关开产生的过期响应。
- 验证：隔离交互复现通过；mutation queue 定向测试 3/3 通过；`pnpm typecheck`、`pnpm build:gui`、`pnpm test`、Prettier 检查及 `git diff --check` 全部退出码 0。

### 2.6 脚手架清单

- [resolved] `src/gui/settings-select-debug.html`：临时页面，已删除。
- [resolved] `src/gui/src/__debug__/settings-select-debug.tsx`：临时页面逻辑，已删除。

### 2.7 收尾核对

- [x] 根因有硬证据。
- [x] 修复后重跑复现步骤，问题消失。
- [x] 脚手架全部核销，临时页面及空目录均已删除。
- [x] `git diff <SNAP>` 与 `git status --short` 联合检查仅剩合法修复、回归测试和 Debug 活文档；进入前已有改动保留不动。
- [x] 关联测试、类型检查与构建通过。

## Debug 3 · 设置面板切换 Agent 或模型时页面卡死崩溃

- 状态：resolved
- 快照：6026ffbb685eb6a7cbad6510844a0fc750479cce
- 进入时间：'2026-10-23 12:35:13'

### 3.1 Bug 现象与复现

- 打开桌面设置面板后，点击切换 Agent 或模型，页面会卡死并崩溃。
- 当前环境没有可接管的应用内浏览器实例，无法直接回放用户页面；改用 jsdom 最小交互用例复现导致反馈循环的重复 selection 事件。
- 旧实现中，仅把当前候选数组替换为值完全相同的新对象，未发生用户操作，`SettingsSelect` 仍会错误调用一次上层 `onChange("claude-sonnet")`。

### 3.2 关联链路分析

- 桌面全局与项目设置均通过同一个 Kobalte `SettingsSelect` 呈现 Agent、模型和推理强度；各级候选由响应式 catalog/config 计算，每次上游选择、目录返回或配置回写都可能重建数组。
- Kobalte 0.13 的 Select 默认 `allowDuplicateSelectionEvents: true`。候选数组重建时，它会用当前 selected key 重新同步 selection，并把同值同步再次通过 `onChange` 暴露给业务层。
- `SettingsSelect` 又把该回调延迟到 microtask；业务层无法区分真实点击和内部同值同步，会重复进入级联清空、目录加载或配置保存，造成设置交互反馈链膨胀并表现为卡死。
- 移动端 `SettingsSelect` 使用原生 `<select>`，不经过 Kobalte 的重复 selection 事件链，因此无需修改。

### 3.3 Debug 基线

- 快照 SHA：`6026ffbb685eb6a7cbad6510844a0fc750479cce`
- 进入时间：'2026-10-23 12:35:13'
- 退出闸门：`git diff 6026ffbb685eb6a7cbad6510844a0fc750479cce`

### 3.4 假设看板

- H1（排除）：单纯由 options/value 对象身份不稳定导致 Kobalte 展开时递归。修正测试运行时后，无论候选对象是否重建，单个 Select 均能正常展开并完成一次真实选值。
- H2（确认，根因）：Kobalte 默认允许 duplicate selection event，响应式候选重建被误报成用户选值。若成立，等价候选重建会额外触发 `onChange`，而关闭 duplicate event 后应为 0 次；控制实验结果正是修复前 1 次、修复后 0 次。
- H3（排除为首因）：目录请求或保存队列自行形成循环。重复回调可在不挂载设置页、不调用任何 API 的最小组件用例中触发，说明网络链路只是放大器而非事件源。

### 3.5 证据

- Kobalte 本地源码显示 `SelectBase` 默认 `allowDuplicateSelectionEvents: true`，候选键变化 effect 会重新调用 `setSelectedKeys`；同版本的上游实际案例也以关闭 duplicate selection events 修复响应式 options 重建后的设置 Select 故障。
- 临时 jsdom 控制实验：真实选择另一个模型时 `onChange` 恰好 1 次；未操作 UI、仅重建等价候选时，旧实现仍错误回调 1 次。
- 最终修复在共享桌面 `SettingsSelect` 上设置 `allowDuplicateSelectionEvents={false}`。复测真实选择仍为 1 次，等价候选重建降为 0 次，内部 selection 同步不再进入业务级联链。
- 验证：`pnpm typecheck`、`pnpm build:gui`、`pnpm test`、`git diff --check` 均退出码 0。

### 3.6 脚手架清单

- [resolved] `src/gui/src/components/__tests__/settings-select-debug.test.ts`：临时 jsdom 交互取证用例，已删除。
- [resolved] `vitest.gui-debug.config.ts`：临时 Solid 浏览器条件测试配置，已删除。
- [resolved] `vite.config.ts`：取证期间的临时别名/inline 调整已全部还原，退出 diff 无该文件改动。

### 3.7 收尾核对

- [x] 根因有硬证据。
- [x] 修复后重跑最小复现，真实选择正常且重复 selection 事件消失。
- [x] 脚手架全部核销。
- [x] `git diff <SNAP>` 与 `git status --short` 联合检查仅新增合法修复；进入前已有改动和未跟踪文件均保留不动。
- [x] 关联测试、类型检查与构建通过。

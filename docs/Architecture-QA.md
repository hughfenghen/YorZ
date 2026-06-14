# 架构设计 - 待确认问题

> 本文档用于在动笔技术架构设计前，对齐关键决策点。
> 请在每个问题下方使用 `> 批注：xxx` 的形式给出你的倾向（关键词即可，不必详细）。
> 若你也没想清楚，可标注 `> 批注：待定`，我会在最终架构文档中给出方案对比与推荐。

---

## 1. Agent 生态范围

Skill 文件格式（如 `SKILL.md`）目前看起来是 Claude Code 风格的。架构层面需要决定支持范围：

- **A. 仅支持 Claude Code**
  - 优点：可深度利用 hooks、slash command、subagent 等能力；开发聚焦
  - 缺点：用户被锁定在单一 Agent
- **B. 多 Agent 兼容**（Claude Code / Cursor / Cline / Codex / Gemini CLI 等）
  - 优点：用户选择自由
  - 缺点：Skill 需要抽象层 + 为每个 Agent 写适配器；难以利用各家独有能力

> 批注：MVP 支持 claude code 和 opencode

---

## 2. Agent ↔ Service 通信机制（**核心**）

这是整个系统的命脉，决定 Skill 怎么写、用户决策如何阻塞 Agent：

- **A. Skill 内嵌 HTTP 调用**
  - Agent 执行 Skill 时通过 `curl` / `fetch` 把 JSON POST 给本地 Service
  - 简单直接，但"等待用户决策"需要轮询
- **B. 文件协议 + 文件监听**
  - Skill 写约定路径的 JSON 文件，Service 监听变化推到 GUI
  - 解耦彻底、可审计；但"双向交互"实现繁琐
- **C. MCP Server**
  - Service 同时暴露为 MCP Server，Agent 通过 MCP 工具回传输出 / 请求用户决策
  - 工具调用天然阻塞，适配"等待用户决策"场景
- **D. 混合方案**
  - MCP 用于"需要用户决策时阻塞等待"
  - HTTP/SSE 用于流式推送 Agent 输出到 GUI
  - 文件用于落盘 spec / 执行记录

**我的倾向：D**，因为"用户审阅决策"需要 Agent 阻塞，MCP 工具调用天然适配；同时落盘文件保证 git 友好、可审计。

> 批注：接受建议
> 我预想有以下两种交互，请根据交互描述设计通信机制：
>
> 1. 用户通过 cli 启动服务提供 WebUI，然后用户在 WebUI 中创建需求、决策等操作，Service 收集这些信息，启动并把信息传递给 Agent
> 2. 用户与 Agent 交互，在某些场景，比如决策时触发 skill，Agent 根据 skill 执行 cli 启动服务，并提供 URL 链接，用户在 URL 对应的页面使用更友好的 GUI 进行决策并提交信息，回传给 Agent，然后进行下一步

---

## 3. 部署形态

- **A. 纯本地单机**
  - cli 启动 service 监听 localhost，GUI 通过本地浏览器或同局域网手机访问
  - 简单、隐私好
- **B. 本地 + 公网穿透**
  - 移动端在外网也能访问家里电脑的开发环境
  - 需要考虑 tunnel（cloudflared / ngrok / tailscale）+ 认证
- **C. 未来考虑云端多租户**
  - 会影响数据隔离、auth、Agent 运行环境设计

移动端适配若要"出门也能用"，必然要面对 B 的问题。

> 批注：MVP 阶段以 A 为主，B 在架构层面预留可能性；C 暂不考虑

---

## 4. 技术栈偏好

### 4.1 CLI / Service 语言

- **Node.js (TypeScript)**：生态最广，与 GUI 同语言
- **Go**：单二进制分发友好、并发好
- **Rust**：性能最优，但开发成本高
- **Python**：AI 生态熟，但分发 / 性能稍弱

> 批注：Node.js (TypeScript)，因为下面GUI使用 solid.js，CLI/Service用TS可以与GUI同语言；分发用pnpm/npm

### 4.2 GUI 框架

- React / **Vue** / Svelte / SolidJS
- 是否做 PWA？（影响移动端"添加到主屏幕"、离线缓存）

> 批注：solid.js + Vite；MVP 不做 PWA，架构预留

### 4.3 图形组件选型

- **ReactFlow / VueFlow**：流程图、依赖图、code graph 通用底座
- **Mermaid**：时序图、架构图，渲染轻量但交互弱
- **D3**：完全自由，开发成本高
- **自研 Canvas/SVG 组件**：适合"渐进式披露 + 缩放聚焦"场景

> 批注：优先集成已有图形组件，早期不要过多引入复杂度，主要分三种
>
> 1. 如果已有契合场景的组件，直接集成进来，比如代码依赖关系图，依赖图
> 2. 如果没有，降级到使用成熟的图形组件来表达；比如使用 xyflow(React 实现，包装为 WebComponent 应用到solid.js) 图形组件表达模块之间的依赖关系，Mermaid 流程图表达函数逻辑
> 3. 无法用图形化表达的高密度或抽象文字信息，使用普通 UI 库实现信息卡片（能突出重点、能展开折叠、能链接关联），或思维导图展现

---

## 5. 状态与持久化

Spec 文档、决策历史、执行记录、用户配置存哪里？

- **A. 项目目录下 `.yorz/` 文件**
  - md / json 落盘，git 友好、可审计、可团队分享
  - 检索效率一般
- **B. SQLite 本地库**
  - 查询方便、结构化好
  - 不便于 git 协作
- **C. 混合**
  - Spec / 执行记录 / 决策 用 md+json 落盘到 `.yorz/`
  - 索引、缓存、用户偏好用 SQLite 存到 `~/.yorz/`

> 批注：方案C

---

## 6.（补充）用户从 GUI 触发 Agent 的方式

GUI 中用户编辑完需求后，如何启动 Agent 工作流？

- **A. GUI 提示用户复制 prompt 到终端粘贴**
  - 简单，但割裂
- **B. Service 直接 spawn Agent 进程**（如 `claude` CLI）
  - 体验好，但需处理 Agent 进程生命周期、stdout 流式回传
- **C. GUI 仅生成 prompt，用户用任何 Agent 自行启动**
  - 解耦最彻底

> 批注：我预想有以下两种交互：
>
> 1. 用户通过 cli 启动服务提供 WebUI，然后用户在 WebUI 中创建需求、决策等操作，Service 收集这些信息，启动并把信息传递给 Agent
> 2. 用户与 Agent 交互，在某些场景，比如决策时触发 skill，Agent 根据 skill 执行 cli 启动服务，并提供 URL 链接，用户在 URL 对应的页面使用更友好的 GUI 进行决策并提交信息，回传给 Agent，然后进行下一步

---

## 7.（补充）Skill 的运行时定位

Skill 是"Agent 执行流程的脚本"还是"Service 提供的能力"？

- **A. Skill 纯 Agent 侧**：md 文件描述步骤，Agent 自主理解执行，Service 只负责接收/展示输出
- **B. Skill 由 Service 注入**：Service 通过 MCP / hook 注入工具与流程约束，Skill 是 Service 能力的前端
- **C. 混合**：通用流程在 Skill md 里；需要 GUI 交互的环节由 Service 提供 MCP 工具

> 批注：方案C；通用流程靠 md，关键交互节点（决策、Review）由 Service 提供工具

---

## 待你批注后我会输出

确认完上述后，我会输出 `docs/Architecture.md`，至少包含：

1. **架构总览图**（CLI / Service / Skill / Agent / GUI 的关系与数据流）
2. **核心数据流**（用户输入需求 → Agent 工作流 → 用户决策 → 执行 → Review，端到端时序）
3. **模块设计**
   - CLI：命令清单、Skill 安装机制、Service 启停
   - Service：HTTP / MCP / 文件 三层接口，状态机管理
   - Skill：分类与协作约定
   - GUI：路由、状态管理、图形组件分层
4. **数据模型**（Spec / Decision / TaskList / ExecutionRecord 的 schema）
5. **关键技术决策与取舍**
6. **MVP 范围划分**（哪些是 v0.1 必须，哪些后置）
7. **风险与未决问题**

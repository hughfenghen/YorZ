# YorZ 技术架构设计

> 本文档基于 [`Prod-Design.md`](./Prod-Design.md) 与 [`Architecture-QA.md`](./Architecture-QA.md) 的决策结论编写。

---

## 1. 设计原则

1. **Agent 解耦**：核心能力（Spec / Decision / Task / Review）与具体 Agent 实现解耦；Agent 仅作为"执行体"通过文件协议接入。
2. **md 是单一真相（Single Source of Truth）**：所有上下文、分析、方案、决策、任务、执行记录都沉淀在项目 `.yorz/` 下的 md 文档中。人类直接可读，AI 直接可读，git 可追踪。
3. **无状态接力（HTTP-like）**：Agent 每次运行类似一次 HTTP 请求 handler——读 md → 做一段工作 → 写 md → 退出。不长驻、不依赖会话内存。需要用户决策/Review 时，Agent 把"待办标记"写入 md 后立即结束；用户完成输入后 Service 重新拉起 Agent 继续。哪怕中途断电、换电脑、隔几天再来，只要 md 在，工作就能续上。
4. **PC 与移动端同等支持**：移动端不是 PC 的退化版；GUI 设计与图形组件选型都需顾及触屏与小屏。
5. **渐进式复杂度**：MVP 先用 md + 信息卡片 + 文本线框图 + Mermaid；高级图形（依赖图 / code graph）后期通过 WebComponent 接入。
6. **两种交互入口对等支持**：GUI-first（先在 WebUI 编辑再启动 Agent）与 Agent-first（在终端与 Agent 对话中按需召唤 GUI）共享同一份 md 数据与同一个 Service。

---

## 2. 架构总览

### 2.1 模块拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│                          User                                    │
│   ┌────────────────┐                    ┌──────────────────┐     │
│   │  Terminal      │                    │  Browser (PC/M)  │     │
│   │  (claude/      │                    │  WebUI           │     │
│   │   opencode)    │                    │                  │     │
│   └───────┬────────┘                    └──────────┬───────┘     │
└───────────┼────────────────────────────────────────┼─────────────┘
            │ stdin/stdout                           │ HTTP/SSE
            ▼                                        ▼
   ┌────────────────┐                       ┌────────────────────┐
   │  Agent Process │                       │      Service       │
   │  (short-lived) │                       │ ┌──────────────┐   │
   │                │                       │ │  HTTP/SSE    │   │
   │   读 md ──┐    │                       │ │  FS Watcher  │   │
   │           │    │                       │ │  Agent Relauncher │
   │   写 md ──┼────┼──── file IO ─────────▶│ │              │   │
   │           │    │                       │ └──────────────┘   │
   │   exit ◀──┘    │                       └──────┬──────┬──────┘
   └────────────────┘                              │      │
            ▲                                      │      │
            │ spawn                                ▼      ▼
            │                              ┌──────────┐  ┌────────────┐
            └──────────────────────────────│ .yorz/   │  │ ~/.yorz/   │
                                           │ (project)│  │ db.sqlite  │
                                           │ md       │  │ + config   │
                                           └──────────┘  └────────────┘
                                                  ▲
                                                  │
                                            ┌─────┴───────┐
                                            │     CLI     │
                                            │   (yorz)    │
                                            └─────────────┘
```

### 2.2 通信范式（**核心思想**）

Agent 与 Service 之间**不存在长连接、不存在阻塞调用**。两者通过 **md 文档** 异步交换信息，参考 HTTP 的无状态实现模式：

| 阶段 | Agent 状态 | Service 行为 |
|------|-----------|-------------|
| 用户在 GUI 编辑需求 | 未启动 | 接收 GUI 输入，写入 spec md |
| Agent 工作 | 运行中 | 监听文件变化，SSE 推送给 GUI |
| Agent 遇到决策/Review | 写入"待办标记" → **退出** | 监听到 md 变化，识别待办，等待用户输入 |
| 用户在 GUI 决策 | 已退出 | 接收输入，合并到 md，**重新 spawn Agent**（prompt 指向 spec id） |
| Agent 续跑 | 新进程，读 md 还原上下文 | 同步推送 |

由此带来的属性：

- **强容错**：Agent 进程死掉 / 用户换设备 / 几天后再来，只要 md 在，从断点续行
- **强可审计**：所有状态变化都在 md 历史里，等同 git 日志
- **强解耦**：任何能读写文件的 Agent 都可接入；MCP 不是必需，仅在"Agent 主动通知 Service 拉起 GUI 链接"等场景作为可选优化

### 2.3 模块职责

| 模块 | 形态 | 职责 |
|------|------|------|
| **CLI** (`yorz`) | Node.js 可执行 | 安装 skills、启停 Service、初始化项目、状态查询 |
| **Service** | 常驻进程（CLI 启动） | HTTP/SSE + 文件监听 + Agent Relauncher + 存储；GUI 与 md 之间的桥梁 |
| **Skill** | md 文件（带 frontmatter） | 描述工作流步骤；引导 Agent 读写约定路径的 md，遇到交互节点优雅退出 |
| **GUI** | Solid.js SPA（Service 内置托管） | 需求编辑、决策审阅、执行 Review；图形化表达 |
| **Agent** | 外部进程（claude / opencode） | 按 skill 指令读写 md，**持续推进、遇阻即退**（待用户确认时退出，由 CLI 续拉），不长驻 |

---

## 3. 核心交互模式

YorZ 支持两种对等的入口，二者共享同一份 `.yorz/` md 与同一个 Service 实例。

### 3.1 模式 A：GUI-first（在 WebUI 中发起）

```
User → WebUI            创建需求、@关联、上传图片
     → POST /api/specs  Service 创建 .yorz/specs/<id>/spec.md
     → 点击"启动 Agent"
     ▼
Service spawns Agent    prompt: "执行 yorz-spec-* skill 流程，
                                  spec 路径：.yorz/specs/<id>/spec.md"
     ▼
Agent 读 md → 整理需求 / 分析 / 生成方案 → 写回 md
              （每写一次 Service FS Watcher 触发 SSE 推送 GUI）
     ▼
Agent 遇到决策点 → 在 md 写入：
   ## ⏸ 待用户决策: 数据库选型
   - 候选 A：PostgreSQL …
   - 候选 B：SQLite …
   <!-- yorz:await kind="decision" id="d1" -->
   → Agent 进程退出
     ▼
Service FS Watcher 解析 await 标记
   → SSE 通知 GUI 跳转决策页
   → GUI 渲染候选 + 关联信息
     ▼
User 在 GUI 完成决策 → POST /api/specs/<id>/inputs
   → Service 将用户选择合并到 md：
     ## ✅ 决策结果: 数据库选型
     选择 B (SQLite)，理由：…
   → Service 自动 spawn 新 Agent 进程：
     prompt: "继续 spec <id> 的工作流"
     ▼
Agent 读 md（含决策结果） → 继续生成任务 → 执行 → 写 review md
     ▼
执行完毕 / 再次遇到 await → 同样模式
```

### 3.2 模式 B：Agent-first（在终端中触发）

```
User 在终端与 Agent 自由对话
   → 对话中 Agent 判断当前需要走 YorZ 工作流（或用户显式触发 skill）
   → Skill 执行：
       │ 1. 探活 Service（读 ~/.yorz/runtime.json）
       │ 2. 未运行则 `yorz serve --background` 拉起
       │ 3. 在 .yorz/specs/<id>/spec.md 写入分析 / 方案
       │ 4. 写入 await 标记
       │ 5. 终端输出: "请打开 http://localhost:7423/specs/<id> 进行决策"
       │ 6. Agent 进程结束（用户的本次终端 session 自然结束此话题）
     ▼
User 在浏览器 / 手机打开链接 → GUI 加载该 spec.md
   → User 在 GUI 决策提交
   → Service 合并到 md
   → Service spawn 新 Agent 进程后续，stdout 推送到 GUI"执行中"视图
     （用户可在 GUI 内观察，也可回终端手动 `claude /yorz-resume <id>` 自己跑）
```

### 3.3 两种模式的共性

- 共享同一份 md（`.yorz/specs/<id>/spec.md`）
- 共享同一个 Service 进程（探活复用）
- "续跑 Agent"逻辑只有一份：根据 md 当前阶段构造 prompt 并 spawn
- 用户随时可在任何阶段从 GUI 或终端介入

---

## 4. 模块详细设计

### 4.1 CLI (`yorz`)

**定位**：用户与 Agent 进入 YorZ 体系的入口；轻量、零状态。

**核心命令**：

| 命令 | 说明 |
|------|------|
| `yorz init` | 在当前项目创建 `.yorz/` 目录骨架（默认 **不**写入 `.gitignore`，由用户决定是否提交） |
| `yorz install [--agent claude\|opencode] [--scope project\|user]` | 把 YorZ 内置 skills 复制到目标 Agent 的 skills 目录；**重复执行时直接覆盖** |
| `yorz serve [--port 7423] [--background] [--open]` | 启动 Service；后台模式时写入 `~/.yorz/runtime.json` 供其他进程探活 |
| `yorz status` | 显示运行中的 Service / 端口 / 项目路径 |
| `yorz stop` | 优雅停止 Service |
| `yorz resume <spec-id>` | 手动续跑：构造 prompt 并 spawn Agent 继续指定 spec（模式 B 备选） |

**Skill 安装目标路径**（MVP 阶段）：

- Claude Code: `~/.claude/skills/yorz-*/` 或 `<project>/.claude/skills/yorz-*/`
- OpenCode: `~/.config/opencode/skills/yorz-*/` 或 `<project>/.opencode/skills/yorz-*/`
  （以 OpenCode 实际约定为准，由适配层封装路径解析）

### 4.2 Service

**定位**：GUI 与 md 之间的桥梁；Agent 进程的拉起者；状态全部从 md 派生。

**进程内分层**：

```
┌─────────────────────────────────────────────────┐
│  Transport 层                                   │
│  ┌──────────────────────────────────────────┐   │
│  │  HTTP (Hono) + SSE + Static GUI          │   │
│  │  MCP Server（可选，仅用于通知/handoff）   │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│  Application 层                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  FS Watcher                              │   │
│  │   - 监听 .yorz/specs/**/*.md             │   │
│  │   - 解析 await/done 等内嵌标记           │   │
│  │   - 派生当前阶段，推 SSE                 │   │
│  ├──────────────────────────────────────────┤   │
│  │  Input Merger                            │   │
│  │   - 接收 GUI POST，把用户输入            │   │
│  │     合并回 md 对应 section               │   │
│  ├──────────────────────────────────────────┤   │
│  │  Agent Relauncher                        │   │
│  │   - 根据 md 当前阶段构造 prompt          │   │
│  │   - spawn claude / opencode，stdio 转发  │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│  Storage 层                                     │
│  ┌────────────────┐  ┌────────────────────┐    │
│  │ .yorz/ (FS)    │  │ ~/.yorz/db.sqlite  │    │
│  │ md 单一真相     │  │ 跨项目索引、偏好    │    │
│  └────────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**HTTP/SSE 接口**（草案）：

```
GET    /                          → 静态 GUI
GET    /specs/:id                 → GUI 路由（携 spec id，模式 B 直链入口）
GET    /api/specs                 → 列表（从 FS 扫描派生 + sqlite 索引加速）
POST   /api/specs                 → 创建新 spec md
GET    /api/specs/:id             → 返回 md 原文 + 解析出的阶段标记
GET    /api/specs/:id/events      → SSE：订阅该 spec 的 md 变化与 Agent stdout
POST   /api/specs/:id/start-agent → 模式 A：启动 Agent
POST   /api/specs/:id/inputs      → 提交用户输入（决策/Review），合并入 md，触发续跑
GET    /api/projects/current      → 当前 Service 关联的项目信息
```

**MCP 工具接口**（精简版，全部非阻塞）：

| Tool | 说明 |
|------|------|
| `yorz.ensure_service` | 探活 Service，未启动则拉起；返回 base URL |
| `yorz.notify_updated` | 通知 Service "我刚写了 md 的某段"，加速 SSE 推送（FS Watcher 兜底，调不调都行） |
| `yorz.handoff_url(specId, kind)` | 返回供用户打开的 URL（如 `/specs/<id>?focus=decision-d1`），Agent 拿到后 print 给用户并退出 |

> 注意：**MCP 不再用于阻塞通信**。所有需要用户输入的场景都通过"写 md → 退出 → 用户填 → Service 续跑"完成。任何不支持 MCP 的 Agent 都可以仅靠文件 IO + 终端 print URL 工作。

**Agent Relauncher**：

- 接口：`relaunch({ specId, stage })` —— 根据 spec md 派生 `stage`，构造对应 skill 触发 prompt
- 适配器封装：`adapters/claude.ts` / `adapters/opencode.ts`，处理 CLI 参数与 stdio 解析差异
- 多 spec 并行：每个 spec 一个 Agent 子进程实例，互不阻塞；Service 维护 `Map<specId, ChildProcess>`

### 4.3 Skill 设计

**核心心智**："Skill 是一段无状态的 handler。读 md → 做事 → 写 md → 退出。"

**位置**：仓库内 `packages/skills/`，通过 `yorz install` 复制到目标 Agent。

**MVP skill 列表**：

| Skill | 说明 | 行为模式 |
|-------|------|---------|
| `yorz-spec-collect` | 整理用户原始需求，补充关联信息（@提及的模块/文档） | 写 `## 需求` 段后退出 |
| `yorz-spec-analyze` | 分析现状：代码、文档、过往 spec | 写 `## 现状分析` 段后退出 |
| `yorz-spec-plan` | 生成技术方案；多方案/高风险/信息缺失时召唤决策 | 写 `## 技术方案` + `<!-- yorz:await -->` 决策标记后退出 |
| `yorz-spec-tasks` | 拆解任务清单（md todo 格式） + 测试用例 | 写 `## 任务清单`（`- [ ] xxx`）后退出 |
| `yorz-spec-execute` | 按任务执行，每完成一项更新 todo + 追加执行记录 | 完成一项 → 更新 md → 退出（Service 检测到未完成则续拉，或一次跑完） |
| `yorz-spec-review` | 生成 Review 概要（关键 diff、模块影响、卡片化总结） | 写 `## Review` 段后退出 |

**Skill 通用结构**（伪 md）：

```markdown
---
name: yorz-spec-plan
description: …
---

1. 读取 `.yorz/specs/<spec-id>/spec.md`
2. 根据现状分析生成 1~N 个技术方案
3. 若存在分歧/高风险，追加：
   ```
   ## ⏸ 待用户决策: <主题>
   - **A**: …  优点/缺点/风险
   - **B**: …  优点/缺点/风险
   - **推荐**: A，理由 …
   <!-- yorz:await kind="decision" id="<unique-id>" -->
   ```
4. 调用 `yorz.handoff_url` 拿到链接并 print 给用户
5. 退出
```

**Skill md 格式**遵循各 Agent 现行约定（Claude Code 的 `SKILL.md` / OpenCode 的等价物），通用部分由 YorZ 维护 master 模板，安装时按目标 Agent 微调。

### 4.4 GUI

**技术栈**：Solid.js + Vite + TypeScript；产物由 Service 静态托管。

**路由**：

```
/                          首页 / 项目仪表盘
/specs                     需求列表
/specs/new                 新建需求（支持 @、上传图片）
/specs/:id                 需求详情（含工作流时间线、SSE 实时更新）
/specs/:id?focus=decision-<id>   决策聚焦视图（模式 B Agent print 的 URL）
/specs/:id?focus=review          Review 聚焦视图
/settings                  Agent 路径、端口等
```

**状态管理**：Solid Store + 一个 SSE 订阅器（按 spec id 订阅）。

**图形组件分层**：

```
┌───────────────────────────────────────────────────┐
│  Layer 1：场景特化（优先复用现成组件）              │
│  - 代码依赖图、code graph：集成成熟组件            │
│    （如 madge / dependency-cruiser 可视化）        │
├───────────────────────────────────────────────────┤
│  Layer 2：通用图形（降级方案）                     │
│  - 模块/依赖/数据流：xyflow（React）               │
│    → 包装成 WebComponent 注入 Solid                │
│  - 函数逻辑/时序：Mermaid                          │
├───────────────────────────────────────────────────┤
│  Layer 3：信息组件（非图形场景）                   │
│  - 信息卡片（重点高亮、展开折叠、关联跳转）        │
│  - 思维导图（高密度抽象信息）                      │
│  - 纯文本线框图（MVP 优先）                        │
└───────────────────────────────────────────────────┘
```

PC/移动端同等支持：所有交互组件以触屏可用为底线，PC 增加快捷键与悬浮态。

WebComponent 桥接说明：xyflow 是 React 实现，可在 Custom Element 内部用 `react-dom` 渲染，对外暴露 props/events 给 Solid 调用。MVP 阶段不引入，留接口。

---

## 5. 数据模型

**核心原则**：前期不规范化。**优先用标准 md 表达一切**，AI 与人都友好。即使没有 GUI 渲染，AI 输出的原始 md 也应是人类可读的工作文档。

### 5.1 目录结构

```
<project>/.yorz/
├── specs/
│   ├── 260611-xxxxx/
│   │   └── spec.md            # MVP 单文件：需求/分析/方案/决策/任务/执行/Review 全在此
│   │                           # 高阶版本可拆分为多文件，结构由 frontmatter 描述
│   └── ...
└── config.json                  # 项目级配置（Agent 选择、skill 版本）

~/.yorz/
├── db.sqlite                    # 跨项目索引、用户偏好、运行时元数据
├── runtime.json                 # 当前运行的 Service 信息（pid / port / project）
└── config.json                  # 用户全局配置
```

`.yorz/` **默认不**进入 `.gitignore`，由用户根据团队习惯决定是否提交。

### 5.2 spec.md 结构示例

```markdown
---
id: 260611-abc123
title: 需求标题
status: planning            # draft | analyzing | planning | awaiting_input | executing | reviewing | done
createdAt: 2026-06-11T10:00:00Z
updatedAt: 2026-06-11T10:30:00Z
---

## 用户需求
（原始输入，保护原意）

## 整理后需求
…
关联：@src/auth/login.ts、@docs/Prod-Design.md

## 现状分析
…

## 技术方案
…

## ⏸ 待用户决策: 数据库选型
- **A. PostgreSQL** — 优点 … 缺点 … 风险 …
- **B. SQLite**     — 优点 … 缺点 … 风险 …
- **推荐**: B，理由 …

关联信息：
- 见 `@docs/Prod-Design.md` 第 4 节
- 现有依赖：`@package.json`

<!-- yorz:await kind="decision" id="d1" -->

## 任务清单
- [ ] 初始化数据库 schema
- [ ] 实现 auth 模块
- [ ] 写集成测试

## 执行记录
- 2026-06-11 10:25  完成 schema 初始化（commit abc1234）
- 2026-06-11 10:28  auth 模块完成，3 个测试通过

## Review
…
```

### 5.3 内嵌标记约定

只引入最少的"机器可识别"标记：

| 标记 | 用途 |
|------|------|
| `<!-- yorz:await kind="decision\|review" id="<id>" -->` | Agent 退出前留下"等待用户输入"指针 |
| `<!-- yorz:done id="<id>" at="<iso>" -->` | Service 合并用户输入后写入，表示已消化 |
| frontmatter `status` 字段 | 全局阶段，便于列表过滤 |

其余信息（决策候选、任务、执行记录）均为普通 md 段落 / md todo / md 列表，不引入 JSON schema 约束。

### 5.4 关于 SQLite

`~/.yorz/db.sqlite` 仅存放**派生数据**（可随时从 md 重建）：

- 跨项目 spec 索引（title / status / updatedAt）
- 用户偏好（默认 Agent、端口、主题）
- 运行时元数据（最近一次 Agent stdout 位置等）

不存放任何 md 已记录的内容，确保 md 始终是真相。

---

## 6. 关键技术决策与取舍

| 决策点 | 选择 | 取舍理由 |
|--------|------|---------|
| Agent ↔ Service 通信 | **md 文件 + 无状态接力**（参考 HTTP）；MCP 仅作为可选优化通道 | 强容错、强可审计、强 Agent 解耦；无需处理长连接 / 阻塞 / 超时 |
| 数据形态 | md 为主，前期不规范化 | 人类可读、AI 友好、git 友好；过早规范化阻碍迭代 |
| 进程模型 | Service 单例 + Agent 子进程按 spec 持续推进、遇阻即退（待用户确认/决策/Review 时退出，由 CLI 续拉） | 多 spec 可并行；Agent 进程死掉不影响 Service；阻塞点天然落在 md 上，可审计可恢复 |
| Agent 抽象 | Adapter 模式（claude/opencode） | MVP 仅 2 个目标，接口收敛在 `Adapter` interface |
| 持久化分层 | 项目级 md + 全局 SQLite（仅索引） | md 真相、SQLite 加速；可随时丢弃 SQLite 重建 |
| GUI 框架 | Solid.js + Vite | 用户指定；细粒度响应、包体小、利于移动端 |
| 图形组件 | 优先复用现成 → 降级 xyflow/Mermaid → 信息卡片/思维导图 | 控制 MVP 复杂度 |
| 部署 | 本地 localhost；架构层预留 tunnel | 简化 MVP；公网穿透不影响内核协议 |
| 多 spec 并行 | 允许 | Service 维护 `Map<specId, ChildProcess>` |
| `.yorz/` git 策略 | 默认不 ignore，由用户决定 | 团队可共享 spec 历史 |
| Skill 升级 | `yorz install` 重复执行直接覆盖 | 简单、可预期 |

---

## 7. MVP 范围划分

### v0.1（必须）

- [ ] CLI：`init` / `install` / `serve` / `status` / `stop` / `resume`
- [ ] Service：HTTP + SSE + FS Watcher + Input Merger + Agent Relauncher
- [ ] Skills（Claude Code 版）：6 个 yorz-spec-* skill
- [ ] GUI：需求编辑、需求详情时间线、决策审阅（信息卡片）、执行记录、Review
- [ ] 模式 A 与模式 B 入口均可工作
- [ ] 持久化：单 md 文件方案 + `~/.yorz/db.sqlite` 索引
- [ ] 多 spec 并行

### v0.2

- [ ] OpenCode 适配
- [ ] 模式 B 短链与会话 token 鲁棒性
- [ ] Mermaid 集成（流程图、时序图）
- [ ] Review 页：diff stats + AI 一键 Review
- [ ] md 拆分为多文件的进阶版本（可选）

### v0.3+

- [ ] xyflow 通过 WebComponent 集成（模块依赖图）
- [ ] 移动端深度交互（手势缩放、渐进披露）
- [ ] 公网穿透模板 + token 认证
- [ ] 思维导图组件
- [ ] 第三 Agent 接入（Cursor / Gemini CLI 等）

---

## 8. 风险与未决问题

| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent 续跑时 prompt 不足以恢复上下文 | 续跑结果偏离预期 | Skill 编写规范明确"读 md → 派生 stage → 执行对应阶段"；md 结构约定清晰 |
| OpenCode 的 skill / spawn 机制未验证 | v0.2 适配工作量未知 | v0.1 完成后立即做 spike |
| FS Watcher 在某些 FS（如网络盘）触发不可靠 | SSE 推送延迟 | `yorz.notify_updated` 工具作为兜底；GUI 端可手动刷新 |
| 同一 spec 被两个 Agent 并发改写（终端 + GUI 自动续跑同时跑） | md 损坏 | Service 用 `Map<specId, ChildProcess>` 保证单 spec 单 Agent；GUI 显示"被占用"状态 |
| md 越来越长，单文件不堪重负 | 加载/渲染卡顿 | v0.2 起支持拆分为多文件（frontmatter 索引） |
| 不同 Agent 对同一 skill 语义解释不一致 | OpenCode 表现偏离 | Skill 写"声明式步骤 + 文件路径 + 标记约定"，避免依赖 Agent 隐式行为 |
| WebComponent 包 React 在 Solid 内事件/状态传递 | xyflow 集成可能卡壳 | MVP 不依赖；v0.3 前做 spike |

### 已确认的设计决策（原"未决问题"已结论）

- **多 spec 并行**：允许
- **`.yorz/` git 策略**：默认不 ignore，用户决定
- **Service 守护**：不采用阻塞模式，无需复杂"空闲超时"策略；Service 单纯等待 GUI 与 FS 事件
- **Skill 升级**：`yorz install` 直接覆盖

---

## 9. 后续动作

1. 你 Review 此架构文档，给出批注或修改意见。
2. 确认后，将 v0.1 清单拆解到 `docs/MVP.md` 推进实现。
3. 在落地 v0.1 前，先做一次 **"Agent 写 await 标记 → 退出 → Service 监听 → 用户输入 → 续拉 Agent"** 端到端 spike，验证核心通信链路可行（Claude Code 优先）。

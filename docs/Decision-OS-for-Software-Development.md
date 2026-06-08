# Decision OS for Software Development

## 背景

当前 Agent（Claude Code、OpenCode、Codex CLI、Cursor Agent 等）已经具备较强的软件实施能力。

典型工作流：

```text
Spec
 ↓
分析
 ↓
技术方案
 ↓
任务拆解
 ↓
实施
```

用户的主要工作已经从“编写代码”转变为“审核和决策”。

但随着项目复杂度提升，出现了新的瓶颈：

- Agent 生成大量文档
- 决策依赖复杂上下文
- 陌生模块难以快速建立心智模型
- 用户需要频繁阅读 Spec、设计文档和代码
- 决策成本远高于编码成本

核心问题已经不再是代码生成，而是：

> 如何帮助人类快速获得做出正确决策所需的最小上下文。

---

# 核心洞察

传统观点：

```text
编程 = 写代码
```

新的观点：

```text
编程 = 选择题
程序 = 决策路径的累积
Software = Accumulated Decisions
```

代码只是决策的最终投影。

真正需要管理的是：

```text
需求
↓
决策
↓
知识
↓
实现
```

而不是：

```text
文件
↓
代码
```

---

# 当前 Agent IDE 的问题

现有工具本质上仍然属于：

```text
File IDE
```

例如：

- Cursor
- Claude Code
- OpenCode
- VS Code
- GitHub Copilot

其核心对象是：

```text
File
```

而不是：

```text
Decision
```

因此：

- 擅长修改代码
- 不擅长管理项目知识
- 不擅长帮助人类决策
- 无法建立长期知识图谱

---

# 产品定位

## Decision Operating System for Software Development

不是 AI IDE。

而是：

> 软件开发决策操作系统

目标：

帮助人类持续做出正确决策。

---

# 产品目标

## 1. 构建项目 Knowledge Graph

建立项目长期知识库。

Agent 不再只读取代码。

而是查询知识图谱。

### 节点类型

```text
Requirement

Decision

ADR

Domain

Module

Service

API

Database

Test

File

PR
```

### 示例

```text
支持游客登录
    ↓

采用临时 Session
    ↓

ADR-32
    ↓

Auth
    ↓

session.ts
```

---

## 2. 内置 Agent Skill

规范 Agent 工作流。

Agent 不允许直接实施。

必须遵循：

```text
Spec
 ↓

Graph Update
 ↓

Decision Extraction
 ↓

Decision Review
 ↓

Implementation
 ↓

Validation
 ↓

Graph Update
```

### 强制决策机制

当 Agent 遇到：

```text
存在多个合理方案
存在业务影响
存在长期影响
```

必须停止实施。

生成：

```text
Decision Card
```

等待用户确认。

---

# Decision Card

替代传统方案文档。

示例：

```text
采用 Redis Session

推荐：是

信心：87%

原因：
高并发场景更稳定

影响：

Auth ████████

Mobile ██

Web ██

风险：低

需要知道：

1. Redis 已存在

2. 移动端依赖 Session

3. 用户增长预期较高

备选方案：

PostgreSQL
Memory

淘汰原因：...
```

目标：

让用户阅读决策，而不是阅读文档。

---

# GUI 设计

核心原则：

不要展示文件树。

展示知识和决策。

---

## 1. Decision Inbox

类似邮件收件箱。

```text
P0

是否兼容旧 Session

风险：高

推荐：兼容
```

帮助用户优先处理关键决策。

---

## 2. Architecture Explorer

不是浏览文件。

而是浏览系统。

```text
Auth

├─ Login

├─ Session

├─ OAuth

└─ Refresh
```

点击 Session：

```text
Session

依赖：Redis

调用：Login

影响：Mobile
      Web
```

帮助用户快速建立系统心智模型。

---

## 3. Context Lens

自动提取最小必要上下文。

例如：

决策：

```text
是否兼容旧 Session
```

系统输出：

```text
你需要知道：

★★★★★

旧客户端占 15%

★★★★★

Session 格式将变化

★★★★☆

无法自动迁移

★☆☆☆☆

Redis 集群实现
（无需了解）
```

目标：

帮助用户聚焦真正重要的信息。

---

## 4. Architecture Zoom

类似 Google Maps。

逐层放大：

```text
System
 ↓
Domain
 ↓
Module
 ↓
Service
 ↓
Function
```

支持渐进式探索复杂系统。

---

# 核心理念

## Context Slice

用户不应该阅读完整文档。

而应该获得：

```text
为了做出这个决策，
你必须知道什么。
```

而不是：

```text
整个系统是如何实现的。
```

---

## Dependency Blast Radius

自动分析影响范围。

例如：

```text
修改 Session

影响：

Auth ██████████

Refresh ████████

User ████
```

帮助用户快速评估风险。

---

## Decision Replay

展示 Agent 的决策过程。

```text
考虑方案：

Redis

PostgreSQL

Memory

淘汰原因：

PostgreSQL
→ 高并发性能不足

Memory
→ 无法跨实例

最终选择：

Redis
```

让用户看到推理，而不是结论。

---

# 系统架构

```text
┌─────────────────┐
│ GUI             │
└──────┬──────────┘

┌──────▼──────────┐
│ Decision Layer  │
└──────┬──────────┘

┌──────▼──────────┐
│ Knowledge Graph │
└──────┬──────────┘

┌──────▼──────────┐
│ Agent Runtime   │
└─────────────────┘
```

---

# MVP

第一阶段不开发完整 IDE。

采用：

```text
OpenCode Plugin
+
Graph Engine
+
Web UI
```

即可。

## Graph

支持：

```text
Requirement

Decision

Module

File
```

## Agent Skill

自动生成：

```text
Decision Card
```

## UI

三个页面：

```text
Decision Inbox

Architecture Explorer

Context Lens
```

---

# 最终愿景

未来的软件开发流程：

```text
需求
 ↓

决策
 ↓

知识图谱
 ↓

Agent 实施
 ↓

验证
 ↓

知识图谱更新
```

开发者不再管理代码。

而是管理决策。

Agent 不再只是代码生成器。

而是知识图谱上的执行者。

最终实现：

> 编程 = 选择题
>
> 软件 = 决策路径的累积

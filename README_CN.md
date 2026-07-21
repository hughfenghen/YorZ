# YorZ

[English](./README.md) | [中文](./README_CN.md)

---

## 理念

YorZ 认为，一个产品不只是最终代码，而是「初始创意」和「每一次关键决策」共同累积的结果。

YorZ 通过 spec 文档、可视化界面和 Agent 工作流，把需求分析、方案决策、任务执行和变更 Review 串成一条可追踪的开发路径。

![preview](./docs/preview.png)

## 功能

- 用图形化界面管理 spec 驱动开发流程
- 将 Agent 生成的技术方案、任务和执行记录结构化展示，提升阅读与 Review 效率
- 在关键节点收集用户决策，让 Agent 执行但不替用户拍板
- 提供深度 debug 模式，用证据链定位 Agent 难以解决的疑难问题
- 适配 Claude Code、OpenCode、Codex 等主流 Coding Agent

## 安装

```bash
pnpm add -g @yorz/cli
```

```bash
npm install -g @yorz/cli
```

## 快速开始

### 第一步 — 启动服务

```bash
yorz serve
```

启动 YorZ Service，服务默认在后台运行。在浏览器打开 `http://localhost:7423` 即可访问仪表盘。

启动时，`yorz serve` 会自动检测 `yorz-spec` skill：当缺失或非最新时，为所有支持的 Agent（Claude Code / OpenCode / Codex）自动安装或更新，并在服务启动前输出日志。

停止后台服务：

```bash
yorz serve stop
```

### 第二步 — 添加项目

```bash
yorz add /path/to/your/project
```

将目录初始化为 YorZ 项目（创建 `.yorz/` 配置），注册到 Service，并将 `.yorz/tmp` 加入 `.gitignore`。

`yorz-spec` skill 教会你的 AI Agent 如何按 plan / tasks / execute / done 阶段驱动 spec 文档；它由 `yorz serve` 自动安装并保持最新（见第一步），无需手动安装。

## 命令参考

| 命令              | 说明                                          |
| ----------------- | --------------------------------------------- |
| `yorz serve`      | 后台启动或复用 YorZ Service，支持多项目管理。 |
| `yorz serve stop` | 停止后台 YorZ Service。                       |
| `yorz add <path>` | 初始化并注册一个目录为 YorZ 项目。            |

### 全局选项

| 选项            | 说明                     |
| --------------- | ------------------------ |
| `-V, --version` | 输出 YorZ 版本号。       |
| `-h, --help`    | 显示任意命令的帮助信息。 |

## 开发

```bash
# 安装依赖
pnpm install

# 构建 CLI + GUI
pnpm build

# 开发模式（监听 + 启动服务）
pnpm dev

# 运行测试
pnpm test
```

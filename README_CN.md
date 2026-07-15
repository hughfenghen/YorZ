# YorZ

[English](./README.md) | [中文](./README_CN.md)

---

## 核心理念

// ...

## 功能特色

// ...

## 安装

### 全局安装

```bash
npm install -g @yorz/cli
```

### 一次性使用

```bash
npx -p @yorz/cli yorz <command>
```

## 快速开始

### 第一步 — 启动服务

```bash
yorz serve
```

启动 YorZ Service（HTTP + SSE + 静态 GUI），默认在后台运行。在浏览器打开 `http://localhost:7423` 即可访问仪表盘。

启动时，`yorz serve` 会自动检测 `yorz-spec` skill：当缺失或非最新时，为所有支持的 Agent（Claude Code / OpenCode / Codex）自动安装或更新，并在服务启动前输出日志。

可选参数：

```bash
yorz serve --port 8080    # 自定义端口
yorz serve --open          # 自动打开浏览器
yorz serve --foreground    # 前台运行
yorz serve stop            # 停止后台服务
```

### 第二步 — 添加项目

```bash
yorz add /path/to/your/project
```

将目录初始化为 YorZ 项目（创建 `.yorz/` 配置），注册到 Service，并将 `.yorz/tmp` 加入 `.gitignore`。

`yorz-spec` skill 教会你的 AI Agent 如何按 plan / tasks / execute / done 阶段驱动 spec 文档；它由 `yorz serve` 自动安装并保持最新（见第一步），无需手动安装。

### 第三步 — 用 Agent 开始工作

在项目中创建 spec：

```
.yorz/specs/260707.feat.my-feature/spec.md
```

然后让你的 Agent（Claude Code / OpenCode）处理它。Skill 会接管后续流程 — GUI 会随 Agent 推进实时更新。

## 命令参考

| 命令                    | 说明                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `yorz serve`            | 后台启动或复用 YorZ Service，支持多项目管理。                |
| `yorz serve stop`        | 停止后台 YorZ Service。                                      |
| `yorz add <path>`       | 初始化并注册一个目录为 YorZ 项目。                           |
| `yorz uninstall skills` | 从 Agent 卸载 skill。                                        |
| `yorz lint [paths...]`  | 检查 `spec.md` / `review.md` 结构规范。                      |
| `yorz lint --all`       | 检查项目 specs 目录下所有 spec。                             |

### 全局选项

| 选项            | 说明                     |
| --------------- | ------------------------ |
| `-V, --version` | 输出 YorZ 版本号。       |
| `-h, --help`    | 显示任意命令的帮助信息。 |

## 文档

- [愿景](./docs/Vision.md) — Decision OS 愿景与核心理念。
- [产品设计](./docs/Prod-Design.md) — 产品设计文档。
- [技术架构](./docs/Architecture.md) — 技术架构设计文档。
- [软件开发决策操作系统](./docs/Decision-OS-for-Software-Development.md) — 概念深入分析。

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

## 开源协议

[GNU Lesser General Public License v3.0 or later](./LICENSE) (LGPL-3.0-or-later)

[![License: LGPL-3.0-or-later](https://img.shields.io/badge/License-LGPL--3.0--or--later-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0.txt)

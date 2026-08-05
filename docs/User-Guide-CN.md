# YorZ 使用指南（中文）

本文面向第一次接入 YorZ 的使用者，说明如何安装、启停服务、理解配置目录，并介绍 GUI 中的核心工作流。

- [1. 安装](#1-安装)
- [2. 启动服务](#2-启动服务)
- [3. 停止服务](#3-停止服务)
- [4. 查看服务日志](#4-查看服务日志)
- [5. 添加项目](#5-添加项目)
- [6. 配置目录说明](#6-配置目录说明)
  - [6.1 项目级 `.yorz/`](#61-项目级-yorz)
  - [6.2 全局配置目录](#62-全局配置目录)
- [7. GUI 功能介绍](#7-gui-功能介绍)
  - [7.1 全局配置](#71-全局配置)
  - [7.2 项目配置 Agent 方法](#72-项目配置-agent-方法)
  - [7.3 新建 spec](#73-新建-spec)
  - [7.4 新开项目并行](#74-新开项目并行)
  - [7.5 追加任务](#75-追加任务)
  - [7.6 Debug 模式](#76-debug-模式)
  - [7.7 内容批注](#77-内容批注)
  - [7.8 plan 决策待确认项](#78-plan-决策待确认项)
  - [7.9 Review 功能](#79-review-功能)
- [8. 常见工作流](#8-常见工作流)
  - [8.1 首次接入项目](#81-首次接入项目)
  - [8.2 处理一个新需求](#82-处理一个新需求)
  - [8.3 并行处理多个需求](#83-并行处理多个需求)
  - [8.4 追加缺陷并进入 Debug](#84-追加缺陷并进入-debug)
- [9. 交流群](#9-交流群)

## 1. 安装

使用 pnpm 安装：

```bash
pnpm add -g @yorz/cli
```

或使用 npm 安装：

```bash
npm install -g @yorz/cli
```

安装后可以运行以下命令确认 CLI 可用：

```bash
yorz --help
```

## 2. 启动服务

在任意目录运行：

```bash
yorz serve
```

`yorz serve` 会启动 YorZ Service，默认在后台运行。服务启动后，在浏览器打开：

```text
http://localhost:7423
```

启动时 YorZ 会检查内置 skills（`yorz-spec` / `yorz-debug`）。如果缺失或不是最新版本，会安装或更新到共享目录 `~/.config/yorz/skills/`，所有 YorZ 项目复用同一份。YorZ 不再向各 Agent 自身的 skills 目录写入，因此这些 skill 不会出现在非 YorZ 会话中——YorZ 改为在 prompt 中传入 `SKILL.md` 的绝对路径，由 Agent 按需读取。旧版本写入 `~/.claude/skills/`、`~/.config/opencode/skills/`、`~/.codex/skills/` 的残留会自动清理（也可手动执行 `yorz uninstall skills --legacy`）。

开发或排查服务问题时，也可以让服务留在前台：

```bash
yorz serve --foreground
```

如默认端口被占用，可以指定端口：

```bash
yorz serve --port 7424
```

## 3. 停止服务

停止后台运行的 YorZ Service：

```bash
yorz serve stop
```

如果没有后台服务在运行，命令会直接提示当前未运行；如果存在过期运行时记录，YorZ 会清理对应记录。

## 4. 查看服务日志

`yorz serve` 默认在后台长期运行，服务日志会写入全局配置目录下的 `logs/`：

```text
~/.config/yorz/logs/
```

日志目录跟随全局配置目录的解析规则：设置了 `XDG_CONFIG_HOME` 时为 `$XDG_CONFIG_HOME/yorz/logs/`；设置了 `YORZ_HOME` 时优先取 `$YORZ_HOME/logs/`。

目录下有两个文件，分工不同：

| 文件              | 内容                                                                                 | 体积控制                              |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `serve.log`       | **主日志**：服务启停、HTTP 路由错误与慢请求、Agent 派发与失败、文件监听、worktree 操作、进程崩溃堆栈 | 单文件上限 5MB，滚动保留 1 份归档     |
| `serve-stdio.log` | 后台子进程 stdout/stderr 的兜底记录（第三方库直接打印、Node 致命错误）                | 每次启动覆盖重写，不会持续增长        |

`serve.log` 写满 5MB 后会被重命名为 `serve.log.1`（覆盖上一份归档），随后新建空的 `serve.log` 继续写入。因此日志目录最多占用约 10MB，不会无限增长。

每行日志格式固定，便于 `grep` 过滤：

```text
[2026-07-28T12:00:00.000Z] [error] [http] route error {"method":"GET","path":"/api/projects","status":500}
```

依次是 ISO 时间戳、日志级别（`debug` / `info` / `warn` / `error`）、来源模块、消息与结构化附加信息。

实时查看：

```bash
tail -f ~/.config/yorz/logs/serve.log
```

排查问题时可以调高日志粒度，重启服务后生效：

```bash
YORZ_LOG_LEVEL=debug yorz serve
```

`YORZ_LOG_LEVEL` 支持 `debug` / `info` / `warn` / `error`，默认为 `info`。`debug` 会额外记录每个 HTTP 请求和 spec 文件变更事件。

> 反馈问题时，请优先附带 `serve.log`；如果服务是启动即退出、或完全没有生成 `serve.log`，再补上 `serve-stdio.log`。日志中只记录 sessionId、prompt 长度、耗时等元信息，不会写入 prompt 正文或 Agent 输出内容。

## 5. 添加项目

首次使用 GUI 前，需要把项目目录注册到 YorZ：

```bash
yorz add /path/to/your/project
```

`yorz add` 会完成这些动作：

- 检查目标目录是否是 git 仓库；非交互场景可用 `--yes` 允许 YorZ 自动执行 `git init`。
- 创建项目级 `.yorz/` 配置。
- 将项目注册到 YorZ Service 的全局项目列表。
- 将 `.yorz/tmp` 加入 `.gitignore`，避免临时运行数据进入版本控制。

添加后刷新 GUI，左侧项目列表会显示该项目。

## 6. 配置目录说明

YorZ 主要使用项目级目录保存 spec 文档，使用全局目录保存项目列表和服务运行状态。

### 6.1 项目级 `.yorz/`

项目根目录下的 `.yorz/` 是当前项目的 YorZ 工作目录。

常见内容：

- `.yorz/config.json`：项目配置，包含项目 Agent 覆盖方式和 spec 文档目录。默认 Agent 可继承全局配置。
- `.yorz/specs/`：默认 spec 文档目录。每个 spec 通常位于 `.yorz/specs/<spec-id>/spec.md`。
- `.yorz/specs/<spec-id>/debug.md`：Debug 模式记录文件，仅在对应 spec 进入 Debug 流程后出现。
- `.yorz/tmp/`：运行时临时目录，通常不应提交到 git。

如果在 GUI 的“项目配置”里修改 spec 文档目录，新的 spec 会写入新目录；旧 spec 仍留在原目录，需要按提示自行迁移。

### 6.2 全局配置目录

YorZ 的全局配置目录默认位于：

```text
~/.config/yorz
```

如果设置了 `XDG_CONFIG_HOME`，则使用：

```text
$XDG_CONFIG_HOME/yorz
```

如果设置了 `YORZ_HOME`，则优先使用 `YORZ_HOME` 指向的目录。

常见全局文件：

- `projects.json`：已添加项目列表、全局默认 Agent、会话结束提示配置。
- `runtime.json`：后台 Service 的运行记录。
- `logs/`：服务日志目录，包含 `serve.log`（滚动主日志）与 `serve-stdio.log`，详见 [4. 查看服务日志](#4-查看服务日志)。

通常不需要手工编辑全局配置目录；优先通过 `yorz add`、GUI 项目列表、GUI 全局配置和 `yorz serve stop` 管理。

## 7. GUI 功能介绍

### 7.1 全局配置

GUI header 最右侧有三横配置入口。点击后可以切换语言，也可以打开“全局配置”弹窗。

全局配置包含：

- `默认 Agent`：选择 ClaudeCode、OpenCode 或 Codex。未设置项目级覆盖的项目会继承这个默认值，初始值为 ClaudeCode。
- `会话结束提示`：可分别开启“横幅提示”和“声音提示”。两个开关默认关闭，开启后由 YorZ Service 在 Agent 轮次结束时以 best-effort 方式调用系统通知或声音能力；如果当前系统不支持，对会话结束流程没有影响。

### 7.2 项目配置 Agent 方法

在 GUI 左侧项目列表中，点击项目旁的配置入口，打开“项目配置”。

可以配置：

- `Agent`：默认选择“继承全局默认”，也可以显式选择 ClaudeCode、OpenCode、Codex 或自定义命令。
- `命令 (cmd)` 与 `参数 (args，空格分隔)`：仅在选择“自定义”时填写。
- `spec 文档目录`：相对项目根路径，默认是 `.yorz/specs`。

保存后，该项目后续新建 spec、续跑 spec、追加任务和 Review 会使用解析后的 Agent：项目选择“继承全局默认”时使用全局默认 Agent，项目选择具体 Agent 或自定义命令时优先使用项目配置。

### 7.3 新建 spec

在项目首页点击“新建 spec”，进入新建页面。

新建时需要填写：

- `类型`：`feat` 表示新功能，`refct` 表示重构或抽取，`fix` 表示缺陷修复。
- `需求内容`：输入原始诉求、痛点、期望效果、关联模块或文档。
- `附件`：可导入附件，图片支持 Cmd/Ctrl-V 粘贴。

点击“发送”后，Agent 会按 `yorz-spec` skill 创建 spec 文档，并自动进入 plan 阶段。文档落地后，GUI 会跳转到 spec 详情页。

### 7.4 新开项目并行

新建 spec 时可以勾选“新开项目并行”。

该模式会为新 spec 创建独立 git worktree，让本次开发在新分支和新工作目录中进行，避免影响主项目当前工作区。

适合这些场景：

- 当前主项目已有未完成改动，不希望混在一起。
- 需要同时推进多个 spec。
- 希望完成后再从列表页合入主项目。

并行项目完成后，可在列表页使用“合入主项目”将 worktree 改动合回主项目。

### 7.5 追加任务

在 spec 详情页点击“追加任务”，可以给已有 spec 增加新的需求、重构或缺陷修复。

追加任务支持三种类型：

- `feat 新增/扩展需求`
- `refct 重构/重写/抽取`
- `fix 修复缺陷`

提交后，YorZ 会把追加内容写入 spec，并自动重开 plan 阶段。Agent 会重新分析新增内容，再继续拆任务和执行。

如果你在正文中选中一段内容后发起追加任务，追加记录会带上引用章节和引用文本，便于 Agent 理解上下文。

### 7.6 Debug 模式

追加 `fix` 类型任务时，可以勾选“debug 模式”。

Debug 模式会让 Agent 使用更严格的调试流程，围绕“假设 → 取证 → 验证”推进，并把过程记录到当前 spec 目录下的 `debug.md`。

适合这些场景：

- 问题复现条件复杂。
- 普通修复多次失败。
- 需要保留排查证据链。

当当前 spec 存在 `debug.md` 时，详情页会显示 “Debug” 入口，可进入 Debug 页面查看记录。

### 7.7 内容批注

在 spec 详情页选中文档中的一段内容后，会出现操作菜单。

可用操作：

- `批注`：对选中内容写下意见或补充信息。
- `解释`：让 Agent 解释选中内容。

批注会写回 spec 文档，并触发 Agent 重新处理。适合纠正方案理解、补充约束或指出某段任务描述不准确。

### 7.8 plan 决策待确认项

Agent 在 plan 阶段会补齐“现状分析”“技术实现方案”和“待确认项”。

当方案中存在必须由用户判断的信息时，Agent 会在“待确认项”中留下问题，GUI 会在 spec 详情页左侧显示待确认面板。

常见待确认项类型：

- 选择型：多个方案都可行，需要用户选择。
- 确认型：Agent 有推荐方案，但影响较大，需要用户确认或否决。
- 自由文本：需要用户补充开放信息。

你可以在待确认面板中一次性填写并发送。发送后，Agent 会读取答复、更新方案，并继续 tasks 或 execute 阶段。

### 7.9 Review 功能

在 spec 详情页点击 “Review” 进入 Review 页面。

Review 页面用于查看和处理当前 spec 相关改动。

主要功能：

- `手动选择`：手动选择要处理的文件。
- `Agent 智能判定`：让 Agent 判断本次 spec 相关的变更范围。
- `提交`：提交选中的变更。
- `暂存`：暂存选中的变更。
- `丢弃`：丢弃选中的变更。该操作不可撤销，执行前会二次确认。

建议在 spec 完成并验证后进入 Review 页面，根据当前变更决定提交、暂存或丢弃。

## 8. 常见工作流

### 8.1 首次接入项目

```bash
npm install -g @yorz/cli
yorz serve
yorz add /path/to/your/project
```

然后打开 `http://localhost:7423`，在左侧选择项目。

### 8.2 处理一个新需求

1. 在项目首页点击“新建 spec”。
2. 选择 `feat`，填写需求内容。
3. 点击“发送”，等待 Agent 创建 spec 并进入 plan。
4. 如有待确认项，在面板中答复并发送。
5. Agent 继续拆任务和执行。
6. 完成后进入 “Review” 页面处理变更。

### 8.3 并行处理多个需求

1. 新建 spec 时勾选“新开项目并行”。
2. 在新 worktree 项目中让 Agent 推进任务。
3. 主项目可以继续处理其它工作。
4. 完成后在列表页使用“合入主项目”。

### 8.4 追加缺陷并进入 Debug

1. 在 spec 详情页点击“追加任务”。
2. 选择 `fix 修复缺陷`。
3. 勾选“debug 模式”。
4. 填写缺陷复现、现象、期望结果。
5. 点击“发送”，等待 Agent 进入 Debug 流程。
6. 在 “Debug” 页面查看 `debug.md` 记录。

## 9. 交流群

_欢迎加入交流群：QQ 群 `224778869`_

<img src="./qq-group.png" width="200px"> <img src="./wechat-group.png" width="200px">

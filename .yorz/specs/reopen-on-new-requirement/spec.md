---
stage: plan
last_action: 变更重开流程 — 识别到新增需求：HELLO.md 同步生成
updated_at: 2026-06-21
summary: 新增 HELLO.txt 占位文件；后续新增需求：同步生成 HELLO.md，与 HELLO.txt 内容保持一致。
---

# HELLO 占位

## 1. 背景

希望仓库根有占位文件，便于演示。

## 2. 需求

- 在仓库根创建 `HELLO.txt`，内容 `hello world\n`
- 新增需求：同步生成 `HELLO.md`，标题为 `# HELLO`，正文与 `HELLO.txt` 保持一致；后续两个文件必须同步维护

## 3. 现状分析

- `HELLO.txt` 已存在于仓库根，内容为 `hello world\n`（12 字节），既有任务已完成。
- `HELLO.md` 尚不存在，需新建。
- 新增需求仅涉及 `HELLO.md` 的创建以及两文件同步维护策略，不影响已有的 `HELLO.txt` 结论。

## 4. 技术实现方案

- 在仓库根新建 `HELLO.md`，结构为：标题行 `# HELLO` + 空行 + 正文内容（取自 `HELLO.txt` 的 body，即 `hello world`）。
- 同步维护策略：后续修改 `HELLO.txt` 正文时，必须同时更新 `HELLO.md` 正文部分；标题行 `# HELLO` 固定不变。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在仓库根新建 `HELLO.txt`，内容 `hello world\n`，验收点：文件存在且内容字节数 = 12。

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-06-20 创建 `HELLO.txt`，内容 `hello world\n`。

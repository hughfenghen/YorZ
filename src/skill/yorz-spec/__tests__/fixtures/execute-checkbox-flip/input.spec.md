---
stage: execute
last_action: 任务已就绪，等待执行
updated_at: 2026-06-20
summary: 在仓库根新增 HELLO.txt 占位文件，内容为 hello world。
---

# HELLO 占位

## 1. 背景

希望在仓库根有一个 HELLO.txt 占位文件，用于演示 execute 阶段的勾选行为。

## 2. 需求

- 在仓库根创建 `HELLO.txt`，内容固定为 `hello world\n`

## 3. 现状分析

仓库根目前没有 `HELLO.txt`，需新建。

## 4. 技术实现方案

- 直接写入 `HELLO.txt`，内容 `hello world\n`，无 BOM、无尾随空行。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [ ] 在仓库根新建 `HELLO.txt`，内容为 `hello world\n`，验收点：文件存在且内容字节数 = 12。

## 7. 追加任务

- 暂无

## 8. 执行记录

- 暂无

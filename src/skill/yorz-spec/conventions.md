# 输入约定 / frontmatter 规范 / Markdown 格式化

本文档定义本 skill 的输入解析规则、spec md frontmatter 规范、以及每次写回时必须保持的 Markdown 结构。其它阶段文档默认所有这些约束都已生效。

## 输入约定

- `spec_path`：**可选**，目标 spec 文档路径。
  - 显式给出时：典型位置 `docs/specs/*.md` 或 `.yorz/specs/<id>/spec.md`，直接更新该 spec。
  - 缺省时按以下顺序解析：
    1. **从 session 上下文恢复**：扫描当前会话历史中已出现/已读写过的 spec 文档路径（匹配 `.yorz/specs/<id>/spec.md` 或 `docs/specs/*.md`）；存在多个时，优先选取最近一次被读写的；若仍有歧义，向用户确认后再继续。
    2. **从当前 prompt 创建**：若上下文中没有任何 spec 文档，则把当前用户 prompt 视为新需求，按 [新建 spec 流程](./new-spec.md) 生成路径与骨架。
- `mode`：可选，`plan|tasks|execute|auto`，默认 `auto`。
- 批注前缀：`！！！`

## spec 文档 frontmatter 规范

每个 spec md 顶部必须有 YAML frontmatter 记录元信息：

```yaml
---
stage: plan # plan | tasks | execute
last_action: 简述上一次动作
updated_at: 2026-06-14 # YYYY-MM-DD
summary: 一句话概要，供列表/索引视图展示
---
```

- 字段顺序固定为 `stage` → `last_action` → `updated_at` → `summary`，每个字段独占一行，禁止嵌套。
- 键名使用英文，便于工具静态解析；字段值允许中文。
- `summary` **必填**，长度 ≤ 200 字符，不允许空字符串。
- 时间字段使用 `YYYY-MM-DD`，不引入时区与时间部分。
- 缺失任意字段时，先补齐再继续。
- skill **不解析**旧 `## 流程状态` 章节；遇到使用旧格式的 spec，按此规范一次性迁移并删除该章节。

## Markdown 格式化约定

为保证 spec 文档结构稳定、易被工具与人审阅：

- frontmatter 元信息按本节约束写入；字段顺序固定，禁止嵌套与额外字段（如需扩展请先更新本 skill）。
- 时间字段使用 `YYYY-MM-DD`（如 `updated_at: 2026-06-14`），不引入时区与时间部分。
- 每次写回 spec md 后，**应在仓库支持的条件下运行 Markdown formatter**（优先使用项目根的 `prettier`，例如 `npx prettier --write <spec_path>`）；若仓库未配置 prettier，则跳过并在执行记录中说明。
- formatter 必须保留 YAML frontmatter 不变。
- 任务清单仅使用单层 `- [ ]` / `- [x]`，避免缩进与嵌套以利 formatter 稳定。
- 二、三级标题必须带层级编号，便于外部（如 GUI 批注）按章节号定位原文：
  - 每次写回 spec 前，按 body 中 `## ` / `### ` 出现顺序重新编号。
  - 二级标题写作 `## N. 标题`（N 从 1 起，按 body 内出现顺序）。
  - 三级标题写作 `### N.M 标题`（M 在所属二级下从 1 起；遇到新的二级，M 复位）。
  - 已含编号的标题按当前位置重排，保证位置变动后编号自洽。
  - 编号与原标题文本之间使用单个空格分隔。
  - 该规则不影响 frontmatter 与一级标题（`# `）。

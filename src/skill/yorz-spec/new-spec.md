# 新建 spec 流程

当 `spec_path` 缺省且无法从 session 上下文恢复时执行以下流程，由 skill 自动生成路径与初始骨架。

## 步骤

1. **提炼摘要**：从用户首轮输入中提炼需求摘要，生成 `summary-name`：
   - 形式：kebab-case，仅允许字符集 `[a-z0-9-]`
   - 长度 ≤ 40 字符
   - 不以数字开头
   - **必须是对需求的语义化提炼**（用英文/数字描述意图），禁止把中文字符替换为 `-` 后简单拼接残留的零散英文词（例如 `spec-agent-spec-agent-cli-server-ag` 这种由"恰好出现在中文里的英文 token"拼成的串属于禁止形态）。
   - 当用户输入主要为中文且难以提炼出可读英文 slug 时，使用 `untitled-<NNN>` 形式占位（`NNN` 为三位自增编号），不要强行造词。
2. **判定 type**：从 `feat`（新功能）/ `refct`（重构/重写/抽取）/ `fix`（修复缺陷）中选择：
   - **若 prompt 中已显式给出 `类型：<type>` 字段，直接使用，不再询问。**
   - 分类明确时直接采用。
   - 不确定时**显式询问用户**；若需兜底则取 `feat`。
   - 注：本词汇表与「追加任务」（`## 追加任务` 章节中 `[feat|refct|fix]` 条目）共用，SKILL 内部对两处类型的识别逻辑保持一致。
3. **生成 id**：`YYMMDD.<type>.<summary-name>`
   - `YYMMDD` 取当前日期
   - 例：`260614.feat.spec-frontmatter`
4. **生成路径**：`<specsDir>/<id>/spec.md`（每个 spec 一个独立子目录，方便附件/截图/中间产物共置）。`specsDir` 默认 `.yorz/specs`，可由 `<ProjectRoot>/.yorz/config.json` 的 `specsDir` 字段覆盖。
5. **id 冲突处理**：若 `<specsDir>/<id>/spec.md` 已存在，将 `<id>` 追加 `-2`、`-3` …… 数字后缀，直至无冲突。
6. **初始化文档**：
   - 写入 frontmatter（`stage: plan`、`last_action: 新建 spec`、`updated_at: <YYMMDD 对应日期>`、`summary: <对需求的一句话概要，≤200 字符，禁止照搬整段需求原文>`）。
   - 补齐空章节：`## 背景` / `## 需求` / `## 现状分析` / `## 技术实现方案` / `## 待确认问题` / `## 任务清单` / `## 追加任务` / `## 执行记录`（顺序固定，章节齐全度见 [全局硬约束](./rewrite-rules.md)）。
   - 将用户原始需求原样写入 `## 背景`（或 `## 需求`），便于后续追溯。
7. **进入 plan 阶段**：随即按 [plan 规范](./plan.md) 继续工作，**不要因为「文档已创建」就退出本轮**。

## CLI 触发模式下的注意事项

当 CLI/Service 通过 prompt 同时给出 `类型：<type>` 与「需求：…」但未提供 `spec_path` 时，必须自动进入「新建 spec」流程，不要询问类型/路径；初始化后必须在同一轮继续推进 plan 阶段，直到遇到真正阻塞（如 `待确认问题` 需用户批注）才退出。

> skill 自身不写入 `.gitignore`；是否将 `.yorz/specs/` 纳入 git 跟踪由用户自行决定。

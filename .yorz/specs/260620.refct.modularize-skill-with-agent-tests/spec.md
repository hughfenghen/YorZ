---
stage: execute
last_action: 消费批注「继续执行任务 25-27」，开始跑真实 Agent 回归
updated_at: 2026-06-20
summary: 将单体 SKILL.md 按流程节点拆分为多个子文档以提升稳定性，新增 test:agent 脚本调用真实 Agent 校验各模块输出，并修复待确认问题候选项缺失 (推荐) 标记的问题。
---

# 重构 skill：模块化 + 真实 Agent 测试 + 待确认问题格式修复

## 1. 背景

来自用户的原始需求（保留原文以便追溯）：

> 重构项目的 skill，目标是：提升 skill 的稳定性和可测试性、评估不同 Agent 的执行效果；
> 建议按流程节点或模块拆分成多个 skill 文件 `@src/skill/SKILL.md`；
> Skill 模块化之后，需要为每一个子模块提供测试用例，新建 `test:agent` script 调用真实 Agent（非 mock）来测试输出结果是否符合预期；
> 当前 skill 待确认问题列表没有按规范格式生成，AI 输出未提供方案候选项和建议方案。

## 2. 需求

- **模块化**：把 `src/skill/SKILL.md`（当前 200 行单文件）按流程节点 / 关注点拆成多个文件，便于独立修改、降低单次 prompt 噪音、让"哪条规则失效"可追溯到具体模块。
- **可测性**：每个被拆出的子模块都要有可执行的测试用例；用例形态是"给 Agent 一个起点 spec → 真实 Agent 跑完 → 断言输出 spec 满足该模块的硬约束"。
- **可评估**：新增 `pnpm test:agent` 脚本，允许切换 Agent（claude / opencode / 自定义命令），输出每条规则的 PASS/FAIL，用于横向比较不同 Agent 对同一套 skill 规则的执行效果。
- **bug 修复**：当前 Agent 输出的 `## 待确认问题` 章节经常缺失候选项或缺 `(推荐)` 标记，违反 SKILL.md 中已经写明的硬约束；本期必须从规则文本与测试两端把这条规则真正"咬住"。

## 3. 现状分析

### 3.1 SKILL.md 单文件结构与失效面

`src/skill/SKILL.md` 目前包含十一节，全部塞在一个文件里被 Claude Code 作为一段 prompt 注入：

- 输入约定 / frontmatter 规范 / 全局硬约束 / 自动模式判定顺序
- 阶段行为（plan / tasks / execute 各一节）
- 阶段一附属的「待确认问题结构」
- 新建 spec / 待确认问题判定 / Markdown 格式化约定
- 与 YorZ 工作流关联 / 输出优先级

问题：

- 规则之间互相牵引（如「候选项硬约束」既出现在 plan 节，又被「待确认问题结构」详细展开），改动一处需要同步多处，**真正失效时**也不容易定位"是哪段规则没被 Agent 命中"。
- 单文件不利于跑回归：要验证"Agent 是否遵守候选项硬约束"必须把整份 SKILL 注入，无法只针对 plan/候选项这一小段做最小重复实验。
- 没有版本化的"模块契约"：用 git log 看 SKILL.md 的 diff，无法回答"这次改动会不会破坏 tasks 阶段的批注消费"。

### 3.2 分发链路

- `src/cli/install.ts` 通过 `import skillContent from '../skill/SKILL.md?raw'` 把 SKILL.md 整文件 inline 进 CLI bundle，再写入 `<skills-dir>/yorz-spec/SKILL.md`（Claude scope）。
- 拆分后必须保证：
  - **install 端**仍然能把所有子文档落到 `<skills-dir>/yorz-spec/` 下；
  - **运行时**主 SKILL.md 能被 Agent 正确加载到所有子文档（要么主文件用引用语法把子文档串起来，要么 install 时把所有子文档当资源一并写入并由主 SKILL.md 在 prompt 里指向相对路径）。
- adapter 侧 `claude.ts` / `opencode.ts` 决定的只是 `<skills-dir>` 根；拆分对 adapter 透明，但要复核 OpenCode 是否同样支持多文件 skill（待确认问题）。

### 3.3 Agent 调用与触发点

- service 通过 `src/service/agent-config.ts` 拉起 `claude --permission-mode bypassPermissions -p <prompt>`；prompt 模板见 `src/service/routes/specs.ts:126`：`请使用 yorz-spec skill 处理 spec：.yorz/specs/${specId}/spec.md`。
- skill-run 用同一份 prompt 反复触发，差异完全来自 spec md 当前内容。
- 这意味着 `test:agent` 也可以复用同一条命令链——给定一份"起点 spec"，跑一遍 `claude -p`，再读输出 spec 做断言；无需任何 mock。

### 3.4 现有测试覆盖

`src/service/__tests__/` 与 `src/cli/__tests__/` 现有用例（vitest）：

- `spec-store.test.ts` / `spec-store.appends.test.ts`：spec md 读写、章节解析、追加任务。
- `agent.test.ts` / `agent-config.test.ts`：runner spawn、stream-json 解析、命令解析。
- `answers-route.test.ts` / `appends-route.test.ts` / `apply-question-answers.test.ts` / `service.test.ts` / `git.test.ts` / `touched-files.test.ts`：HTTP 路由与配套 store 行为。
- `install.test.ts`：安装路径与覆盖语义。

**完全缺失的覆盖**：SKILL 文本本身在真实 Agent 上的表现。当前所有用例都绕开了"Agent 是否真的遵守规则"。这也是本次需求要补的缺口。

### 3.5 待确认问题候选项 bug 复盘

SKILL.md 已经写明（节选）：

> **候选项硬约束**：每条问题**若**给出候选项，则必须**恰好** 1 个候选项以 ` (推荐)` 结尾……

但实际生成的 spec（包括本仓库 `.yorz/specs/` 下多个最近 spec）频繁出现：

- 给出候选项但没有 `(推荐)` 标记；
- 既无候选项又无 `（自由文本）` 后缀（旧形态）；
- 候选项写成一段散文而不是嵌套 `  -` 列表。

原因分析：

- 规则文本被"待确认问题结构"与"plan 阶段候选项硬约束"两段独立约束分散描述，模型读到 plan 节时上下文已经很长，对该约束的注意力被稀释；
- 没有"产出前自检"段（checklist），模型不会主动回查自己生成的章节；
- 没有任何自动化测试在跑完 Agent 后断言这条规则，相当于无人值守、长期漂移。

### 3.6 Claude Code Skill 体系对多文件的支持现状

Claude Code 的 Skill 加载机制以 `SKILL.md` 为入口（参见 `Base directory for this skill` 提示），是否允许在 SKILL.md 中引用同目录下的其它 markdown 让其一并被 Agent 读取，文档里没有明确给出强保证；OpenCode adapter 的行为也未知。**这是本期最关键的不确定点**，需要在「待确认问题」中作为单选并给出推荐方案。

## 4. 技术实现方案

整体方向：先小步拆分主 SKILL.md 为"主入口 + 多模块"结构，再围绕模块写真实 Agent 测试，最后通过新增的产出前 checklist + 测试断言双管齐下修复候选项格式 bug。

### 4.1 模块拆分目标结构（已定稿）

采用「平铺 + 主入口用 markdown 引用按需 Read」策略，目录布局如下：

```
src/skill/yorz-spec/
  SKILL.md            # 主入口：frontmatter (name/description) + 一句话定位 + 子文档目录（markdown 链接）
  conventions.md      # 输入约定 + frontmatter 规范 + Markdown 格式化约定
  routing.md          # 自动模式判定顺序（plan/tasks/execute/重开 判定矩阵）
  plan.md             # 阶段一 plan + 待确认问题结构 + 候选项硬约束 + 产出前自检 checklist + 正反例
  tasks.md            # 阶段二 tasks + 批注消费规则 + 用户批注清理
  execute.md          # 阶段三 execute + 追加任务 [open]→[fixed] 状态机
  new-spec.md         # 新建 spec 流程 + summary-name 提炼规则
  rewrite-rules.md    # 全局硬约束（含追加任务 [open] 重开判定、变更重开流程语义）
  index.json          # 子文档元信息：模块名 / 关键硬约束清单 / 关联测试用例 ID
  __tests__/          # 测试用例与运行器（install 时排除）
    vitest.config.ts
    runner.ts
    fixtures/<case>/input.spec.md
    fixtures/<case>/expect.ts
    reports/.gitkeep
```

主 SKILL.md 中以 markdown 链接方式枚举子文档，例如：

```markdown
按需查阅以下子文档：

- [输入约定与格式化](./conventions.md)
- [自动模式判定顺序](./routing.md)
- [阶段一 plan](./plan.md)
- [阶段二 tasks](./tasks.md)
- [阶段三 execute](./execute.md)
- [新建 spec 流程](./new-spec.md)
- [全局硬约束（含重开判定）](./rewrite-rules.md)
```

### 4.2 分发链路调整

- `src/cli/install.ts`：把 `import skillContent from '../skill/SKILL.md?raw'` 改成基于 `import.meta.glob('../skill/yorz-spec/**/*.{md,json}', { eager: true, query: '?raw', import: 'default' })` 的遍历——逐个把虚拟模块路径相对化后写入目标目录。
- **必须排除 `__tests__/` 子目录**（glob 用 `!**/__tests__/**` 或在遍历时按路径过滤），保证测试用例不会被分发到用户 Claude scope。
- 写入前先 `rm -rf <skills-dir>/yorz-spec/`（仅清空 yorz-spec 子目录，不动 `<skills-dir>` 下其它 skill），再 mkdir + 落盘新文件，确保旧版本子文档不残留。
- `src/cli/__tests__/install.test.ts` 同步扩充：
  - 断言目标目录下存在所有子文档（SKILL.md、conventions.md、…、index.json）；
  - 断言不包含 `__tests__/` 任何文件；
  - 断言"先存在的陌生文件被清空"行为。
- 旧 `src/skill/SKILL.md` 在本期最后一并删除（任务清单末尾）。

### 4.3 真实 Agent 测试基础设施

测试用例与子文档共置在 `src/skill/yorz-spec/__tests__/`，与 `pnpm test:agent` 同进程通过 vitest 跑：

- `src/skill/yorz-spec/__tests__/vitest.config.ts`：独立 vitest 配置，`testTimeout` 拉到分钟级（真实 Agent 慢），`include` 限定本目录下的 `*.test.ts`。
- `src/skill/yorz-spec/__tests__/runner.ts`：核心调度器，对外暴露 `runAgentCase({ caseDir, agent })`：
  1. 把 fixture 拷贝到 `tmp/agent-test/<case>-<runId>/` 临时目录（包含 `.claude/skills/yorz-spec/` 完整子文档集合，复用 `install.ts` 的写入逻辑或抽取出共用函数）；
  2. 调用 `resolveAgentCmd({ cwd, agent })`（扩展 `agent-config.ts` 允许显式传入 agent 名）拿到命令，spawn 等其退出；
  3. 读取临时目录下的输出 spec.md，调用 `service/spec-store.ts` 现有解析能力得到结构化对象；
  4. 把结果交给 `fixtures/<case>/expect.ts` 暴露的 `assert(parsedSpec)` 函数；
  5. 收集断言结果（PASS / FAIL + 失败原因 + 命中规则数 / 总规则数）。
- `src/skill/yorz-spec/__tests__/*.test.ts`：每个 case 用一个 `it()` 调用 `runAgentCase`，由 vitest 汇总 PASS/FAIL。
- `package.json` 新增 `"test:agent": "vitest run --config src/skill/yorz-spec/__tests__/vitest.config.ts"`；现有 `pnpm test` 显式 exclude 该目录，保持 CI 单元测试快速。

Fixture 至少覆盖：

- `plan-candidates`：起点 spec 已写好 `## 现状分析`，要求 Agent 生成符合候选项硬约束的 `## 待确认问题`（核心 bug 用例）。
- `tasks-consume-annotations`：起点 spec `## 待确认问题` 已有 `！！！` 批注，断言 Agent 消费批注后清空批注并生成单层 `- [ ]` 任务。
- `execute-checkbox-flip`：起点 spec 有 1 个未完成任务，断言 Agent 完成后改为 `- [x]` 且 `## 执行记录` 追加一条。
- `new-spec-skeleton`：模拟 `spec_path` 缺省，断言生成的 spec 路径符合 `YYMMDD.<type>.<summary-name>`、frontmatter 齐全、章节齐全。
- `reopen-on-new-requirement`：起点 spec stage=execute 但正文新增"需求"段，断言 Agent 切回 plan。
- `append-task-state`：起点 spec `## 追加任务` 含 `[open]` 项，断言 Agent 重开并最终改为 `[fixed]`。

### 4.4 跨 Agent 评估（claude + opencode 同等覆盖）

- 通过 `--agent=<claude|opencode|custom>` 透传给 runner；runner 内部根据 agent 名构造命令（复用 `agent-config.ts` 的解析能力，必要时扩展支持显式 agent override）。
- 本期把 opencode 拉齐到与 claude 同等覆盖：所有 fixture 在两种 Agent 下都必须跑通；若 opencode 在某条规则上失败，则迭代 SKILL 子文档文本或在 `routing.md` / `plan.md` 中追加显式提示，直到通过。
- Reporter：
  - 单 run 输出对照表（每个 case × 每个 agent 的 PASS/FAIL + 命中规则数）；
  - 按模块聚合通过率（依赖 `index.json` 把 case 关联到模块）；
  - 输出 spec 章节齐全度（`## 现状分析` / `## 技术实现方案` / `## 待确认问题` / `## 任务清单` / `## 执行记录` 是否齐全）；
  - 持久化到 `src/skill/yorz-spec/__tests__/reports/<timestamp>.json`，并 console 输出可读表格。

### 4.5 候选项格式 bug 修复（plan.md 强化 + 测试断言）

在拆出来的 `plan.md` 末尾增加显式 **"产出前自检 checklist"** 段落（模型可以照着核对）：

- 是否每条 `- ` 一级问题都满足"要么有候选项且恰 1 个 `(推荐)`，要么以 `（自由文本）` 结尾"？
- 候选项是否都用 `  -` 二级列表表达（不是散文段、不是表格）？
- 是否避免新增一条"以推荐项为名"的额外条目？

并加正反例代码块（正例 + 三种典型反例：缺 `(推荐)`、多个 `(推荐)`、缺 `（自由文本）` 后缀）。

测试侧 `__tests__/fixtures/plan-candidates/`：

- input：一个刚进入 plan、`## 现状分析` 已经写好、`## 待确认问题` 还没生成的 spec；
- expect：解析输出，校验每条问题都符合硬约束；统计违反类型并打分。

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [x] 在 `src/skill/yorz-spec/` 下创建主入口 `SKILL.md` 骨架（frontmatter + 一句话定位 + 子文档 markdown 链接目录），验收点：文件存在、frontmatter 含 `name: yorz-spec` 与 `description`、body 列出 7 个子文档链接。
- [x] 从现有 `src/skill/SKILL.md` 抽出输入约定 / frontmatter 规范 / Markdown 格式化约定写入 `src/skill/yorz-spec/conventions.md`，验收点：与原文语义一致、无遗漏字段。
- [x] 抽出自动模式判定顺序写入 `src/skill/yorz-spec/routing.md`，验收点：7 条判定顺序逐条保留，并标注"严格按顺序"。
- [x] 抽出阶段一规则 + 待确认问题结构写入 `src/skill/yorz-spec/plan.md`，并在末尾追加"产出前自检 checklist"段 + 正反例代码块（正例 1 + 反例 3 种），验收点：candidate 硬约束的关键句出现在 checklist 与正反例中至少各 1 次。
- [x] 抽出阶段二规则 + 批注消费规则写入 `src/skill/yorz-spec/tasks.md`，验收点：批注前缀 `！！！` 与"处理完成后删除对应 `！！！` 文本"两条硬约束完整保留。
- [x] 抽出阶段三规则 + 追加任务 `[open]→[fixed]` 状态机写入 `src/skill/yorz-spec/execute.md`，验收点：勾选 + `执行记录` 追加两条硬约束完整保留。
- [x] 抽出新建 spec 流程 + summary-name 提炼规则写入 `src/skill/yorz-spec/new-spec.md`，验收点：id 格式 `YYMMDD.<type>.<summary-name>` 与冲突追加 `-2/-3` 规则保留。
- [x] 抽出全局硬约束（含变更重开 / 追加任务 `[open]` 重开判定）写入 `src/skill/yorz-spec/rewrite-rules.md`，验收点：六大必备章节列表保留、重开流程语义保留。
- [x] 编写 `src/skill/yorz-spec/index.json`：列出每个子文档的 `module` / `keyRules`（关键硬约束摘要数组） / `relatedCases`（关联测试 case 名），验收点：JSON schema 校验通过、模块数等于子文档数。
- [x] 改造 `src/cli/install.ts`：用 `import.meta.glob('../skill/yorz-spec/**/*.{md,json}', { eager: true, query: '?raw', import: 'default' })` 遍历写入，路径相对化处理，**排除 `**/**tests**/**`**，写入前 `rm -rf <skills-dir>/yorz-spec/` 再 mkdir，验收点：安装后目录含全部子文档且不含任何 `__tests__/` 内容。
- [x] 扩充 `src/cli/__tests__/install.test.ts`：新增三条断言——子文档齐全、`__tests__/` 被排除、安装前预置的陌生文件被清空，验收点：`pnpm test` 全绿。
- [x] 删除旧 `src/skill/SKILL.md` 与所有引用它的 `import ... '?raw'` 残留，验收点：grep `skill/SKILL.md` 在源码内零命中（除新路径外）。
- [x] 新增 `src/skill/yorz-spec/__tests__/vitest.config.ts`：独立 config，`testTimeout` ≥ 600_000，`include` 限定 `*.test.ts`，并配置 alias 让用例能 import 仓库源码（复用根 `tsconfig` paths），验收点：`pnpm vitest run --config <path>` 能加载到 0 个 spec 而不报错。
- [x] 调整根 `vitest.config.ts` 把 `src/skill/yorz-spec/__tests__/` 加入 exclude，避免 `pnpm test` 跑真实 Agent，验收点：`pnpm test` 不触发任何 Agent 调用。
- [x] 在 `package.json` 新增 `"test:agent": "vitest run --config src/skill/yorz-spec/__tests__/vitest.config.ts"`，验收点：脚本可被 `pnpm test:agent` 调起。
- [x] 实现 `src/skill/yorz-spec/__tests__/runner.ts`：`runAgentCase({ caseDir, agent })` 完成 fixture 拷贝到 `tmp/agent-test/<case>-<runId>/`、写入完整 `.claude/skills/yorz-spec/`、spawn agent 命令、读取输出 spec、解析、调用 `expect.ts` 的 `assert()`、返回 `{ pass, failures, hitRules, totalRules }`，验收点：单元 dry-run（mock spawn）能跑通主流程。
- [x] 扩展 `src/service/agent-config.ts` 与（若需）`src/cli/install.ts`：暴露"按 agent 名解析命令"的纯函数，供 runner 直接调用，验收点：现有 `agent-config.test.ts` 仍全绿，新增针对 opencode 名解析的 1 条用例通过。
- [x] 创建 fixture `plan-candidates/`：`input.spec.md`（plan 起点、`## 现状分析` 写好、`## 待确认问题` 仅"- 暂无"）+ `expect.ts`（断言生成的问题全部满足候选项硬约束或以"（自由文本）"结尾），验收点：fixture 文件齐全、`expect.ts` 可独立 import 通过 ts 检查。
- [x] 创建 fixture `tasks-consume-annotations/`：input 含 `！！！` 批注，expect 断言（1）`！！！` 已被清除（2）任务清单为单层 `- [ ]` 且 ≥ 1 条 ，验收点：fixture 齐全。
- [x] 创建 fixture `execute-checkbox-flip/`：input 含 1 条 `- [ ]` 任务，expect 断言任务改为 `- [x]` 且 `## 执行记录` 新增 ≥ 1 条，验收点：fixture 齐全。
- [x] 创建 fixture `new-spec-skeleton/`：模拟无 `spec_path` 场景（runner 调起 Agent 时不传 spec 路径，触发新建流程），expect 校验产物路径与 frontmatter 齐全度，验收点：fixture 齐全。
- [x] 创建 fixture `reopen-on-new-requirement/`：input stage=execute、`## 需求` 中已加新增条目，expect 断言 frontmatter `stage` 回到 `plan` 且 `last_action` 含"重开"字样，验收点：fixture 齐全。
- [x] 创建 fixture `append-task-state/`：input `## 追加任务` 含 `- [open]` 项，expect 断言 Agent 完成后改为 `- [fixed]` 且原 `[open]` 已不存在，验收点：fixture 齐全。
- [x] 编写 reporter：在所有用例跑完后，根据 `index.json` 聚合"按模块通过率 + 章节齐全度 + 单 case 对照表"，console 输出表格 + 写入 `src/skill/yorz-spec/__tests__/reports/<YYYYMMDD-HHMMSS>.json`，验收点：人工运行后 reports 目录出现 JSON 文件且内容符合 schema。
- [ ] 跑 `pnpm test:agent --agent=claude`，记录通过率；针对失败 case 迭代对应子文档文本直至全绿，验收点：claude 在所有 fixture 100% PASS（或在执行记录中明确列出无法修复的失败并附原因）。
- [ ] 跑 `pnpm test:agent --agent=opencode`，记录通过率；针对失败 case 迭代子文档直至与 claude 同等覆盖（同样 100% PASS），验收点：opencode 在所有 fixture 100% PASS（或在执行记录中明确列出无法修复的失败并附原因）。
- [ ] 最终回归：`pnpm test`（单元）+ `pnpm test:agent --agent=claude`（agent）+ `pnpm test:agent --agent=opencode`（agent）三件套全绿，把结果摘要写入 `## 执行记录`，验收点：三条命令的退出码均为 0。

## 7. 追加任务

- 暂无

## 8. 执行记录

- 2026-06-20 完成任务 1-9（拆分 SKILL.md）：在 `src/skill/yorz-spec/` 下新建 `SKILL.md`（主入口，按需引用子文档）+ `conventions.md` / `routing.md` / `plan.md`（含产出前自检 checklist + 1 正例 + 5 反例）/ `tasks.md` / `execute.md` / `new-spec.md` / `rewrite-rules.md` + `index.json`（每模块列出 `module` / `keyRules` / `relatedCases`，模块数 = 7 = 子文档数）。验证：人工逐文件 review 与原 `src/skill/SKILL.md` 对照，硬约束（候选项 (推荐)、`！！！` 删除、`[open]→[fixed]`、六大必备章节）全部保留；旧 SKILL.md 暂未删除，待 install 改造和 vite.config 同步更新后一次性清理。
- 2026-06-20 完成任务 10-12（分发链路改造 + 删除旧 SKILL.md）：`src/cli/install.ts` 改用 `import.meta.glob` 编译期 inline 所有 `src/skill/yorz-spec/**/*.{md,json}`，写入前先 `rm -rf <skill-dir>/yorz-spec/`、过滤掉任何 `__tests__/` 路径；`install.test.ts` 重写——新增「子文档齐全」「`__tests__/` 已排除」「陌生残留文件被清空」三组断言；`vite.config.ts` 删除原 `copyFile(src/skill/SKILL.md)` 步骤、改为内联兜底，并在 `test.exclude` 中加入 `src/skill/yorz-spec/__tests__/**`；删除 `src/skill/SKILL.md`（grep 确认 TS 源码中已无 `skill/SKILL.md` 引用）。验证：`pnpm test` 14 文件 / 111 用例全绿。
- 2026-06-20 消费用户批注「继续执行任务」并归位任务 13-15：核对 `src/skill/yorz-spec/__tests__/vitest.config.ts`（root 已重定向到仓库根、`testTimeout: 600_000`、`fileParallelism: false`、声明 `@yorz/cli` 与 `@yorz/service` 别名）、根 `vite.config.ts`（已 exclude `src/skill/yorz-spec/__tests__/**`）、`package.json`（已包含 `"test:agent": "vitest run --config src/skill/yorz-spec/__tests__/vitest.config.ts"`）；三项均已在更早提交中落地，本次仅刷新任务清单状态。
- 2026-06-20 完成任务 17（agent-config 按 agent 名解析）：`resolveAgentCmd` 新增 `opts.agent` 显式分支（优先级低于 `override` 与 `YORZ_AGENT_CMD`，高于 `.yorz/config.json`），`resolveAgentByName` 已暴露；`src/service/__tests__/agent-config.test.ts` 新增「honors explicit opts.agent=opencode over .yorz/config.json」用例。验证：`pnpm test` 14 文件 / 112 用例全绿（较此前 +1）。
- 2026-06-20 完成任务 16（runner.ts）：实现 `runAgentCase({ caseDir, agent, runId })`，流程为「rm tmp → cp `src/skill/yorz-spec/*`（过滤 `__tests__`）到 `<tmp>/.claude/skills/yorz-spec/` → 拷贝 fixture `input.spec.md`（newSpec 场景跳过）到 `<tmp>/<specRelPath>` → 调用 `resolveAgentCmd({ cwd, agent })` → spawn（'error'/'exit' 都收敛到 `{ code, spawnError }`，不再裸 throw）→ 读取输出 spec → 注入 `YORZ_TEST_TMPDIR` 给 expect → 调 `expect.ts:assert()` 收集 `{ pass, failures, hitRules, totalRules }`」。dry-run 用 `YORZ_AGENT_CMD=/usr/bin/false pnpm test:agent` 验证：harness 端到端可加载、6 个 fixture 全部进到 assert、JSON 报告正常写入。
- 2026-06-20 完成任务 18-23（6 个 fixture）：在 `src/skill/yorz-spec/__tests__/fixtures/` 下分别建立 `plan-candidates / tasks-consume-annotations / execute-checkbox-flip / new-spec-skeleton / reopen-on-new-requirement / append-task-state` 目录，每个含 `meta.json`（声明 `module` / 可选 `prompt` / `newSpec`）+ `input.spec.md`（除 new-spec 外）+ `expect.ts`（暴露 `assert(parsed)`，返回 `{ failures, hitRules, totalRules }`）。验证：dry-run 6 个 case 全部进入断言阶段、各自产出符合预期的失败原因（用真实 Agent 跑通是任务 25-26）。
- 2026-06-20 完成任务 24（reporter）：`runner.ts` 暴露 `writeReport(results, agent)`，根据 fixture `meta.json` 的 `module` 字段聚合通过率，同时统计 `## 现状分析 / 技术实现方案 / 待确认问题 / 任务清单 / 执行记录` 的章节齐全度，输出 console.table + 持久化到 `src/skill/yorz-spec/__tests__/reports/<ISO-timestamp>-<agent>.json`，`cases.test.ts` 在 `afterAll` 触发；dry-run 已验证 reports 目录正确生成 JSON。
- 2026-06-20 配套补丁：`.gitignore` 追加 `tmp/agent-test` 与 `src/skill/yorz-spec/__tests__/reports/*.json`（保留 `.gitkeep`），避免临时产物入库。
- 2026-06-20 消费用户批注「继续执行任务 25-27」：本地已具备 `claude`（/opt/homebrew/bin/claude）与 `opencode`（/opt/homebrew/bin/opencode）。批注无歧义、不引入新需求，直接进入 execute 阶段顺序执行任务 25 → 26 → 27。

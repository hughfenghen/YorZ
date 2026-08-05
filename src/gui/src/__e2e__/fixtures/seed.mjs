// Plain-JS e2e seed module — shared by Playwright globalSetup (setup.ts) and the
// pre-serve seed command in playwright.config.ts. Kept dependency-free so it can be
// executed directly with plain `node` (no tsx/ts loader) before `yorz serve` starts,
// eliminating the process-registration race (webServer runs before globalSetup).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')

export const E2E_CWD = join(REPO_ROOT, '.tmp-e2e')
export const SPEC_ID = '260616.feat.e2e-seed'
export const QUESTIONS_SPEC_ID = '260618.feat.e2e-questions'
// Dedicated spec for the freeform-annotation test. Answering a question triggers
// an agent run that hides the panel, so this test needs its own pristine spec
// instead of sharing QUESTIONS_SPEC_ID with the structured-answer test.
export const QUESTIONS_FREEFORM_SPEC_ID = '260618.feat.e2e-questions-freeform'
export const TASK_LIST_SPEC_ID = '260701.feat.e2e-task-list'
export const NO_REVIEW_SPEC_ID = '260701.feat.e2e-no-review'
export const SCROLL_SPEC_ID = '260719.fix.e2e-scroll-preserve'
export const SCROLL_TEXT_SPEC_ID = '260719.fix.e2e-scroll-text-only'

/** Build a long, mermaid-heavy body so the article scrolls several screens and
 * mermaid's async SVG injection materially changes content height. `marker`
 * lets the test mutate the body per write (simulating an agent's live edits). */
export function buildScrollSpec(marker) {
  const mermaidBlock = (n) => `### ${n}. 章节 ${n}

这是第 ${n} 段说明文字，用于把正文撑高，确保滚动容器出现多屏可滚动内容。${'占位文本 '.repeat(20)}

\`\`\`mermaid
flowchart TD
    A${n}[开始节点 ${n}] --> B${n}[处理 ${n}]
    B${n} --> C${n}{判断 ${n}}
    C${n} -->|是| D${n}[分支真 ${n}]
    C${n} -->|否| E${n}[分支假 ${n}]
    D${n} --> F${n}[汇合 ${n}]
    E${n} --> F${n}
\`\`\`

${'更多正文占位，保证每节都足够高。'.repeat(10)}
`
  const sections = Array.from({ length: 8 }, (_, i) => mermaidBlock(i + 1)).join('\n')
  return `---
stage: plan
last_action: e2e 滚动保持 ${marker}
updated_at: '2026-07-19 12:00:00'
summary: Playwright e2e 用于验证 SSE 刷新后滚动位置保持（mermaid 密集，marker=${marker}）
---

# E2E 滚动保持（mermaid 密集）

## 1. 背景

用于复现「Agent 持续更新 spec.md 时正文滚动位置被重置到顶部」。marker=${marker}

## 2. 正文

${sections}
`
}

/** Text-only control: same length, no mermaid — height is stable across refresh. */
export function buildScrollTextSpec(marker) {
  const block = (n) => `### ${n}. 章节 ${n}

这是第 ${n} 段纯文本说明。${'占位文本 '.repeat(40)}

${'更多正文占位，保证每节都足够高。'.repeat(15)}
`
  const sections = Array.from({ length: 8 }, (_, i) => block(i + 1)).join('\n')
  return `---
stage: plan
last_action: e2e 滚动保持纯文本 ${marker}
updated_at: '2026-07-19 12:00:00'
summary: Playwright e2e 纯文本对照组（marker=${marker}）
---

# E2E 滚动保持（纯文本对照）

## 1. 背景

纯文本对照组，无 mermaid，刷新时高度稳定。marker=${marker}

## 2. 正文

${sections}
`
}

const SEED_SPEC = `---
stage: plan
last_action: e2e 种子 spec
updated_at: 2026-06-16
summary: Playwright e2e 用于验证选择浮动菜单
---

# E2E 种子

## 1. 背景

这是用于 Playwright e2e 测试的 spec 种子文档。下面这一段正文将被测试用例用作文本选择目标，请保留可被稳定选中的中文文字。

## 2. 现状分析

### 2.1 GUI 现状

选择菜单浮窗在选区附近弹出，应包含批注与解释两个按钮。
`

const QUESTIONS_SPEC = `---
stage: plan
last_action: e2e 种子 spec
updated_at: 2026-06-18
summary: Playwright e2e 用于验证待确认问题确认面板
---

# E2E 待确认问题

## 1. 背景

用于 Playwright e2e 测试的待确认问题确认面板种子文档。

## 2. 待确认问题

### 2.1 候选答案的展现形式应采用哪种？
1. 嵌套子列表
2. 表格 (推荐)
3. 自定义 YAML 块
`

const TASK_LIST_SPEC = `---
stage: tasks
last_action: e2e 种子 spec
updated_at: '2026-07-01 12:00:00'
summary: Playwright e2e 用于验证 GFM 任务列表 checkbox 渲染
---

# E2E 任务列表 checkbox

## 1. 背景

用于验证 markdown-it-task-lists 插件接入后的渲染。

## 2. 任务清单

- [ ] 未完成的任务 A
- [x] 已完成的任务 B
- [X] 已完成的任务 C（大写 X）
- 普通列表项，不应变成 checkbox
`

export function seed() {
  rmSync(E2E_CWD, { recursive: true, force: true })
  const baseDir = join(E2E_CWD, '.yorz', 'specs', SPEC_ID)
  mkdirSync(baseDir, { recursive: true })
  writeFileSync(join(baseDir, 'spec.md'), SEED_SPEC, 'utf8')

  const qDir = join(E2E_CWD, '.yorz', 'specs', QUESTIONS_SPEC_ID)
  mkdirSync(qDir, { recursive: true })
  writeFileSync(join(qDir, 'spec.md'), QUESTIONS_SPEC, 'utf8')

  const qfDir = join(E2E_CWD, '.yorz', 'specs', QUESTIONS_FREEFORM_SPEC_ID)
  mkdirSync(qfDir, { recursive: true })
  writeFileSync(join(qfDir, 'spec.md'), QUESTIONS_SPEC, 'utf8')

  const tlDir = join(E2E_CWD, '.yorz', 'specs', TASK_LIST_SPEC_ID)
  mkdirSync(tlDir, { recursive: true })
  writeFileSync(join(tlDir, 'spec.md'), TASK_LIST_SPEC, 'utf8')

  const nrDir = join(E2E_CWD, '.yorz', 'specs', NO_REVIEW_SPEC_ID)
  mkdirSync(nrDir, { recursive: true })
  writeFileSync(join(nrDir, 'spec.md'), TASK_LIST_SPEC, 'utf8')

  const scDir = join(E2E_CWD, '.yorz', 'specs', SCROLL_SPEC_ID)
  mkdirSync(scDir, { recursive: true })
  writeFileSync(join(scDir, 'spec.md'), buildScrollSpec('seed'), 'utf8')

  const stDir = join(E2E_CWD, '.yorz', 'specs', SCROLL_TEXT_SPEC_ID)
  mkdirSync(stDir, { recursive: true })
  writeFileSync(join(stDir, 'spec.md'), buildScrollTextSpec('seed'), 'utf8')
}

// Direct execution (`node seed.mjs`) → run the seed. Used by webServer.command to
// materialize .tmp-e2e/.yorz before `yorz serve` starts so cwd registration succeeds.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed()
  // eslint-disable-next-line no-console
  console.log(`[e2e seed] seeded ${E2E_CWD}`)
}

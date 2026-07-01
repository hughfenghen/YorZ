import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')

export const E2E_CWD = join(REPO_ROOT, '.tmp-e2e')
export const SPEC_ID = '260616.feat.e2e-seed'
export const QUESTIONS_SPEC_ID = '260618.feat.e2e-questions'

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

function seed(): void {
  rmSync(E2E_CWD, { recursive: true, force: true })
  const baseDir = join(E2E_CWD, '.yorz', 'specs', SPEC_ID)
  mkdirSync(baseDir, { recursive: true })
  writeFileSync(join(baseDir, 'spec.md'), SEED_SPEC, 'utf8')

  const qDir = join(E2E_CWD, '.yorz', 'specs', QUESTIONS_SPEC_ID)
  mkdirSync(qDir, { recursive: true })
  writeFileSync(join(qDir, 'spec.md'), QUESTIONS_SPEC, 'utf8')
}

export default async function globalSetup(): Promise<void> {
  seed()
}

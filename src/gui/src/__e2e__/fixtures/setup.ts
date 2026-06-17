import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')

export const E2E_CWD = join(REPO_ROOT, '.tmp-e2e')
export const SPEC_ID = '260616.feat.e2e-seed'

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

function seed(): void {
  const dir = join(E2E_CWD, '.yorz', 'specs', SPEC_ID)
  rmSync(E2E_CWD, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'spec.md'), SEED_SPEC, 'utf8')
}

export default async function globalSetup(): Promise<void> {
  seed()
}

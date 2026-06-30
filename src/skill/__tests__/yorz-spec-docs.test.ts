import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const skillDir = resolve(here, '../yorz-spec')

function read(name: string): string {
  return readFileSync(resolve(skillDir, name), 'utf-8')
}

describe('yorz-spec skill 文档关键词存在性（持续推进硬约束）', () => {
  it('SKILL.md 包含「持续推进硬约束」小节与禁止「元确认」的兜底说明', () => {
    const body = read('SKILL.md')
    expect(body).toMatch(/##\s+持续推进硬约束/)
    expect(body).toMatch(/元确认/)
    expect(body).toMatch(/合法阻塞/)
    expect(body).toMatch(/副作用/)
  })

  it('tasks.md 的「自动衔接」补齐了「任务量不构成暂停理由」与禁止追问硬约束', () => {
    const body = read('tasks.md')
    expect(body).toMatch(/任务量不构成暂停理由/)
    expect(body).toMatch(/同一轮衔接 execute 前后不得/)
  })

  it('execute.md 的「顺序执行」补齐了「中段元确认」硬约束', () => {
    const body = read('execute.md')
    expect(body).toMatch(/中段元确认/)
    expect(body).toMatch(/整批\/中段元确认/)
  })
})

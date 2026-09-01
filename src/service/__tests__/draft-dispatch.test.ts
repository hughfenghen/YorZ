import { describe, expect, it } from 'vitest'
import { stripHiddenPrompt } from '../custom-instruction.js'
import { buildDraftDispatch } from '../slash-command.js'

describe('buildDraftDispatch', () => {
  const base = { specsDirRelative: '.yorz/specs', type: 'feat' as const }

  it('renders the command line the user could have typed in chat', () => {
    const out = buildDraftDispatch({ ...base, requirement: '加上 X 功能' })
    expect(out.commandLine).toBe('/yorz-spec feat: 加上 X 功能')
    // Never a leading slash for the Agent, yet the bubble recovers the line.
    expect(out.prompt.startsWith('/')).toBe(false)
    expect(stripHiddenPrompt(out.prompt)).toBe(out.commandLine)
  })

  it('names the skill, the type and the spec dir, and omits attachment steps', () => {
    const out = buildDraftDispatch({ ...base, requirement: '加上 X 功能' })
    // Skills live in the shared global dir, so the prompt must carry an
    // absolute SKILL.md path instead of a bare skill name.
    expect(out.prompt).toContain('/skills/yorz-spec/SKILL.md')
    expect(out.prompt).toContain('类型：feat')
    expect(out.prompt).toContain('「新建 spec」流程')
    expect(out.prompt).toContain('.yorz/specs/')
    expect(out.prompt).not.toContain('附件迁移')
    expect(out.prompt).not.toContain('.yorz/tmp/drafts/')
    // The chat-only fallback and the append wording must not leak into a typed
    // new-spec dispatch — there is no spec, and no `## 追加任务` to consume.
    expect(out.prompt).not.toContain('未指定 spec_path')
    expect(out.prompt).not.toContain('追加任务流程')
    expect(out.prompt).toContain('据此创建 spec')
  })

  it('includes the attachment migration block with a draftId', () => {
    const out = buildDraftDispatch({
      specsDirRelative: 'docs/specs',
      type: 'fix',
      requirement: 'r',
      draftId: 'abc-123',
    })
    expect(out.commandLine).toBe('/yorz-spec fix: r')
    expect(out.prompt).toContain('.yorz/tmp/drafts/abc-123/attachments/')
    // Migration target follows the project's configured spec dir.
    expect(out.prompt).toContain('docs/specs/<id>/attachments/')
    expect(out.prompt).toContain('![<文件名>](attachments/<文件名>)')
    expect(out.prompt).toContain('## 待确认项')
    expect(out.prompt).toMatch(/迁移失败/)
  })

  it('keeps a multi-line requirement intact on the command line', () => {
    const out = buildDraftDispatch({ ...base, requirement: '第一行\n第二行' })
    expect(out.commandLine).toBe('/yorz-spec feat: 第一行\n第二行')
    expect(stripHiddenPrompt(out.prompt)).toBe(out.commandLine)
  })
})

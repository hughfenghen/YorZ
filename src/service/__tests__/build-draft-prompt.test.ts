import { describe, expect, it } from 'vitest'
import { buildDraftPrompt } from '../routes/specs.js'

describe('buildDraftPrompt', () => {
  it('omits attachment instructions when no draftId is provided', () => {
    const prompt = buildDraftPrompt('feat', '加上 X 功能')
    expect(prompt).toContain('类型：feat')
    expect(prompt).toContain('加上 X 功能')
    expect(prompt).not.toContain('附件迁移')
    expect(prompt).not.toContain('.yorz/drafts/')
  })

  it('includes attachment migration block with draftId', () => {
    const prompt = buildDraftPrompt('feat', 'r', 'abc-123')
    expect(prompt).toContain('.yorz/drafts/abc-123/attachments/')
    expect(prompt).toContain('.yorz/specs/<id>/attachments/')
    // kind → markdown syntax mapping
    expect(prompt).toContain('![<文件名>](attachments/<文件名>)')
    expect(prompt).toContain('[<文件名>](attachments/<文件名>)')
    // failure fallback into 待确认问题
    expect(prompt).toContain('## 待确认问题')
    expect(prompt).toMatch(/迁移失败/)
  })
})

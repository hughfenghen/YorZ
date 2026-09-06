import { describe, it, expect } from 'vitest'
import { specCommitMessage } from '@shared/lib/spec-meta.js'

describe('specCommitMessage', () => {
  it('拼 `<type>: <summary>`，type 取 spec id 第二段', () => {
    expect(specCommitMessage('260906.feat.mobile-git', '移动端 git 页')).toBe('feat: 移动端 git 页')
    expect(specCommitMessage('260906.fix.crash', '修一个崩溃')).toBe('fix: 修一个崩溃')
  })

  it('summary 缺失或只有空白时回退 update', () => {
    expect(specCommitMessage('260906.refct.split', undefined)).toBe('refct: update')
    expect(specCommitMessage('260906.refct.split', '   ')).toBe('refct: update')
  })

  it('summary 两侧空白被裁掉', () => {
    expect(specCommitMessage('260906.feat.x', '  加个按钮  ')).toBe('feat: 加个按钮')
  })

  it('退化 id 仍取第二段；连第二段都没有才回退 feat', () => {
    expect(specCommitMessage('260906.fix', '修一下')).toBe('fix: 修一下')
    expect(specCommitMessage('untitled', '随便写点')).toBe('feat: 随便写点')
  })
})

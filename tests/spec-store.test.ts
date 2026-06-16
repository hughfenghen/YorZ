import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpecStore } from '../src/service/spec-store.js'

async function makeStore(date = new Date('2026-06-14T10:00:00Z')) {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-store-'))
  const store = new SpecStore({ cwd, now: () => date })
  await store.ensureRoot()
  return { store, cwd }
}

describe('SpecStore.create', () => {
  it('generates id YYMMDD.type.kebab-summary', async () => {
    const { store } = await makeStore()
    const { id } = await store.create({
      title: 'Hello World',
      type: 'feat',
      summary: 'Hello World Feature',
    })
    expect(id).toBe('260614.feat.hello-world-feature')
  })

  it('appends -2/-3 on id conflict', async () => {
    const { store } = await makeStore()
    const a = await store.create({ title: 'T', type: 'feat', summary: 'same name' })
    const b = await store.create({ title: 'T', type: 'feat', summary: 'same name' })
    const c = await store.create({ title: 'T', type: 'feat', summary: 'same name' })
    expect(a.id).toBe('260614.feat.same-name')
    expect(b.id).toBe('260614.feat.same-name-2')
    expect(c.id).toBe('260614.feat.same-name-3')
  })

  it('writes frontmatter with fixed field order and all seven sections', async () => {
    const { store } = await makeStore()
    const { path } = await store.create({
      title: 'My Spec',
      type: 'fix',
      summary: '修复登录 bug',
      requirement: '用户登录失败时无反馈',
    })
    const raw = await readFile(path, 'utf8')
    const lines = raw.split('\n')
    expect(lines[0]).toBe('---')
    expect(lines[1]).toBe('stage: plan')
    expect(lines[2]).toBe('last_action: 新建 spec')
    expect(lines[3]).toBe('updated_at: 2026-06-14')
    expect(lines[4]).toBe('summary: 修复登录 bug')
    expect(lines[5]).toBe('---')
    expect(raw).toContain('# My Spec')
    expect(raw).toContain('## 背景')
    expect(raw).toContain('用户登录失败时无反馈')
    expect(raw).toContain('## 需求')
    expect(raw).toContain('## 现状分析')
    expect(raw).toContain('## 技术实现方案')
    expect(raw).toContain('## 待确认问题')
    expect(raw).toContain('## 任务清单')
    expect(raw).toContain('## 执行记录')
  })
})

describe('SpecStore.list / read / appendNote', () => {
  it('list returns most recently updated first', async () => {
    const { store, cwd } = await makeStore()
    await store.create({ title: 'A', type: 'feat', summary: 'a' })
    // second spec is one day later
    const later = new Date('2026-06-15T10:00:00Z')
    const store2 = new SpecStore({ cwd, now: () => later })
    await store2.create({ title: 'B', type: 'feat', summary: 'b' })
    const items = await store2.list()
    expect(items[0].id.startsWith('260615')).toBe(true)
    expect(items[1].id.startsWith('260614')).toBe(true)
  })

  it('appendNote preserves frontmatter order and adds a note line', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({
      title: 'X',
      type: 'feat',
      summary: 'x summary',
    })
    await store.appendNote(id, '请优先实现登录')
    const raw = await readFile(path, 'utf8')
    const headerLines = raw.split('---')[1].trim().split('\n')
    expect(headerLines[0]).toBe('stage: plan')
    expect(headerLines[1]).toBe('last_action: 追加用户批注')
    expect(headerLines[2]).toBe('updated_at: 2026-06-14')
    expect(headerLines[3]).toBe('summary: x summary')
    expect(raw).toMatch(/> 用户批注（2026-06-14）：请优先实现登录/)
  })

  it('list ignores directories without spec.md', async () => {
    const { store, cwd } = await makeStore()
    await mkdir(join(cwd, '.yorz', 'specs', 'empty-dir'), { recursive: true })
    await store.create({ title: 'Z', type: 'feat', summary: 'z' })
    const items = await store.list()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Z')
  })
})

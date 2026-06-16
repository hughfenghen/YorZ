import { mkdtemp, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpecStore } from '../spec-store.js'

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
    expect(id).toBe('260614.feat.hello-world')
  })

  it('appends -2/-3 on id conflict', async () => {
    const { store } = await makeStore()
    const a = await store.create({ title: 'same name', type: 'feat', summary: 'same name' })
    const b = await store.create({ title: 'same name', type: 'feat', summary: 'same name' })
    const c = await store.create({ title: 'same name', type: 'feat', summary: 'same name' })
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

  it('uses placeholder title/summary when caller omits them', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({
      type: 'feat',
      requirement: '让登录支持手机号\n\n详细描述继续',
    })
    expect(id).toMatch(/^260614\.feat\./)
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('# 让登录支持手机号')
    expect(raw).toMatch(/summary: 让登录支持手机号/)
    expect(raw).toContain('详细描述继续')
  })

  it('falls back to "（待 Agent 补全）" when no fields are provided', async () => {
    const { store } = await makeStore()
    const { path } = await store.create({ type: 'feat' })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('# （待 Agent 补全）')
    expect(raw).toMatch(/summary: （待 Agent 补全）/)
  })
})

describe('SpecStore.list / read / appendAnnotation', () => {
  it('list returns most recently updated first', async () => {
    const { store, cwd } = await makeStore()
    await store.create({ title: 'A', type: 'feat', summary: 'a' })
    const later = new Date('2026-06-15T10:00:00Z')
    const store2 = new SpecStore({ cwd, now: () => later })
    await store2.create({ title: 'B', type: 'feat', summary: 'b' })
    const items = await store2.list()
    expect(items[0].id.startsWith('260615')).toBe(true)
    expect(items[1].id.startsWith('260614')).toBe(true)
  })

  it('appendAnnotation writes quote + ！！！ note and resets stage to plan', async () => {
    const dateA = new Date('2026-06-14T10:00:00Z')
    const dateB = new Date('2026-06-16T10:00:00Z')
    const { store, cwd } = await makeStore(dateA)
    const { id, path } = await store.create({
      title: 'X',
      type: 'feat',
      summary: 'x summary',
    })
    // simulate Agent advanced the doc to tasks stage
    const initial = await readFile(path, 'utf8')
    const advanced = initial.replace('stage: plan', 'stage: tasks')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, advanced, 'utf8')

    const store2 = new SpecStore({ cwd, now: () => dateB })
    await store2.appendAnnotation(id, {
      sectionPath: '2.1 GUI 现状',
      quote: '底部存在追加批注表单',
      note: '改为顶部按钮',
    })
    const raw = await readFile(path, 'utf8')
    const headerLines = raw.split('---')[1].trim().split('\n')
    expect(headerLines[0]).toBe('stage: plan')
    expect(headerLines[1]).toBe('last_action: 用户新增批注 ！！！')
    expect(headerLines[2]).toBe('updated_at: 2026-06-16')
    expect(headerLines[3]).toBe('summary: x summary')
    expect(raw).toContain('> 2.1 GUI 现状 中 "底部存在追加批注表单"')
    expect(raw).toContain('> ！！！改为顶部按钮')
  })

  it('appendAnnotation rejects empty quote/note', async () => {
    const { store } = await makeStore()
    const { id } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await expect(
      store.appendAnnotation(id, { sectionPath: 's', quote: '   ', note: 'n' }),
    ).rejects.toThrow(/quote/)
    await expect(
      store.appendAnnotation(id, { sectionPath: 's', quote: 'q', note: '   ' }),
    ).rejects.toThrow(/note/)
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

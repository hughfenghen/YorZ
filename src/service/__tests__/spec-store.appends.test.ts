import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpecStore } from '../spec-store.js'

async function makeStore(date = new Date('2026-06-19T10:30:00Z')) {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-appends-'))
  const store = new SpecStore({ cwd, now: () => date })
  await store.ensureRoot()
  return { store, cwd }
}

describe('SpecStore.appendItem', () => {
  it('creates `## 追加任务` section when absent and inserts before `## 执行记录`', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await store.appendItem(id, { kind: 'fix', description: '登录失败无反馈' })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('## 追加任务')
    expect(raw).toMatch(/- \[open\] \[fix\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| 登录失败无反馈/)
    const appendIdx = raw.indexOf('## 追加任务')
    const execIdx = raw.indexOf('## 执行记录')
    expect(appendIdx).toBeGreaterThan(0)
    expect(execIdx).toBeGreaterThan(appendIdx)
  })

  it('appends to end of existing `## 追加任务` section', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await store.appendItem(id, { kind: 'fix', description: '第一条' })
    await store.appendItem(id, { kind: 'feat', description: '第二条' })
    const raw = await readFile(path, 'utf8')
    const first = raw.indexOf('第一条')
    const second = raw.indexOf('第二条')
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
  })

  it('switches frontmatter `stage` back to plan and labels last_action with kind', async () => {
    const { store, cwd } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    const initial = await readFile(path, 'utf8')
    await writeFile(path, initial.replace('stage: plan', 'stage: execute'), 'utf8')
    const later = new SpecStore({ cwd, now: () => new Date('2026-06-20T08:00:00Z') })
    await later.appendItem(id, { kind: 'refct', description: '抽取登录逻辑' })
    const raw = await readFile(path, 'utf8')
    const header = raw.split('---')[1]!.trim().split('\n')
    expect(header[0]).toBe('stage: plan')
    expect(header[1]).toBe('last_action: 追加任务（refct）')
    expect(header[2]).toBe('updated_at: 2026-06-20')
    expect(header[3]).toBe('summary: x')
  })

  it('writes correct kind marker for feat / refct / fix', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await store.appendItem(id, { kind: 'feat', description: 'aaa' })
    await store.appendItem(id, { kind: 'refct', description: 'bbb' })
    await store.appendItem(id, { kind: 'fix', description: 'ccc' })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('[open] [feat]')
    expect(raw).toContain('[open] [refct]')
    expect(raw).toContain('[open] [fix]')
  })

  it('rejects unknown kind and empty description', async () => {
    const { store } = await makeStore()
    const { id } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await expect(
      // @ts-expect-error: testing runtime guard
      store.appendItem(id, { kind: 'bug', description: 'x' }),
    ).rejects.toThrow(/kind/)
    await expect(store.appendItem(id, { kind: 'fix', description: '   ' })).rejects.toThrow(
      /description/,
    )
  })

  it('preserves optional sectionPath and quote sub-items', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await store.appendItem(id, {
      kind: 'fix',
      description: 'a bug',
      sectionPath: '3.1 GUI 现状',
      quote: 'some quoted text',
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('  - 引用：3.1 GUI 现状')
    expect(raw).toContain('  - 引用原文：> some quoted text')
  })
})

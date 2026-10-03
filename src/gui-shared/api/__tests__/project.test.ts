import { describe, expect, it } from 'vitest'
import { groupProjects, type ProjectListItem } from '../project.js'

/** 造一个普通项目行。 */
function proj(id: string, name = id): ProjectListItem {
  return { id, name, path: `/repos/${id}`, lastActivityAt: null, running: false }
}

/** 造一个指向 mainId 的 worktree 行。 */
function wt(id: string, mainId: string, name = mainId): ProjectListItem {
  return {
    id,
    name,
    path: `/repos/${mainId}.wt/${id}`,
    lastActivityAt: null,
    running: false,
    worktree: {
      mainProjectId: mainId,
      mainPath: `/repos/${mainId}`,
      branch: `wt/${id}`,
      specId: `spec-${id}`,
      createdAt: '2026-01-01 00:00:00',
    },
  }
}

describe('groupProjects', () => {
  it('把 worktree 紧随其源项目排列，并标注组内序号', () => {
    // 后端扁平序（活动降序）：源 A、A 的两个 worktree 彼此分散、独立 B 穿插其间
    const flat = [wt('a1', 'A'), proj('B'), proj('A', 'Yorz'), wt('a2', 'A')]
    const rows = groupProjects(flat)
    const ids = rows.map((r) => r.project.id)
    // A 组最新成员是 a1（下标 0），故整组顶到最前；组长 A 置顶，worktree 按原序 a1、a2
    expect(ids).toEqual(['A', 'a1', 'a2', 'B'])

    const [a, a1, a2, b] = rows
    expect(a!.grouped).toBe(true)
    expect(a!.indexInGroup).toBe(0)
    expect(a1!.indexInGroup).toBe(1)
    expect(a2!.indexInGroup).toBe(2)
    expect(a!.groupSize).toBe(3)
    // 全组共用源项目首字母
    expect([a!.letter, a1!.letter, a2!.letter]).toEqual(['Y', 'Y', 'Y'])
    // 独立项 B 非分组
    expect(b!.grouped).toBe(false)
    expect(b!.indexInGroup).toBe(0)
    expect(b!.groupSize).toBe(1)
    expect(b!.letter).toBe('B')
  })

  it('组间按「组内最大新鲜度」排序：活跃 worktree 把老源项目顶上来', () => {
    // C 组：源 C 很老（下标 3），但其 worktree c1 最新（下标 0）→ 整组应排在 D 前
    const flat = [wt('c1', 'C'), proj('D'), proj('E'), proj('C')]
    const rows = groupProjects(flat).map((r) => r.project.id)
    expect(rows).toEqual(['C', 'c1', 'D', 'E'])
  })

  it('单独源项目（无 worktree）视为非分组', () => {
    const rows = groupProjects([proj('A'), proj('B')])
    expect(rows.every((r) => !r.grouped)).toBe(true)
    expect(rows.every((r) => r.groupSize === 1)).toBe(true)
  })

  it('孤儿 worktree（源项目不在列表）按独立项处理', () => {
    const orphan = wt('x1', 'GONE')
    const rows = groupProjects([orphan, proj('B')])
    const x = rows.find((r) => r.project.id === 'x1')!
    expect(x.grouped).toBe(false)
    expect(x.groupId).toBe('x1')
    expect(x.indexInGroup).toBe(0)
  })

  it('空列表返回空数组', () => {
    expect(groupProjects([])).toEqual([])
  })
})

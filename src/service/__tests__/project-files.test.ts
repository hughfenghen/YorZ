import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProjectFilesRoutes, scoreFuzzyPath } from '../routes/project-files.js'
import type { ProjectInstance } from '../project-registry.js'

async function write(root: string, relPath: string): Promise<void> {
  const fullPath = join(root, relPath)
  await mkdir(join(fullPath, '..'), { recursive: true })
  await writeFile(fullPath, relPath, 'utf8')
}

function mockProject(root: string): ProjectInstance {
  return {
    id: 'p1',
    path: root,
    specsDir: join(root, '.yorz', 'specs'),
    specsDirRelative: '.yorz/specs',
    close: async () => {},
  } as unknown as ProjectInstance
}

describe('scoreFuzzyPath', () => {
  it('returns null when query is not a subsequence match', () => {
    expect(scoreFuzzyPath('xyz', 'src/gui/MentionTextarea.tsx')).toBeNull()
  })

  it('prefers consecutive matches over gapped matches', () => {
    const consecutive = scoreFuzzyPath('abc', 'src/abc.ts')
    const gapped = scoreFuzzyPath('abc', 'src/a/b/c.ts')

    expect(consecutive).not.toBeNull()
    expect(gapped).not.toBeNull()
    expect(consecutive!).toBeGreaterThan(gapped!)
  })

  it('rewards path segment boundaries', () => {
    const boundary = scoreFuzzyPath('mt', 'src/mention-textarea.tsx')
    const middle = scoreFuzzyPath('mt', 'src/some-matching-text.ts')

    expect(boundary).not.toBeNull()
    expect(middle).not.toBeNull()
    expect(boundary!).toBeGreaterThan(middle!)
  })

  it('prefers earlier and tighter matches', () => {
    const focused = scoreFuzzyPath('mention', 'src/MentionTextarea.tsx')
    const late = scoreFuzzyPath('mention', 'src/gui/components/archived/MentionTextarea.tsx')

    expect(focused).not.toBeNull()
    expect(late).not.toBeNull()
    expect(focused!).toBeGreaterThan(late!)
  })
})

describe('GET /projects/:projectId/files', () => {
  it('sorts fuzzy matches by score before depth and path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yorz-project-files-'))
    await write(root, 'src/a/b/c.ts')
    await write(root, 'src/abc.ts')
    await write(root, 'zzz/abc.ts')

    const app = createProjectFilesRoutes(async (id) => (id === 'p1' ? mockProject(root) : null))
    const res = await app.request('/projects/p1/files?query=abc&limit=10')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: string[] }

    expect(body.items).toEqual(['src/abc.ts', 'zzz/abc.ts', 'src/a/b/c.ts'])
  })

  it('keeps depth and path as stable tie breakers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yorz-project-files-'))
    await write(root, 'b/z.ts')
    await write(root, 'a/z.ts')

    const app = createProjectFilesRoutes(async (id) => (id === 'p1' ? mockProject(root) : null))
    const res = await app.request('/projects/p1/files?query=z&limit=10')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: string[] }

    expect(body.items).toEqual(['a/z.ts', 'b/z.ts'])
  })
})

import { Hono } from 'hono'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

const HARDCODED_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'coverage',
  '.cache',
  '.turbo',
  '.vercel',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  'target',
])

const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db'])

const MAX_RESULTS = 100
const MAX_DEPTH = 15
const MAX_SCAN = 5000

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function globToRegex(pattern: string): RegExp {
  let p = pattern.trim()
  const negate = p.startsWith('!')
  if (negate) p = p.slice(1)
  if (p.endsWith('/')) p = p.slice(0, -1)
  if (p.startsWith('/')) p = p.slice(1)
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`(^|/)${escaped}($|/)`)
}

interface IgnoreEntry {
  regex: RegExp
  negate: boolean
}

async function parseGitignore(dir: string): Promise<IgnoreEntry[]> {
  let raw: string
  try {
    raw = await readFile(join(dir, '.gitignore'), 'utf8')
  } catch {
    return []
  }
  const entries: IgnoreEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    entries.push({
      regex: globToRegex(trimmed),
      negate: trimmed.startsWith('!'),
    })
  }
  return entries
}

function isIgnored(posixPath: string, entries: IgnoreEntry[]): boolean {
  let ignored = false
  for (const entry of entries) {
    if (entry.regex.test(posixPath)) {
      ignored = !entry.negate
    }
  }
  return ignored
}

interface CollectedFile {
  path: string
  depth: number
  mtime: number
}

async function walk(
  root: string,
  dir: string,
  query: string,
  ignoreStack: IgnoreEntry[],
  results: CollectedFile[],
  scanCount: { n: number },
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH || results.length >= MAX_SCAN) return

  const dirIgnore = await parseGitignore(dir)
  const combined = dirIgnore.length > 0 ? [...ignoreStack, ...dirIgnore] : ignoreStack

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (scanCount.n >= MAX_SCAN) return
    scanCount.n++

    const fullPath = join(dir, entry.name)
    const relPath = toPosix(relative(root, fullPath))

    if (entry.isDirectory()) {
      if (HARDCODED_IGNORE_DIRS.has(entry.name)) continue
      if (isIgnored(relPath + '/', combined)) continue
      await walk(root, fullPath, query, combined, results, scanCount, depth + 1)
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue
      if (isIgnored(relPath, combined)) continue
      if (query && !fuzzyMatch(query, relPath)) continue
      try {
        const s = await stat(fullPath)
        results.push({ path: relPath, depth, mtime: s.mtimeMs })
      } catch {
        results.push({ path: relPath, depth, mtime: 0 })
      }
    }
  }
}

export function createProjectFilesRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.get('/projects/:projectId/files', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p

    const query = (c.req.query('query') ?? '').trim()
    if (query.includes('..')) {
      return c.json({ error: 'invalid query' }, 400)
    }

    const limitRaw = parseInt(c.req.query('limit') ?? '50', 10)
    const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), MAX_RESULTS)

    const results: CollectedFile[] = []
    const scanCount = { n: 0 }
    await walk(p.path, p.path, query, [], results, scanCount, 0)

    if (query) {
      results.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth
        return a.path.localeCompare(b.path)
      })
    } else {
      results.sort((a, b) => b.mtime - a.mtime)
    }

    const items = results.slice(0, limit).map((r) => r.path)
    return c.json({ items })
  })

  return app
}

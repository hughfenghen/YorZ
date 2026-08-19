import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout
}

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

/** Boots the service on a throwaway git repo and returns its project API prefix. */
async function startInRepo() {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-git-routes-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-git-routes-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  await git(cwd, ['init', '-q', '-b', 'main'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
  await git(cwd, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(cwd, 'seed.txt'), 'seed\n', 'utf8')
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-q', '-m', 'init'])

  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  const list = await handle.registry.list()
  const projectId = list[0]!.id
  return { cwd, apiPrefix: `${handle.url}api/projects/${projectId}` }
}

const postJson = (url: string, body: unknown = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('GET /git/changes', () => {
  it('lists working-tree changes without a spec id', async () => {
    const { cwd, apiPrefix } = await startInRepo()
    await writeFile(join(cwd, 'new.txt'), 'x\n', 'utf8')

    const res = await fetch(`${apiPrefix}/git/changes`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { changes: Array<{ path: string; status: string }> }
    expect(body.changes.find((c) => c.path === 'new.txt')?.status).toBe('??')
  })

  it('404s for an unknown project', async () => {
    const { apiPrefix } = await startInRepo()
    const bogus = apiPrefix.replace(/projects\/[^/]+$/, 'projects/nope')
    expect((await fetch(`${bogus}/git/changes`)).status).toBe(404)
  })
})

describe('GET /git/diff', () => {
  it('returns a unified patch for one file', async () => {
    const { cwd, apiPrefix } = await startInRepo()
    await writeFile(join(cwd, 'seed.txt'), 'changed\n', 'utf8')

    const res = await fetch(`${apiPrefix}/git/diff?path=seed.txt`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { patch: string; binary: boolean }
    expect(body.binary).toBe(false)
    expect(body.patch).toContain('+changed')
  })

  it('400s without a path and for out-of-tree paths', async () => {
    const { apiPrefix } = await startInRepo()
    expect((await fetch(`${apiPrefix}/git/diff`)).status).toBe(400)
    expect(
      (await fetch(`${apiPrefix}/git/diff?path=${encodeURIComponent('../escape.txt')}`)).status,
    ).toBe(400)
  })
})

describe('POST /git/commit', () => {
  it('commits the selected paths', async () => {
    const { cwd, apiPrefix } = await startInRepo()
    await writeFile(join(cwd, 'a.txt'), 'a\n', 'utf8')

    const res = await postJson(`${apiPrefix}/git/commit`, { message: 'add a', paths: ['a.txt'] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { commit: string }
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/)
    expect((await git(cwd, ['log', '-1', '--pretty=%s'])).trim()).toBe('add a')
  })

  it('400s on empty message or empty paths', async () => {
    const { apiPrefix } = await startInRepo()
    expect((await postJson(`${apiPrefix}/git/commit`, { message: '', paths: ['a'] })).status).toBe(
      400,
    )
    expect((await postJson(`${apiPrefix}/git/commit`, { message: 'm', paths: [] })).status).toBe(
      400,
    )
  })
})

describe('POST /git/discard', () => {
  it('drops the selected changes', async () => {
    const { cwd, apiPrefix } = await startInRepo()
    await writeFile(join(cwd, 'seed.txt'), 'dirty\n', 'utf8')

    const res = await postJson(`${apiPrefix}/git/discard`, { paths: ['seed.txt'] })
    expect(res.status).toBe(200)
    expect((await git(cwd, ['status', '--porcelain'])).trim()).toBe('')
  })

  it('400s on empty paths', async () => {
    const { apiPrefix } = await startInRepo()
    expect((await postJson(`${apiPrefix}/git/discard`, { paths: [] })).status).toBe(400)
  })
})

describe('POST /git/push and /git/pull', () => {
  it('pushes to origin and reports the created upstream', async () => {
    const { cwd, apiPrefix } = await startInRepo()
    const remote = await mkdtemp(join(tmpdir(), 'yorz-git-routes-remote-'))
    await git(remote, ['init', '-q', '--bare', '-b', 'main'])
    await git(cwd, ['remote', 'add', 'origin', remote])

    const res = await postJson(`${apiPrefix}/git/push`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, branch: 'main', createdUpstream: true })

    const pulled = await postJson(`${apiPrefix}/git/pull`)
    expect(pulled.status).toBe(200)
    expect(await pulled.json()).toMatchObject({ ok: true, branch: 'main', updated: false })
  })

  it('400s with git stderr when there is no remote', async () => {
    const { apiPrefix } = await startInRepo()
    const res = await postJson(`${apiPrefix}/git/push`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })
})

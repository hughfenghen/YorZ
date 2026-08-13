import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { promisify } from 'node:util'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { createApp } from '../server.js'
import { ProjectRegistry } from '../project-registry.js'
import { configureLogger, getLogger } from '../logger.js'

const execFileP = promisify(execFile)
const previousWatchUsePolling = process.env.YORZ_WATCH_USE_POLLING
process.env.YORZ_WATCH_USE_POLLING = '1'

async function gitInTmp(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout
}

async function initGitRepoIn(cwd: string): Promise<void> {
  await gitInTmp(cwd, ['init', '-q', '-b', 'main'])
  await gitInTmp(cwd, ['config', 'user.email', 'test@example.com'])
  await gitInTmp(cwd, ['config', 'user.name', 'Test'])
  await gitInTmp(cwd, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(cwd, '.gitkeep'), '', 'utf8')
  await gitInTmp(cwd, ['add', '.'])
  await gitInTmp(cwd, ['commit', '-q', '-m', 'init'])
}

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

afterAll(() => {
  if (previousWatchUsePolling === undefined) delete process.env.YORZ_WATCH_USE_POLLING
  else process.env.YORZ_WATCH_USE_POLLING = previousWatchUsePolling
})

async function startInTmp() {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-service-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-service-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  const list = await handle.registry.list()
  const projectId = list[0]!.id
  return {
    cwd,
    url: handle.url,
    port: handle.port,
    projectId,
    apiPrefix: `${handle.url}api/projects/${projectId}`,
    apiRoot: `${handle.url}api`,
  }
}

// Opens the multiplexed SSE stream, waits for the connection-level ready frame,
// then POSTs the subscribe body. Returns the reader positioned right after the
// initial ready frame so callers can search for topic-scoped `msg` frames.
async function openMultiplex(
  apiRoot: string,
  topics: string[],
): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>
  decoder: TextDecoder
  clientId: string
}> {
  const clientId = `test-${Math.random().toString(36).slice(2)}`
  const sseRes = await fetch(`${apiRoot}/events/stream?clientId=${clientId}`, {
    headers: { accept: 'text/event-stream' },
  })
  const reader = sseRes.body!.getReader()
  const decoder = new TextDecoder()
  try {
    await readUntil(reader, decoder, (t) => t.includes(`"clientId":"${clientId}"`))
    const subRes = await fetch(`${apiRoot}/events/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, topics }),
    })
    if (!subRes.ok) throw new Error(`subscribe failed: ${subRes.status}`)
    return { reader, decoder, clientId }
  } catch (err) {
    await reader.cancel().catch(() => {})
    throw err
  }
}

describe('YorZ Service HTTP', () => {
  it('rejects non-loopback bind addresses before exposing command APIs', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-service-cfg-'))
    const attempt = start({
      host: '0.0.0.0',
      port: 0,
      noRegisterCwd: true,
      globalConfigPath: join(cfgDir, 'config.json'),
    }).then(async (started) => {
      // 旧实现会成功监听；先关闭它，确保 RED 测试不会泄漏端口或全局资源。
      await started.close()
      return started
    })

    await expect(attempt).rejects.toThrow(/loopback/i)
  })

  it('POST /api/specs creates spec and GET /api/specs lists it', async () => {
    const { apiPrefix } = await startInTmp()
    const createRes = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Spec',
        type: 'feat',
        summary: 'a test spec',
        requirement: 'requirement body',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; path: string }
    expect(created.id).toMatch(/^\d{6}\.feat\./)

    const listRes = await fetch(`${apiPrefix}/specs`)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { id: string; title: string }[]
    expect(list.some((s) => s.id === created.id && s.title === 'Test Spec')).toBe(true)

    const detailRes = await fetch(`${apiPrefix}/specs/${created.id}`)
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as { frontmatter: { stage: string }; body: string }
    expect(detail.frontmatter.stage).toBe('plan')
    expect(detail.body).toContain('requirement body')
  })

  it('specs-list topic emits list-updated when a new spec lands externally', async () => {
    const { cwd, apiRoot, projectId } = await startInTmp()
    const { reader, decoder } = await openMultiplex(apiRoot, [`project:${projectId}:specs`])
    try {
      // Wait for the topic ready ack before triggering the filesystem write to
      // ensure the watcher is fully attached.
      await readUntil(reader, decoder, (t) => t.includes('"event":"ready"'), 2000)

      // Self-writes via the SpecStore are suppressed by the watcher's echo guard;
      // simulate the real flow (Agent writes the file directly) by using fs.
      await new Promise((r) => setTimeout(r, 200))
      const { mkdir, writeFile } = await import('node:fs/promises')
      const dir = join(cwd, '.yorz', 'specs', '260614.feat.external')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'spec.md'),
        [
          '---',
          'stage: plan',
          'last_action: ext',
          'updated_at: 2026-06-14',
          'summary: ext',
          '---',
          '',
          '# Ext',
          '',
        ].join('\n'),
        'utf8',
      )

      const evt = await readUntil(
        reader,
        decoder,
        (t) => t.includes('"event":"list-updated"'),
        6000,
      )
      expect(evt).toContain('list-updated')
    } finally {
      await reader.cancel().catch(() => {})
    }
  })

  it('POST /api/specs/:id/inputs annotate writes ！！！ block and resets stage', async () => {
    const { cwd, apiPrefix } = await startInTmp()
    const create = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${apiPrefix}/specs/${id}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'annotate',
        sectionPath: '1. 背景',
        quote: '现状不佳',
        note: '改为 X',
      }),
    })
    expect(res.status).toBe(200)
    const raw = await readFile(join(cwd, '.yorz', 'specs', id, 'spec.md'), 'utf8')
    expect(raw).toContain('> 1. 背景 中 "现状不佳"')
    expect(raw).toContain('> ！！！改为 X')
    expect(raw).toContain('stage: plan')
  })

  it('spec topic pushes updated event when underlying file changes', async () => {
    const { cwd, apiPrefix, apiRoot, projectId } = await startInTmp()
    const create = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Watch Me', type: 'fix', summary: 'watch summary' }),
    })
    const { id } = (await create.json()) as { id: string }

    const { reader, decoder } = await openMultiplex(apiRoot, [`project:${projectId}:spec:${id}`])
    try {
      const ready = await readUntil(reader, decoder, (t) => t.includes('"event":"ready"'))
      expect(ready).toContain('"event":"ready"')

      await new Promise((r) => setTimeout(r, 200))
      const specPath = join(cwd, '.yorz', 'specs', id, 'spec.md')
      const original = await readFile(specPath, 'utf8')
      let keepWriting = true
      const writer = (async () => {
        for (let i = 0; keepWriting; i++) {
          await writeFile(specPath, `${original}\n\nedited externally ${i}\n`, 'utf8')
          await new Promise((r) => setTimeout(r, 250))
        }
      })()

      try {
        const updated = await readUntil(
          reader,
          decoder,
          (t) => t.includes('"event":"updated"'),
          8000,
        )
        expect(updated).toContain('"event":"updated"')
      } finally {
        keepWriting = false
        await writer.catch(() => {})
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }, 12_000)

  it('returns 404 for unknown spec', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/specs/does-not-exist`)
    expect(res.status).toBe(404)
  })

  it('400 on invalid type when creating spec', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'bogus' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /specs/:id/session is a read-only probe: null when unbound, no session created', async () => {
    const { cwd, apiPrefix } = await startInTmp()
    const create = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Probe', type: 'feat', summary: 'probe' }),
    })
    const { id } = (await create.json()) as { id: string }

    const res = await fetch(`${apiPrefix}/specs/${id}/session`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessionId: null, kind: null, running: false })

    // Merely probing must not mint a ghost session into the index. (Asserted on
    // the index file rather than GET /sessions: that route scans every native
    // adapter's on-disk transcripts, which is far too heavy for a route test.)
    const indexPath = join(cwd, '.yorz', 'tmp', 'sessions', 'index.json')
    await expect(readFile(indexPath, 'utf8')).rejects.toThrow()
  })

  it('project-level sessions topic accepts subscription and acks ready', async () => {
    const { apiRoot, projectId } = await startInTmp()
    const { reader, decoder } = await openMultiplex(apiRoot, [`project:${projectId}:sessions`])
    try {
      const frame = await readUntil(reader, decoder, (t) => t.includes('"event":"ready"'), 2000)
      expect(frame).toContain(`project:${projectId}:sessions`)
    } finally {
      await reader.cancel().catch(() => {})
    }
  })

  it('projects topic emits projects-changed when a worktree project is created', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-service-worktree-'))
    const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-service-cfg-'))
    await mkdir(join(cwd, '.yorz'), { recursive: true })
    await initGitRepoIn(cwd)
    handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
    const list = await handle.registry.list()
    const projectId = list[0]!.id
    const apiRoot = `${handle.url}api`

    const { reader, decoder } = await openMultiplex(apiRoot, ['projects'])
    try {
      await readUntil(reader, decoder, (t) => t.includes('"event":"ready"'), 2000)
      const res = await fetch(`${apiRoot}/projects/${projectId}/worktrees`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specSlug: 'sidebar-refresh' }),
      })
      expect(res.status).toBe(201)

      const evt = await readUntil(
        reader,
        decoder,
        (t) => t.includes('"event":"projects-changed"'),
        4000,
      )
      expect(evt).toContain('projects-changed')
    } finally {
      await reader.cancel().catch(() => {})
    }
  })

  it('GET/PUT /api/global-config reads and saves session end notifications', async () => {
    const { apiRoot } = await startInTmp()
    const initial = await fetch(`${apiRoot}/global-config`)
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({
      agent: { defaultKind: 'claude' },
      notifications: { sessionEnd: { banner: false, sound: false } },
      shortcuts: {},
      power: { inhibitWhenRunning: 'system-default' },
      appearance: { themeMode: 'system', themeName: 'terminal', language: 'zh-CN' },
      customInstructions: [],
    })

    const update = await fetch(`${apiRoot}/global-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { defaultKind: 'codex' },
        notifications: { sessionEnd: { banner: true, sound: true } },
        shortcuts: { newSpec: 'Ctrl+Shift+K' },
        power: { inhibitWhenRunning: 'prevent-display-sleep' },
        appearance: { themeMode: 'dark', themeName: 'paper', language: 'en' },
        customInstructions: [
          {
            id: 'commit',
            name: 'commit',
            description: 'Commit files',
            hiddenPrompt: 'Commit related files',
            prefill: '/commit ',
            createdAt: 1785511681636,
          },
        ],
      }),
    })
    expect(update.status).toBe(200)

    const saved = await fetch(`${apiRoot}/global-config`)
    expect(await saved.json()).toEqual({
      agent: { defaultKind: 'codex' },
      notifications: { sessionEnd: { banner: true, sound: true } },
      shortcuts: { newSpec: 'Ctrl+Shift+K' },
      power: { inhibitWhenRunning: 'prevent-display-sleep' },
      appearance: { themeMode: 'dark', themeName: 'paper', language: 'en' },
      customInstructions: [
        {
          id: 'commit',
          name: 'commit',
          description: 'Commit files',
          hiddenPrompt: 'Commit related files',
          prefill: '/commit ',
          createdAt: 1785511681636,
        },
      ],
    })
  })

  it('PUT /api/global-config rejects non-boolean notification values', async () => {
    const { apiRoot } = await startInTmp()
    const res = await fetch(`${apiRoot}/global-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: 'yes', sound: false } },
        shortcuts: {},
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/global-config rejects invalid appearance values', async () => {
    const { apiRoot } = await startInTmp()
    const res = await fetch(`${apiRoot}/global-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
        appearance: { themeMode: 'blue', themeName: 'paper', language: 'en' },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/global-config rejects invalid shortcuts', async () => {
    const { apiRoot } = await startInTmp()
    const res = await fetch(`${apiRoot}/global-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: { newSpec: 1 },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/global-config accepts legacy bodies without shortcuts', async () => {
    const { apiRoot } = await startInTmp()
    const res = await fetch(`${apiRoot}/global-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ config: { shortcuts: {} } })
  })

  it('400 when annotate body is missing required fields', async () => {
    const { apiPrefix } = await startInTmp()
    const create = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X', type: 'feat', summary: 'x' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${apiPrefix}/specs/${id}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'annotate', sectionPath: 's', quote: '', note: 'n' }),
    })
    expect(res.status).toBe(400)
  })
})

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  predicate: (text: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  let accumulated = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<{ value?: Uint8Array; done: boolean }>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), remaining)
    })
    const next = (await Promise.race([reader.read(), timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })) as { value?: Uint8Array; done: boolean }
    if (next.done) break
    if (next.value) accumulated += decoder.decode(next.value, { stream: true })
    if (predicate(accumulated)) return accumulated
  }
  throw new Error(`SSE predicate not satisfied; received: ${accumulated}`)
}

describe('service logging', () => {
  /** Point the process-wide logger at a throwaway dir for the duration of `fn`. */
  async function withLogDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const previousDir = getLogger().dir
    const dir = await mkdtemp(join(tmpdir(), 'yorz-service-logs-'))
    configureLogger({ dir, level: 'debug', mirrorConsole: false })
    try {
      await fn(dir)
    } finally {
      configureLogger({ dir: previousDir, level: 'info', mirrorConsole: false })
      await rm(dir, { recursive: true, force: true })
    }
  }

  it('writes a startup line to serve.log', async () => {
    await withLogDir(async (dir) => {
      await startInTmp()
      await getLogger().flush()
      const body = await readFile(join(dir, 'serve.log'), 'utf8')
      expect(body).toContain('[info] [serve] service ready')
      expect(body).toContain(`"port":${handle!.port}`)
      expect(body).toContain(`"pid":${process.pid}`)
    })
  })

  it('logs route errors at [error] [http] with method and path', async () => {
    await withLogDir(async (dir) => {
      const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-service-cfg-'))
      const registry = new ProjectRegistry({ globalConfigPath: join(cfgDir, 'config.json') })
      const app = createApp({ registry })
      // POST is not claimed by the API sub-app nor the static SPA fallback, so
      // this reaches our handler and exercises the real `app.onError`.
      app.post('/boom', () => {
        throw new Error('exploded on purpose')
      })

      const res = await app.request('/boom', { method: 'POST' })
      expect(res.status).toBe(500)
      await getLogger().flush()

      const body = await readFile(join(dir, 'serve.log'), 'utf8')
      expect(body).toContain('[error] [http] route error')
      expect(body).toContain('"path":"/boom"')
      expect(body).toContain('exploded on purpose')
      await registry.closeAll()
    })
  })

  it('records non-2xx responses at warn and successful ones at debug', async () => {
    await withLogDir(async (dir) => {
      const { apiRoot } = await startInTmp()
      await fetch(`${apiRoot}/projects`)
      await fetch(`${apiRoot}/definitely-not-a-route`)
      await getLogger().flush()

      const body = await readFile(join(dir, 'serve.log'), 'utf8')
      expect(body).toContain('[debug] [http] request {"method":"GET","path":"/api/projects"')
      expect(body).toContain('[warn] [http] request failed')
      expect(body).toContain('"path":"/api/definitely-not-a-route"')
    })
  })

  it('never writes prompt bodies for agent dispatch logs', async () => {
    await withLogDir(async (dir) => {
      const logger = getLogger().child('agent')
      logger.info('dispatch start', { sessionId: 's1', runId: 'r1', promptLength: 4096 })
      await getLogger().flush()
      const body = await readFile(join(dir, 'serve.log'), 'utf8')
      expect(body).toContain('"promptLength":4096')
      expect(body).not.toContain('prompt"')
    })
  })
})

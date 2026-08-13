import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { resetCommandManagers } from '../command-manager.js'
import type { CommandDef, CommandRun } from '../command-types.js'

let handle: ServeHandle
let apiPrefix: string
let base: string
let projectId: string

interface Frame {
  topic: string
  event: string
  data: Record<string, unknown>
}

/** Opens the multiplexed SSE stream and collects `msg` frames. */
async function openStream(
  clientId: string,
  topics: string[],
): Promise<{
  frames: Frame[]
  close: () => void
}> {
  const frames: Frame[] = []
  const ac = new AbortController()
  const res = await fetch(`${base}api/events/stream?clientId=${clientId}`, { signal: ac.signal })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const evLine = part.split('\n').find((l) => l.startsWith('event: '))
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
          if (evLine?.slice(7) !== 'msg' || !dataLine) continue
          frames.push(JSON.parse(dataLine.slice(6)) as Frame)
        }
      }
    } catch {
      // aborted
    }
  })()

  const sub = await fetch(`${base}api/events/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, topics }),
  })
  expect(sub.status).toBe(200)
  return { frames, close: () => ac.abort() }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (check()) return true
    await sleep(50)
  }
  return false
}

beforeAll(async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-cmd-sse-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-cmd-sse-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  base = handle.url
  projectId = (await handle.registry.list())[0]?.id ?? ''
  apiPrefix = `${base}api/projects/${projectId}`
})

afterAll(async () => {
  await handle.close()
  resetCommandManagers()
})

describe('command SSE topics', () => {
  it('pushes runs-updated on the project commands topic', async () => {
    const topic = `project:${projectId}:commands`
    const stream = await openStream('c-runs', [topic])
    expect(await waitFor(() => stream.frames.some((f) => f.event === 'runs-updated'))).toBe(true)

    const def = (await (
      await fetch(`${apiPrefix}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'quick', cli: `node -e "console.log('sse-hello')"` }),
      })
    ).json()) as CommandDef

    const before = stream.frames.filter((f) => f.event === 'runs-updated').length
    const run = (await (
      await fetch(`${apiPrefix}/command-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: def.id }),
      })
    ).json()) as CommandRun

    const gotStart = await waitFor(
      () => stream.frames.filter((f) => f.event === 'runs-updated').length > before,
    )
    expect(gotStart).toBe(true)

    // The child exits on its own; the terminal transition is broadcast too.
    const sawExit = await waitFor(() =>
      stream.frames.some(
        (f) =>
          f.event === 'runs-updated' &&
          (f.data.runs as CommandRun[]).some((r) => r.runId === run.runId && r.status === 'exited'),
      ),
    )
    expect(sawExit).toBe(true)
    stream.close()
  })

  it('streams output-appended and run-updated on the per-run topic', async () => {
    const def = (await (
      await fetch(`${apiPrefix}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'forever',
          cli: `node -e "setInterval(()=>console.log('tick'),50)"`,
        }),
      })
    ).json()) as CommandDef
    const run = (await (
      await fetch(`${apiPrefix}/command-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: def.id }),
      })
    ).json()) as CommandRun

    const topic = `project:${projectId}:command:${run.runId}`
    const stream = await openStream('c-one', [topic])

    const gotOutput = await waitFor(() =>
      stream.frames.some(
        (f) => f.event === 'output-appended' && String(f.data.chunk).includes('tick'),
      ),
    )
    expect(gotOutput).toBe(true)

    await fetch(`${apiPrefix}/command-runs/${run.runId}/stop`, { method: 'POST' })
    const gotStatus = await waitFor(() =>
      stream.frames.some(
        (f) => f.event === 'run-updated' && (f.data.run as CommandRun).status === 'killed',
      ),
    )
    expect(gotStatus).toBe(true)
    stream.close()
    await fetch(`${apiPrefix}/command-runs/${run.runId}`, { method: 'DELETE' })
  })

  it('reports an error frame for an unknown runId topic', async () => {
    const stream = await openStream('c-bad', [`project:${projectId}:command:nope`])
    expect(
      await waitFor(() =>
        stream.frames.some(
          (f) => f.event === 'error' && String(f.data.error).includes('command run not found'),
        ),
      ),
    ).toBe(true)
    stream.close()
  })
})

describe('service lifecycle binding', () => {
  it('binds to loopback by default', () => {
    expect(base).toContain('localhost')
  })

  it('handle.close() stops every running command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-cmd-close-'))
    const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-cmd-close-cfg-'))
    await mkdir(join(cwd, '.yorz'), { recursive: true })
    const h = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
    const pid = (await h.registry.list())[0]!.id
    const prefix = `${h.url}api/projects/${pid}`

    const def = (await (
      await fetch(`${prefix}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'forever', cli: `node -e "setInterval(()=>{},1000)"` }),
      })
    ).json()) as CommandDef
    const run = (await (
      await fetch(`${prefix}/command-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: def.id }),
      })
    ).json()) as CommandRun
    expect(run.pid).toBeGreaterThan(0)

    await h.close()
    const dead = await waitFor(() => {
      try {
        process.kill(run.pid, 0)
        return false
      } catch {
        return true
      }
    })
    expect(dead).toBe(true)
    resetCommandManagers()
  })
})

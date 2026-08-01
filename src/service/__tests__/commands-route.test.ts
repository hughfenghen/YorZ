import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { resetCommandManagers } from '../command-manager.js'
import type { CommandDef, CommandRun } from '../command-types.js'

interface Svc {
  url: string
  projectId: string
  apiPrefix: string
  handle: ServeHandle
}

let svc: Svc

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await check()) return true
    await sleep(50)
  }
  return false
}

async function addDef(name: string, cli: string): Promise<CommandDef> {
  const res = await fetch(`${svc.apiPrefix}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, cli }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as CommandDef
}

async function getRun(runId: string): Promise<CommandRun> {
  const res = await fetch(`${svc.apiPrefix}/command-runs/${runId}`)
  expect(res.status).toBe(200)
  return (await res.json()) as CommandRun
}

beforeAll(async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-cmd-route-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-cmd-route-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  const handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'projects.json') })
  const projectId = (await handle.registry.list())[0]?.id ?? ''
  if (!projectId) throw new Error('project was not auto-registered')
  svc = { url: handle.url, projectId, apiPrefix: `${handle.url}api/projects/${projectId}`, handle }
})

afterAll(async () => {
  await svc.handle.close()
  resetCommandManagers()
})

describe('commands routes — definitions', () => {
  it('lists, creates and deletes definitions', async () => {
    const empty = await fetch(`${svc.apiPrefix}/commands`)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual([])

    const def = await addDef('echo', 'echo hi')
    expect(def).toMatchObject({ name: 'echo', cli: 'echo hi' })

    const list = (await (await fetch(`${svc.apiPrefix}/commands`)).json()) as CommandDef[]
    expect(list.map((d) => d.id)).toContain(def.id)

    const del = await fetch(`${svc.apiPrefix}/commands/${def.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await del.json()).toEqual({ ok: true })

    const delAgain = await fetch(`${svc.apiPrefix}/commands/${def.id}`, { method: 'DELETE' })
    expect(delAgain.status).toBe(404)
  })

  it('rejects a body without name or cli', async () => {
    for (const body of [{}, { name: 'x' }, { cli: 'ls' }, { name: '  ', cli: 'ls' }]) {
      const res = await fetch(`${svc.apiPrefix}/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
  })

  it('404s for an unknown project', async () => {
    const res = await fetch(`${svc.url}api/projects/does-not-exist/commands`)
    expect(res.status).toBe(404)
  })
})

describe('commands routes — runs', () => {
  it('runs a command, exposes its output and clears it', async () => {
    const def = await addDef('hello', `node -e "console.log('route-hello')"`)

    const started = await fetch(`${svc.apiPrefix}/command-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: def.id }),
    })
    expect(started.status).toBe(201)
    const run = (await started.json()) as CommandRun
    expect(run.status).toBe('running')

    const listed = (await (await fetch(`${svc.apiPrefix}/command-runs`)).json()) as CommandRun[]
    expect(listed.map((r) => r.runId)).toContain(run.runId)

    expect(await waitFor(async () => (await getRun(run.runId)).status === 'exited')).toBe(true)

    const out = await fetch(`${svc.apiPrefix}/command-runs/${run.runId}/output`)
    expect(out.status).toBe(200)
    const slice = (await out.json()) as { text: string; offset: number; size: number }
    expect(slice.text).toContain('route-hello')
    expect(slice.size).toBeGreaterThan(0)

    const cleared = await fetch(`${svc.apiPrefix}/command-runs/${run.runId}`, { method: 'DELETE' })
    expect(cleared.status).toBe(200)
    const gone = await fetch(`${svc.apiPrefix}/command-runs/${run.runId}`)
    expect(gone.status).toBe(404)
  })

  it('stops a long-running command and keeps the record', async () => {
    const def = await addDef('forever', `node -e "setInterval(()=>console.log('tick'),50)"`)
    const run = (await (
      await fetch(`${svc.apiPrefix}/command-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: def.id }),
      })
    ).json()) as CommandRun

    const stopped = await fetch(`${svc.apiPrefix}/command-runs/${run.runId}/stop`, {
      method: 'POST',
    })
    expect(stopped.status).toBe(200)
    const body = (await stopped.json()) as { ok: boolean; run: CommandRun }
    expect(body.ok).toBe(true)
    expect(body.run.status).toBe('killed')

    // Stop keeps the record so the detail page still renders.
    expect((await getRun(run.runId)).status).toBe('killed')
    await fetch(`${svc.apiPrefix}/command-runs/${run.runId}`, { method: 'DELETE' })
  })

  it('404s for unknown commandId and unknown runId', async () => {
    const badRun = await fetch(`${svc.apiPrefix}/command-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId: 'nope' }),
    })
    expect(badRun.status).toBe(404)

    expect((await fetch(`${svc.apiPrefix}/command-runs/nope`)).status).toBe(404)
    expect((await fetch(`${svc.apiPrefix}/command-runs/nope/output`)).status).toBe(404)
    expect(
      (await fetch(`${svc.apiPrefix}/command-runs/nope/stop`, { method: 'POST' })).status,
    ).toBe(404)
    expect(
      (await fetch(`${svc.apiPrefix}/command-runs/nope`, { method: 'DELETE' })).status,
    ).toBe(404)
  })

  it('rejects a run without commandId and a bad offset', async () => {
    const noId = await fetch(`${svc.apiPrefix}/command-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(noId.status).toBe(400)

    const def = await addDef('quick', `node -e "console.log(1)"`)
    const run = (await (
      await fetch(`${svc.apiPrefix}/command-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId: def.id }),
      })
    ).json()) as CommandRun
    const bad = await fetch(`${svc.apiPrefix}/command-runs/${run.runId}/output?offset=-5`)
    expect(bad.status).toBe(400)
    await fetch(`${svc.apiPrefix}/command-runs/${run.runId}`, { method: 'DELETE' })
  })
})

describe('project config preserves commands', () => {
  it('saving agent/specsDir does not wipe stored command definitions', async () => {
    const def = await addDef('keep-me', 'echo keep')
    const put = await fetch(`${svc.url}api/projects/${svc.projectId}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { kind: 'claude' }, specsDir: '.yorz/specs' }),
    })
    expect(put.status).toBe(200)

    const cfg = (await (
      await fetch(`${svc.url}api/projects/${svc.projectId}/config`)
    ).json()) as { commands: CommandDef[] }
    expect(cfg.commands.map((c) => c.id)).toContain(def.id)
  })
})

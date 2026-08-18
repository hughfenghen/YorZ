import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { loadProjectConfig } from '../project-config.js'
import type { CustomInstruction } from '../custom-instruction.js'

interface Svc {
  cwd: string
  apiPrefix: string
  handle: ServeHandle
}

let svc: Svc

function instruction(over: Partial<CustomInstruction> = {}): CustomInstruction {
  return {
    id: 'p-1',
    name: 'deploy',
    description: '发布当前项目',
    hiddenPrompt: '按项目发布流程执行',
    prefill: '',
    createdAt: 1,
    ...over,
  }
}

async function put(body: unknown): Promise<Response> {
  return fetch(`${svc.apiPrefix}/custom-instructions`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-instr-route-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-instr-route-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  const handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  const projectId = (await handle.registry.list())[0]?.id ?? ''
  if (!projectId) throw new Error('project was not auto-registered')
  svc = { cwd, apiPrefix: `${handle.url}api/projects/${projectId}`, handle }
})

afterAll(async () => {
  await svc.handle.close()
})

describe('project custom instruction routes', () => {
  it('starts empty and round-trips a saved list', async () => {
    const initial = await fetch(`${svc.apiPrefix}/custom-instructions`)
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({ customInstructions: [] })

    const res = await put({ customInstructions: [instruction()] })
    expect(res.status).toBe(200)

    const read = await fetch(`${svc.apiPrefix}/custom-instructions`)
    const body = (await read.json()) as { customInstructions: CustomInstruction[] }
    expect(body.customInstructions).toEqual([instruction()])
    expect((await loadProjectConfig(svc.cwd)).customInstructions).toEqual([instruction()])
  })

  it('rejects an invalid name with 400 and keeps the stored list', async () => {
    const res = await put({ customInstructions: [instruction({ name: 'bad name' })] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('name')
    expect((await loadProjectConfig(svc.cwd)).customInstructions).toHaveLength(1)
  })

  it('accepts the pre-rename systemPrompt key and responds with hiddenPrompt', async () => {
    const legacy = { ...instruction({ id: 'p-legacy', name: 'legacy' }) } as Record<string, unknown>
    delete legacy.hiddenPrompt
    legacy.systemPrompt = 'legacy body'
    const res = await put({ customInstructions: [legacy] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { customInstructions: CustomInstruction[] }
    expect(body.customInstructions[0].hiddenPrompt).toBe('legacy body')
  })

  it('is not wiped by a project config save', async () => {
    await put({ customInstructions: [instruction()] })
    const res = await fetch(`${svc.apiPrefix}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { kind: 'claude' }, specsDir: '.yorz/specs' }),
    })
    expect(res.status).toBe(200)
    expect((await loadProjectConfig(svc.cwd)).customInstructions).toHaveLength(1)
  })

  it('returns 404 for an unknown project', async () => {
    const res = await fetch(`${svc.handle.url}api/projects/nope/custom-instructions`)
    expect(res.status).toBe(404)
  })
})

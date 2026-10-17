import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../registry.js'
import { ClaudeAdapter } from '../claude-adapter.js'

const VALID_MODULE = `
export function createAgentAdapter(ctx) {
  const session = { id: 'sid', async *send() {}, abort() {} }
  return {
    kind: ctx.descriptor.id,
    descriptor: {
      id: ctx.descriptor.id,
      displayName: ctx.descriptor.displayName,
      source: 'external',
      capabilities: { listSessions: false, getMessages: false, usageStatus: false },
    },
    async createSession() { return session },
    async resumeSession(id) { return { ...session, id } },
    async listSessions() { return [] },
    async getMessages() { return [] },
    capabilities() { return this.descriptor.capabilities },
    async dispose() {},
  }
}
`

const NO_FACTORY_MODULE = `export const notAFactory = 1`

const MISSING_METHOD_MODULE = `
export default function createAgentAdapter(ctx) {
  return {
    kind: ctx.descriptor.id,
    descriptor: { id: ctx.descriptor.id, displayName: 'x', source: 'external',
      capabilities: { listSessions: false, getMessages: false, usageStatus: false } },
    async createSession() { return { id: 'x', async *send() {}, abort() {} } },
    // missing resumeSession/listSessions/getMessages/capabilities/dispose
  }
}
`

/**
 * Write a global config declaring `customAgents` plus any module files. External
 * agents are host-global now, so the config + relative module files live in the
 * global config dir (not a project `.yorz/`). Returns both the arbitrary project
 * cwd and the globalConfigPath to inject into the registry.
 */
async function globalWith(customAgents: unknown, files: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-reg-cwd-'))
  const gdir = await mkdtemp(join(tmpdir(), 'yorz-reg-global-'))
  const globalConfigPath = join(gdir, 'config.json')
  await writeFile(globalConfigPath, JSON.stringify({ version: 1, customAgents }, null, 2), 'utf8')
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(gdir, rel, '..'), { recursive: true }).catch(() => {})
    await writeFile(join(gdir, rel), body, 'utf8')
  }
  return { cwd, gdir, globalConfigPath }
}

describe('AdapterRegistry', () => {
  it('resolves builtin ids to their in-process adapters', async () => {
    const reg = new AdapterRegistry(await mkdtemp(join(tmpdir(), 'yorz-reg-')))
    const claude = await reg.get('claude')
    expect(claude).toBeInstanceOf(ClaudeAdapter)
    expect(claude.descriptor).toMatchObject({ id: 'claude', source: 'builtin' })
  })

  it('loads a valid external agent by dynamic import of a config-relative module', async () => {
    const { cwd, globalConfigPath } = await globalWith(
      [{ id: 'ext', name: 'Ext Agent', module: './agents/ext.mjs' }],
      { 'agents/ext.mjs': VALID_MODULE },
    )
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    const ext = await reg.get('ext')
    expect(ext.descriptor).toMatchObject({ id: 'ext', displayName: 'Ext Agent', source: 'external' })
    expect(typeof ext.dispose).toBe('function')
  })

  it('loads a valid external agent by absolute module path (no project-root guard)', async () => {
    const abs = join(await mkdtemp(join(tmpdir(), 'yorz-reg-abs-')), 'ext.mjs')
    await writeFile(abs, VALID_MODULE, 'utf8')
    // Config dir is unrelated to the module location — absolute paths load as-is.
    const { cwd, globalConfigPath } = await globalWith([{ id: 'abs', module: abs }])
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    const ext = await reg.get('abs')
    expect(ext.descriptor).toMatchObject({ id: 'abs', source: 'external' })
  })

  it('falls back to claude for an unknown id', async () => {
    const reg = new AdapterRegistry(await mkdtemp(join(tmpdir(), 'yorz-reg-')))
    const unknown = await reg.get('does-not-exist')
    expect(unknown).toBeInstanceOf(ClaudeAdapter)
  })

  it('falls back to claude when the module exports no factory', async () => {
    const { cwd, globalConfigPath } = await globalWith([{ id: 'bad', module: './agents/bad.mjs' }], {
      'agents/bad.mjs': NO_FACTORY_MODULE,
    })
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    expect(await reg.get('bad')).toBeInstanceOf(ClaudeAdapter)
  })

  it('falls back to claude when the adapter is missing a required method', async () => {
    const { cwd, globalConfigPath } = await globalWith(
      [{ id: 'partial', module: './agents/partial.mjs' }],
      { 'agents/partial.mjs': MISSING_METHOD_MODULE },
    )
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    expect(await reg.get('partial')).toBeInstanceOf(ClaudeAdapter)
  })

  it('falls back to claude when a relative module does not exist', async () => {
    const { cwd, globalConfigPath } = await globalWith([{ id: 'missing', module: './nope.mjs' }])
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    expect(await reg.get('missing')).toBeInstanceOf(ClaudeAdapter)
  })

  it('listDescriptors returns the four builtins plus configured externals', async () => {
    const { cwd, globalConfigPath } = await globalWith(
      [
        { id: 'ext', name: 'Ext Agent', module: './agents/ext.mjs' },
        { id: 'broken', module: './agents/bad.mjs' },
      ],
      { 'agents/ext.mjs': VALID_MODULE, 'agents/bad.mjs': NO_FACTORY_MODULE },
    )
    const reg = new AdapterRegistry(cwd, globalConfigPath)
    const descriptors = await reg.listDescriptors()
    const ids = descriptors.map((d) => d.id)
    expect(ids).toEqual(['claude', 'codex', 'opencode', 'pi', 'ext', 'broken'])
    // A failed external still appears, synthesized as external with caps off.
    const broken = descriptors.find((d) => d.id === 'broken')
    expect(broken).toMatchObject({ source: 'external', displayName: 'broken' })
    expect(broken?.capabilities).toEqual({
      listSessions: false,
      getMessages: false,
      usageStatus: false,
    })
  })
})

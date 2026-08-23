import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { CommandManager, resetCommandManagers } from '../command-manager.js'
import { SessionManager } from '../session-manager.js'
import { SessionStore } from '../session-store.js'
import type { AgentEvent, AgentSdkAdapter, AgentSession } from '../agent-sdk/types.js'
import { generateProjectId } from '../global-config.js'
import {
  TELEMETRY_FILE_NAME,
  flushTelemetry,
  resetTelemetry,
  resolveMetricsDir,
  resolveTelemetryFile,
  type TelemetryEnvelope,
} from '../telemetry/index.js'

const execFileP = promisify(execFile)

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
  resetTelemetry()
})

/** Read the shared file back, keeping only the lines of this test's project. */
async function readEvents(cwd: string): Promise<TelemetryEnvelope[]> {
  await flushTelemetry()
  const file = resolveTelemetryFile()
  if (!existsSync(file)) return []
  const projectId = generateProjectId(resolve(cwd))
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TelemetryEnvelope)
    .filter((l) => l.projectId === projectId)
}

/** Boots the real service on a throwaway git repo. */
async function startInRepo() {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-telemetry-int-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-telemetry-int-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  await execFileP('git', ['init', '-q', '-b', 'main'], { cwd })
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  const list = await handle.registry.list()
  const projectId = list[0]!.id
  return { cwd, apiPrefix: `${handle.url}api/projects/${projectId}` }
}

describe('telemetry around a dispatch', () => {
  it('records dispatch start/end, turn usage and compaction under one traceId', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-telemetry-dispatch-'))
    const store = new SessionStore(cwd)
    const mgr = new SessionManager(cwd, 'claude', store)
    const adapter: AgentSdkAdapter = {
      kind: 'claude',
      createSession: async () => makeStubSession('s1'),
      resumeSession: async (id: string) => makeStubSession(id),
      listSessions: async () => [],
      getMessages: async () => [],
      capabilities: () => ({ listSessions: false, getMessages: false, usageStatus: false }),
    }
    ;(mgr as unknown as { adapters: unknown }).adapters = {
      get: () => adapter,
      dispose: async () => {},
    }

    const handleRun = await mgr.send('s1', 'hello', undefined, {
      trigger: 'run',
      specId: '260819.feat.demo',
    })
    await new Promise<void>((resolve) => handleRun.onDone(() => resolve()))

    const events = await readEvents(cwd)
    const byEvent = (name: string) => events.filter((e) => e.event === name)
    expect(byEvent('agent.dispatch').map((e) => e.phase)).toEqual(['start', 'end'])
    expect(byEvent('agent.dispatch').at(-1)).toMatchObject({
      ok: true,
      trigger: 'run',
      specId: '260819.feat.demo',
      agentKind: 'claude',
    })
    expect(byEvent('agent.turn')[0]).toMatchObject({
      trigger: 'run',
      specId: '260819.feat.demo',
      usage: { inputTokens: 10, outputTokens: 2 },
      numTurns: 2,
    })
    expect(byEvent('agent.compact')[0]).toMatchObject({
      compactTrigger: 'auto',
      preTokens: 900,
      postTokens: 100,
      // the dispatch trigger survives alongside the compaction trigger
      trigger: 'run',
    })
    // one dispatch → one traceId across every event it produced
    expect(new Set(events.map((e) => e.traceId))).toEqual(new Set([handleRun.runId]))
    await mgr.dispose()
  })
})

function makeStubSession(id: string): AgentSession {
  return {
    id,
    send: async function* () {
      yield {
        type: 'compact',
        metrics: { trigger: 'auto', preTokens: 900, postTokens: 100 },
      } satisfies AgentEvent
      yield {
        type: 'turn-completed',
        usage: { input_tokens: 10, output_tokens: 2 },
        metrics: { usage: { inputTokens: 10, outputTokens: 2 }, numTurns: 2 },
      } satisfies AgentEvent
    },
    abort: () => {},
  }
}

describe('telemetry around a project command', () => {
  it('records cmd.exec with the final status and exit code', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-telemetry-cmd-'))
    const mgr = new CommandManager(cwd)
    try {
      const def = await mgr.addDef('noop', 'node -e "process.exit(3)"')
      const run = await mgr.run(def.id)
      let events: TelemetryEnvelope[] = []
      for (let i = 0; i < 60 && events.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50))
        events = (await readEvents(cwd)).filter((e) => e.event === 'cmd.exec')
      }
      expect(events[0]).toMatchObject({
        commandId: def.id,
        name: 'noop',
        runId: run.runId,
        status: 'exited',
        exitCode: 3,
      })
      expect(typeof events[0]?.durMs).toBe('number')
    } finally {
      await mgr.stopAll().catch(() => {})
      resetCommandManagers()
    }
  })
})

describe('telemetry housekeeping at service startup', () => {
  it('folds a legacy per-project directory into the shared file', async () => {
    const legacyRoot = '/tmp/yorz-legacy-project'
    const legacyId = generateProjectId(legacyRoot)
    const legacyDir = join(resolveMetricsDir(), legacyId)
    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      join(legacyDir, TELEMETRY_FILE_NAME),
      [
        // v1 shape: string ts, plus one of the retired event kinds
        `${JSON.stringify({ v: 1, ts: '2026-08-19 10:00:00', event: 'agent.turn', projectId: legacyId })}\n`,
        `${JSON.stringify({ v: 1, ts: '2026-08-19 10:00:01', event: 'git.op', projectId: legacyId })}\n`,
      ].join(''),
      'utf8',
    )
    await writeFile(
      join(legacyDir, 'project.json'),
      JSON.stringify({ id: legacyId, path: legacyRoot, firstSeenAt: '2026-08-19 10:00:00' }),
      'utf8',
    )

    await startInRepo()

    expect(existsSync(legacyDir)).toBe(false)
    const migrated = readFileSync(resolveTelemetryFile(), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as TelemetryEnvelope)
      .filter((l) => l.projectId === legacyId)
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({ v: 2, event: 'agent.turn' })
    expect(typeof migrated[0]?.ts).toBe('number')
  })
})

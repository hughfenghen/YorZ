import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandManager, resetCommandManagers } from '../command-manager.js'
import type { CommandRun } from '../command-types.js'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yorz-cmd-mgr-'))
}

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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Best-effort Windows test cleanup for descendants intentionally leaked by the RED implementation. */
function cleanupWindowsTree(pid: number): void {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    // The fixed implementation may already have terminated the process tree.
  }
}

/** A command that keeps printing until killed. */
const FOREVER = `node -e "setInterval(()=>console.log('tick'),50)"`

const started: CommandManager[] = []

async function newManager(): Promise<CommandManager> {
  const m = new CommandManager(await tmp())
  started.push(m)
  return m
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((m) => m.stopAll().catch(() => {})))
  resetCommandManagers()
})

describe('CommandManager definitions', () => {
  it('adds, lists and removes definitions in .yorz/config.json', async () => {
    const m = await newManager()
    expect(await m.listDefs()).toEqual([])
    const def = await m.addDef('  dev  ', '  pnpm dev  ')
    expect(def).toMatchObject({ name: 'dev', cli: 'pnpm dev' })
    expect(def.id).toBeTruthy()

    const raw = JSON.parse(await readFile(join(m.projectPath, '.yorz/config.json'), 'utf8'))
    expect(raw.commands).toHaveLength(1)

    expect(await m.removeDef(def.id)).toBe(true)
    expect(await m.removeDef(def.id)).toBe(false)
    expect(await m.listDefs()).toEqual([])
  })

  it('rejects blank name or cli', async () => {
    const m = await newManager()
    await expect(m.addDef('  ', 'ls')).rejects.toThrow(/name/)
    await expect(m.addDef('x', '   ')).rejects.toThrow(/cli/)
  })
})

describe('CommandManager run lifecycle', () => {
  it('spawns a command, captures stdout to the log file and records the exit', async () => {
    const m = await newManager()
    const def = await m.addDef('hello', `node -e "console.log('hello-from-child')"`)
    const run = await m.run(def.id)
    expect(run.status).toBe('running')
    expect(run.logFile).toBe(`.yorz/tmp/commands/${run.runId}.log`)

    const ended = await waitFor(async () => (await m.getRun(run.runId))?.status === 'exited')
    expect(ended).toBe(true)

    const final = await m.getRun(run.runId)
    expect(final?.exitCode).toBe(0)
    expect(final?.endedAt).toBeGreaterThan(0)

    const logText = await readFile(join(m.projectPath, run.logFile), 'utf8')
    expect(logText).toContain('hello-from-child')
  })

  it('records the terminal status even when the child dies before the record is persisted', async () => {
    const m = await newManager()
    // Invalid shell syntax: /bin/sh bails out almost immediately, so `exit`
    // fires before run()'s first store write lands.
    const def = await m.addDef('broken', 'node -e "syntax ((( error"')
    const run = await m.run(def.id)

    const settled = await waitFor(async () => (await m.getRun(run.runId))?.status !== 'running')
    expect(settled).toBe(true)
    const final = await m.getRun(run.runId)
    expect(final?.status).not.toBe('running')
    expect(final?.endedAt).toBeGreaterThan(0)
  })

  it('reports a non-zero exit code for a failing command', async () => {
    const m = await newManager()
    const def = await m.addDef('fail', `node -e "process.exit(3)"`)
    const run = await m.run(def.id)
    await waitFor(async () => (await m.getRun(run.runId))?.status !== 'running')
    expect((await m.getRun(run.runId))?.exitCode).toBe(3)
  })

  it('merges stderr into the same log file', async () => {
    const m = await newManager()
    const def = await m.addDef('err', `node -e "console.error('to-stderr')"`)
    const run = await m.run(def.id)
    await waitFor(async () => (await m.getRun(run.runId))?.status !== 'running')
    const logText = await readFile(join(m.projectPath, run.logFile), 'utf8')
    expect(logText).toContain('to-stderr')
  })

  it('is idempotent per definition: a second run returns the live record', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const first = await m.run(def.id)
    const second = await m.run(def.id)
    expect(second.runId).toBe(first.runId)
    expect((await m.listRuns()).filter((r) => r.status === 'running')).toHaveLength(1)
  })

  it('rejects an unknown commandId', async () => {
    const m = await newManager()
    await expect(m.run('missing')).rejects.toThrow(/command not found/)
  })

  it('stop terminates the process but keeps the record and log', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const run = await m.run(def.id)
    await waitFor(async () => (await m.readOutput(run.runId)).size > 0)

    const stopped = await m.stop(run.runId)
    expect(stopped.status).toBe('killed')
    expect(await waitFor(async () => !isAlive(run.pid))).toBe(true)

    expect(await m.getRun(run.runId)).toBeTruthy()
    await expect(stat(join(m.projectPath, run.logFile))).resolves.toBeTruthy()
  })

  it.runIf(process.platform === 'win32')(
    'stop terminates the complete Windows process tree',
    async () => {
      const m = await newManager()
      const pidsFile = join(m.projectPath, 'tree-pids.json')
      const script = join(m.projectPath, 'tree.cjs')
      await writeFile(
        script,
        [
          "const { spawn } = require('node:child_process')",
          "const { writeFileSync } = require('node:fs')",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
          `writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, child.pid]))`,
          'setInterval(() => {}, 1000)',
        ].join('\n'),
        'utf8',
      )
      const def = await m.addDef('tree', `node "${script}"`)
      const run = await m.run(def.id)
      let treePids: number[] = []

      try {
        expect(
          await waitFor(async () =>
            stat(pidsFile).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(true)
        treePids = JSON.parse(await readFile(pidsFile, 'utf8')) as number[]
        await m.stop(run.runId)
        expect(await waitFor(async () => treePids.every((pid) => !isAlive(pid)))).toBe(true)
      } finally {
        cleanupWindowsTree(run.pid)
        for (const pid of treePids) cleanupWindowsTree(pid)
      }
    },
  )

  it('stop on an already-finished run is a no-op', async () => {
    const m = await newManager()
    const def = await m.addDef('quick', `node -e "console.log(1)"`)
    const run = await m.run(def.id)
    await waitFor(async () => (await m.getRun(run.runId))?.status === 'exited')
    const again = await m.stop(run.runId)
    expect(again.status).toBe('exited')
  })

  it('clear terminates, drops the record and deletes the log', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const run = await m.run(def.id)

    expect(await m.clear(run.runId)).toBe(true)
    expect(await waitFor(async () => !isAlive(run.pid))).toBe(true)
    expect(await m.getRun(run.runId)).toBeUndefined()
    await expect(stat(join(m.projectPath, run.logFile))).rejects.toThrow()
    expect(await m.clear(run.runId)).toBe(false)
  })
})

describe('CommandManager output', () => {
  it('streams contiguous incremental chunks to subscribers', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const run = await m.run(def.id)

    const chunks: Array<{ offset: number; chunk: string }> = []
    const unsub = m.subscribeOutput(run.runId, (c) => chunks.push(c), 0)
    await waitFor(async () => chunks.length >= 2)
    unsub()

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    let expected = 0
    for (const c of chunks) {
      expect(c.offset).toBe(expected)
      expected += Buffer.byteLength(c.chunk, 'utf8')
    }
  })

  it('stops the tail timer once the last subscriber leaves', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const run = await m.run(def.id)

    const a = m.subscribeOutput(run.runId, () => {}, 0)
    const b = m.subscribeOutput(run.runId, () => {}, 0)
    a()
    const seenAfterB: Array<unknown> = []
    b()
    // With no subscribers the tailer is dropped, so a fresh subscribe restarts
    // it rather than resuming a stale timer.
    const c = m.subscribeOutput(run.runId, (chunk) => seenAfterB.push(chunk))
    expect(await waitFor(async () => seenAfterB.length > 0)).toBe(true)
    c()
  })

  it('readOutput returns the tail and flags truncation for huge logs', async () => {
    const m = await newManager()
    const def = await m.addDef('noop', `node -e "process.exit(0)"`)
    const run = await m.run(def.id)
    await waitFor(async () => (await m.getRun(run.runId))?.status !== 'running')

    const logPath = join(m.projectPath, run.logFile)
    const big = 'x'.repeat(300 * 1024)
    await writeFile(logPath, big, 'utf8')

    const tail = await m.readOutput(run.runId)
    expect(tail.truncated).toBe(true)
    expect(tail.text.length).toBe(256 * 1024)
    expect(tail.offset).toBe(big.length - 256 * 1024)
    expect(tail.size).toBe(big.length)

    const fromOffset = await m.readOutput(run.runId, big.length - 10)
    expect(fromOffset.truncated).toBe(false)
    expect(fromOffset.text).toBe('x'.repeat(10))
  })

  it('readOutput rejects an unknown runId', async () => {
    const m = await newManager()
    await expect(m.readOutput('nope')).rejects.toThrow(/command run not found/)
  })
})

describe('CommandManager lifecycle binding', () => {
  it('stopAll kills every live child', async () => {
    const m = await newManager()
    const def = await m.addDef('forever', FOREVER)
    const a = await m.run(def.id)
    const def2 = await m.addDef('forever2', FOREVER)
    const b = await m.run(def2.id)

    await m.stopAll()
    expect(await waitFor(async () => !isAlive(a.pid) && !isAlive(b.pid))).toBe(true)
    const runs = await m.listRuns()
    expect(runs.every((r) => r.status !== 'running')).toBe(true)
  })

  it('reap marks leftover running records as killed on startup', async () => {
    const cwd = await tmp()
    const leftover: CommandRun = {
      runId: 'stale',
      commandId: 'c1',
      name: 'stale',
      cli: 'true',
      // A pid that is certainly not ours; treated as already dead.
      pid: 2 ** 30,
      status: 'running',
      startedAt: Date.now() - 1000,
      logFile: '.yorz/tmp/commands/stale.log',
    }
    await mkdir(join(cwd, '.yorz/tmp/commands'), { recursive: true })
    await writeFile(
      join(cwd, '.yorz/tmp/commands/index.json'),
      JSON.stringify([leftover], null, 2),
      'utf8',
    )

    const m = new CommandManager(cwd)
    started.push(m)
    const runs = await m.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('killed')
    expect(runs[0]!.endedAt).toBeGreaterThan(0)
  })

  it.runIf(process.platform === 'win32')(
    'reap never kills a live process identified only by a persisted PID',
    async () => {
      const cwd = await tmp()
      const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      unrelated.unref()
      const pid = unrelated.pid!
      const leftover: CommandRun = {
        runId: 'stale-live',
        commandId: 'c1',
        name: 'stale-live',
        cli: 'unknown',
        pid,
        status: 'running',
        startedAt: Date.now() - 1000,
        logFile: '.yorz/tmp/commands/stale-live.log',
      }
      await mkdir(join(cwd, '.yorz/tmp/commands'), { recursive: true })
      await writeFile(
        join(cwd, '.yorz/tmp/commands/index.json'),
        JSON.stringify([leftover], null, 2),
        'utf8',
      )

      try {
        const m = new CommandManager(cwd)
        started.push(m)
        const runs = await m.listRuns()
        expect(runs[0]?.status).toBe('killed')
        expect(isAlive(pid)).toBe(true)
      } finally {
        cleanupWindowsTree(pid)
      }
    },
  )

  it('reap drops records that finished beyond the retention window', async () => {
    const cwd = await tmp()
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000
    const records: CommandRun[] = [
      {
        runId: 'old',
        commandId: 'c1',
        name: 'old',
        cli: 'true',
        pid: 1,
        status: 'exited',
        startedAt: old,
        endedAt: old,
        logFile: '.yorz/tmp/commands/old.log',
      },
      {
        runId: 'recent',
        commandId: 'c2',
        name: 'recent',
        cli: 'true',
        pid: 1,
        status: 'exited',
        startedAt: Date.now(),
        endedAt: Date.now(),
        logFile: '.yorz/tmp/commands/recent.log',
      },
    ]
    await mkdir(join(cwd, '.yorz/tmp/commands'), { recursive: true })
    await writeFile(
      join(cwd, '.yorz/tmp/commands/index.json'),
      JSON.stringify(records, null, 2),
      'utf8',
    )
    await writeFile(join(cwd, '.yorz/tmp/commands/old.log'), 'stale', 'utf8')

    const m = new CommandManager(cwd)
    started.push(m)
    const runs = await m.listRuns()
    expect(runs.map((r) => r.runId)).toEqual(['recent'])
    await expect(stat(join(cwd, '.yorz/tmp/commands/old.log'))).rejects.toThrow()
  })
})

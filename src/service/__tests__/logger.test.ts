import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_ARCHIVES,
  DEFAULT_MAX_BYTES,
  createLogger,
  resolveLogDir,
  resolveLogLevel,
} from '../logger.js'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-logger-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!
    await chmod(dir, 0o755).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

async function readLog(dir: string, name = 'serve.log'): Promise<string> {
  return readFile(join(dir, name), 'utf8')
}

describe('logger defaults', () => {
  it('caps a single file at 5MiB and keeps one archive', () => {
    expect(DEFAULT_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(DEFAULT_MAX_ARCHIVES).toBe(1)
  })

  it('resolves the log dir under the global config dir', () => {
    expect(resolveLogDir({ YORZ_HOME: '/tmp/fake-home' } as NodeJS.ProcessEnv)).toBe(
      join('/tmp/fake-home', 'logs'),
    )
  })

  it('reads the level from YORZ_LOG_LEVEL and falls back to info', () => {
    expect(resolveLogLevel({ YORZ_LOG_LEVEL: 'debug' } as NodeJS.ProcessEnv)).toBe('debug')
    expect(resolveLogLevel({ YORZ_LOG_LEVEL: 'NOPE' } as NodeJS.ProcessEnv)).toBe('info')
    expect(resolveLogLevel({} as NodeJS.ProcessEnv)).toBe('info')
  })
})

describe('level filtering', () => {
  it('drops entries below the configured level', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'warn', mirrorConsole: false })
    logger.debug('hidden-debug')
    logger.info('hidden-info')
    logger.warn('shown-warn')
    logger.error('shown-error')
    await logger.flush()

    const body = await readLog(dir)
    expect(body).not.toContain('hidden-debug')
    expect(body).not.toContain('hidden-info')
    expect(body).toContain('shown-warn')
    expect(body).toContain('shown-error')
  })

  it('emits everything at debug level', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'debug', mirrorConsole: false })
    logger.debug('a-debug')
    await logger.flush()
    expect(await readLog(dir)).toContain('a-debug')
  })
})

describe('line format', () => {
  it('writes one line per entry with timestamp, level, scope and meta JSON', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    logger.child('http').info('route error', { path: '/api/x', status: 500 })
    await logger.flush()

    const body = await readLog(dir)
    const lines = body.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[info\] \[http\] route error \{"path":"\/api\/x","status":500\}$/,
    )
  })

  it('serializes Error meta into message and stack', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    logger.error('boom', { err: new Error('kaboom') })
    await logger.flush()

    const body = await readLog(dir)
    expect(body).toContain('"message":"kaboom"')
    expect(body).toContain('"stack"')
    expect(body.trimEnd().split('\n')).toHaveLength(1)
  })

  it('omits the meta segment when no meta is given', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    logger.info('plain message')
    await logger.flush()
    expect(await readLog(dir)).toMatch(/\[yorz\] plain message\n$/)
  })
})

describe('child scopes', () => {
  it('prefixes lines with the child scope and nests further children', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    logger.child('agent').info('dispatch')
    logger.child('worktree').child('merge').info('merged')
    await logger.flush()

    const body = await readLog(dir)
    expect(body).toContain('[agent] dispatch')
    expect(body).toContain('[worktree:merge] merged')
  })

  it('shares the sink between parent and children', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    const child = logger.child('serve')
    logger.info('from-parent')
    child.info('from-child')
    await logger.flush()

    const files = await readdir(dir)
    expect(files).toEqual(['serve.log'])
    const body = await readLog(dir)
    expect(body).toContain('from-parent')
    expect(body).toContain('from-child')
  })
})

describe('rotation', () => {
  it('archives to serve.log.1 and resets the main file once the cap is hit', async () => {
    const dir = await tempDir()
    const logger = createLogger({
      dir,
      level: 'info',
      mirrorConsole: false,
      maxBytes: 200,
      maxArchives: 1,
    })
    for (let i = 0; i < 20; i++) logger.info(`line-${i}-${'x'.repeat(40)}`)
    await logger.flush()

    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['serve.log', 'serve.log.1'])

    const main = await stat(join(dir, 'serve.log'))
    expect(main.size).toBeLessThanOrEqual(200)
    const archive = await stat(join(dir, 'serve.log.1'))
    expect(archive.size).toBeLessThanOrEqual(200)

    // the newest line lives in the main file, older history in the archive
    expect(await readLog(dir)).toContain('line-19')
    expect(await readLog(dir, 'serve.log.1')).not.toContain('line-19')
  })

  it('never keeps more archives than maxArchives (oldest is evicted)', async () => {
    const dir = await tempDir()
    const logger = createLogger({
      dir,
      level: 'info',
      mirrorConsole: false,
      maxBytes: 120,
      maxArchives: 2,
    })
    for (let i = 0; i < 30; i++) logger.info(`entry-${i}-${'y'.repeat(30)}`)
    await logger.flush()

    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['serve.log', 'serve.log.1', 'serve.log.2'])
    // the very first entry has been rotated out entirely
    const all = (await Promise.all(files.map((f) => readLog(dir, f)))).join('')
    expect(all).not.toContain('entry-0-')
    expect(all).toContain('entry-29-')
  })

  it('truncates in place when maxArchives is 0', async () => {
    const dir = await tempDir()
    const logger = createLogger({
      dir,
      level: 'info',
      mirrorConsole: false,
      maxBytes: 150,
      maxArchives: 0,
    })
    for (let i = 0; i < 15; i++) logger.info(`t-${i}-${'z'.repeat(40)}`)
    await logger.flush()

    expect(await readdir(dir)).toEqual(['serve.log'])
    const body = await readLog(dir)
    expect(body).toContain('t-14-')
    expect(body).not.toContain('t-0-')
  })

  it('recovers currentSize from an existing file on startup', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'serve.log'), 'x'.repeat(190), 'utf8')
    const logger = createLogger({
      dir,
      level: 'info',
      mirrorConsole: false,
      maxBytes: 200,
      maxArchives: 1,
    })
    logger.info('after-restart')
    await logger.flush()

    // pre-existing bytes counted -> the very first write must rotate
    expect((await readdir(dir)).sort()).toEqual(['serve.log', 'serve.log.1'])
    expect(await readLog(dir)).toContain('after-restart')
    expect(await readLog(dir, 'serve.log.1')).toContain('x'.repeat(190))
  })
})

describe('resilience', () => {
  it('stays silent when the log dir cannot be created', async () => {
    const parent = await tempDir()
    await chmod(parent, 0o500)
    const logger = createLogger({
      dir: join(parent, 'nested', 'logs'),
      level: 'info',
      mirrorConsole: false,
    })
    expect(() => logger.info('should not throw')).not.toThrow()
    await expect(logger.flush()).resolves.toBeUndefined()
  })

  it('serializes concurrent writes without interleaving lines', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    const total = 200
    for (let i = 0; i < total; i++) logger.child(`s${i % 5}`).info(`concurrent-${i}`)
    await logger.flush()

    const lines = (await readLog(dir)).trimEnd().split('\n')
    expect(lines).toHaveLength(total)
    for (const line of lines) {
      expect(line).toMatch(/^\[[^\]]+\] \[info\] \[s\d\] concurrent-\d+$/)
    }
  })
})

describe('configure', () => {
  it('redirects the sink when the dir changes', async () => {
    const first = await tempDir()
    const second = await tempDir()
    const logger = createLogger({ dir: first, level: 'info', mirrorConsole: false })
    logger.info('in-first')
    await logger.flush()

    logger.configure({ dir: second })
    logger.info('in-second')
    await logger.flush()

    expect(await readLog(first)).toContain('in-first')
    expect(await readLog(second)).toContain('in-second')
    expect(await readLog(second)).not.toContain('in-first')
  })

  it('propagates a level change to existing children', async () => {
    const dir = await tempDir()
    const logger = createLogger({ dir, level: 'info', mirrorConsole: false })
    const child = logger.child('http')
    child.debug('before-change')
    logger.configure({ level: 'debug' })
    child.debug('after-change')
    await logger.flush()

    const body = await readLog(dir)
    expect(body).not.toContain('before-change')
    expect(body).toContain('after-change')
  })
})

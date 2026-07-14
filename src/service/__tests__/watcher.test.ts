import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpecWatcher, type WatcherEvent } from '../watcher.js'

const SPEC_ID = '260714.fix.demo'
const SETTLE_MS = 20

/** Private surface we drive directly — chokidar's own timing is not under test. */
interface WatcherInternals {
  handle: (filePath: string, evt: WatcherEvent) => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('SpecWatcher unlink settle window', () => {
  let root: string
  let specsDir: string
  let specPath: string
  let watcher: SpecWatcher
  let events: WatcherEvent[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yorz-watcher-'))
    specsDir = join(root, '.yorz', 'specs')
    specPath = join(specsDir, SPEC_ID, 'spec.md')
    mkdirSync(join(specsDir, SPEC_ID), { recursive: true })

    watcher = new SpecWatcher({ cwd: root, specsDir, unlinkSettleMs: SETTLE_MS })
    events = []
    watcher.subscribe(SPEC_ID, (evt) => events.push(evt))
  })

  afterEach(async () => {
    await watcher.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('drops `removed` when the file reappears within the settle window (atomic rewrite)', async () => {
    // Atomic write: the unlink fires while the rename has already put the file back.
    writeFileSync(specPath, '# spec\n')

    await (watcher as unknown as WatcherInternals).handle(specPath, 'removed')
    await sleep(SETTLE_MS * 4)

    expect(events).not.toContain('removed')
  })

  it('dispatches `removed` when the file is really gone after the settle window', async () => {
    await (watcher as unknown as WatcherInternals).handle(specPath, 'removed')
    await sleep(SETTLE_MS * 4)

    expect(events).toEqual(['removed'])
  })

  it('cancels a pending unlink when an add/change arrives first', async () => {
    await (watcher as unknown as WatcherInternals).handle(specPath, 'removed')
    writeFileSync(specPath, '# spec\n')
    await (watcher as unknown as WatcherInternals).handle(specPath, 'updated')
    await sleep(SETTLE_MS * 4)

    expect(events).toEqual(['updated'])
  })
})

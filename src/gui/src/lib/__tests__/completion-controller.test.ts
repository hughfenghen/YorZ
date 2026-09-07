import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCompletion, type SlashCommand } from '@shared/lib/completion.js'
import { api } from '@shared/api/index.js'

/**
 * `handleInput` only ever reads `.value` and `.selectionStart`. The unit suite
 * runs in the `node` environment (no jsdom), so feed it a stand-in rather than
 * dragging a DOM in for two properties.
 */
function caretAt(value: string, pos = value.length): HTMLTextAreaElement {
  return { value, selectionStart: pos } as HTMLTextAreaElement
}

const COMMANDS: SlashCommand[] = [
  { value: '/yorz-debug', description: 'debug' },
  { value: '/yorz-spec', description: 'spec' },
  { value: '/deploy', replacement: '/deploy only web', customId: 'c1' },
  { value: '/add-command', label: 'New command', action: 'add', icon: 'plus' },
]

/**
 * Drive a controller inside a reactive root and hand back a disposer, so signals
 * and `onCleanup` behave the way they do under a real component.
 */
function withController(
  options: Partial<Omit<Parameters<typeof createCompletion>[0], 'value'>> & {
    /** Seed text, not an accessor — the harness owns the accessor. */
    value?: string
  } = {},
) {
  const { value: seed, ...overrides } = options
  let value = seed ?? ''
  const changes: string[] = []
  let dispose = (): void => {}
  const controller = createRoot((d) => {
    dispose = d
    return createCompletion({
      projectId: () => 'p1',
      onValueChange: (next) => {
        value = next
        changes.push(next)
      },
      slashCommands: () => COMMANDS,
      slashEmptyEnabled: () => true,
      ...overrides,
      // Must win over the spread: the seed above is a string, not an accessor.
      value: () => value,
    })
  })
  return { controller, changes, dispose, current: () => value }
}

describe('createCompletion — slash commands', () => {
  it('opens on a leading slash and ranks the prefix hit first', () => {
    const { controller, dispose } = withController()
    controller.handleInput(caretAt('/dep'))
    expect(controller.open()).toBe(true)
    expect(controller.items()[0]).toMatchObject({ kind: 'slash', value: '/deploy' })
    dispose()
  })

  it('honours an explicit replacement and reports the caret after it', () => {
    const { controller, changes, dispose } = withController({ value: '/dep' })
    controller.handleInput(caretAt('/dep'))
    const outcome = controller.select(controller.items()[0]!)
    expect(changes.at(-1)).toBe('/deploy only web')
    expect(outcome).toEqual({ kind: 'text', cursorPos: 16 })
    dispose()
  })

  it('keeps text that follows the command', () => {
    // Caret sits after `/dep`; the trailing ` rest` must survive the splice.
    const { controller, changes, dispose } = withController({ value: '/dep rest' })
    controller.handleInput(caretAt('/dep rest', 4))
    controller.select(controller.items()[0]!)
    expect(changes.at(-1)).toBe('/deploy only web rest')
    dispose()
  })

  it('strips the query and defers to the host for an `add` action', () => {
    const { controller, changes, dispose } = withController({ value: '/add' })
    controller.handleInput(caretAt('/add'))
    const item = controller.items().find((i) => i.kind === 'slash' && i.action === 'add')!
    const outcome = controller.select(item)
    expect(changes.at(-1)).toBe('')
    expect(outcome).toMatchObject({ kind: 'action', command: { value: '/add-command' } })
    expect(controller.open()).toBe(false)
    dispose()
  })

  it('reports an empty match instead of vanishing when the host opted in', () => {
    const { controller, dispose } = withController()
    controller.handleInput(caretAt('/zzzz'))
    expect(controller.open()).toBe(true)
    expect(controller.slashEmpty()).toBe(true)
    expect(controller.items()).toEqual([])
    dispose()
  })

  it('closes on an empty match when the host did not opt in', () => {
    const { controller, dispose } = withController({ slashEmptyEnabled: () => false })
    controller.handleInput(caretAt('/zzzz'))
    expect(controller.open()).toBe(false)
    dispose()
  })

  it('does not trigger at all when the host supplies no commands', () => {
    const { controller, dispose } = withController({ slashCommands: () => [] })
    controller.handleInput(caretAt('/dep'))
    expect(controller.open()).toBe(false)
    dispose()
  })

  it('wraps around when moving the active index', () => {
    const { controller, dispose } = withController()
    controller.handleInput(caretAt('/'))
    const count = controller.items().length
    controller.moveIndex(-1)
    expect(controller.index()).toBe(count - 1)
    controller.moveIndex(1)
    expect(controller.index()).toBe(0)
    dispose()
  })

  it('drops a deleted custom command and clamps the active index', () => {
    const { controller, dispose } = withController()
    controller.handleInput(caretAt('/'))
    const before = controller.items().length
    controller.setIndex(before - 1)
    controller.removeSlashItem('c1')
    expect(controller.items()).toHaveLength(before - 1)
    expect(controller.index()).toBeLessThanOrEqual(before - 2)
    dispose()
  })

  it('is a no-op to select when nothing is open', () => {
    const { controller, dispose } = withController()
    expect(controller.select({ kind: 'mention', value: 'a.ts' })).toEqual({ kind: 'noop' })
    dispose()
  })
})

describe('createCompletion — mention search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces, then fills the list from the file endpoint', async () => {
    const listFiles = vi.spyOn(api, 'listFiles').mockResolvedValue({ items: ['src/a.ts'] })
    const { controller, dispose } = withController()

    controller.handleInput(caretAt('@sr'))
    expect(listFiles).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(listFiles).toHaveBeenCalledWith('p1', 'sr')
    expect(controller.items()).toEqual([{ kind: 'mention', value: 'src/a.ts' }])
    dispose()
  })

  it('collapses rapid keystrokes into one request', async () => {
    const listFiles = vi.spyOn(api, 'listFiles').mockResolvedValue({ items: [] })
    const { controller, dispose } = withController()

    controller.handleInput(caretAt('@s'))
    controller.handleInput(caretAt('@sr'))
    controller.handleInput(caretAt('@src'))
    await vi.advanceTimersByTimeAsync(200)

    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(listFiles).toHaveBeenCalledWith('p1', 'src')
    dispose()
  })

  it('discards a stale response that lands after the query moved on', async () => {
    // The regression this guards: a slow walk for `@s` resolving after the user
    // typed `@src` used to overwrite the fresh list with stale paths.
    let resolveSlow: ((v: { items: string[] }) => void) | undefined
    vi.spyOn(api, 'listFiles').mockImplementation((_pid, query) => {
      if (query === 's') return new Promise((r) => (resolveSlow = r))
      return Promise.resolve({ items: ['src/fresh.ts'] })
    })
    const { controller, dispose } = withController()

    controller.handleInput(caretAt('@s'))
    await vi.advanceTimersByTimeAsync(200)
    controller.handleInput(caretAt('@src'))
    await vi.advanceTimersByTimeAsync(200)
    expect(controller.items()).toEqual([{ kind: 'mention', value: 'src/fresh.ts' }])

    resolveSlow?.({ items: ['stale/only.ts'] })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.items()).toEqual([{ kind: 'mention', value: 'src/fresh.ts' }])
    dispose()
  })

  it('skips the request when there is no project scope', async () => {
    const listFiles = vi.spyOn(api, 'listFiles').mockResolvedValue({ items: [] })
    const { controller, dispose } = withController({ projectId: () => '' })
    controller.handleInput(caretAt('@sr'))
    await vi.advanceTimersByTimeAsync(200)
    expect(listFiles).not.toHaveBeenCalled()
    dispose()
  })

  it('honours a host-supplied debounce', async () => {
    const listFiles = vi.spyOn(api, 'listFiles').mockResolvedValue({ items: [] })
    const { controller, dispose } = withController({ searchDebounceMs: 280 })
    controller.handleInput(caretAt('@sr'))
    await vi.advanceTimersByTimeAsync(200)
    expect(listFiles).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(listFiles).toHaveBeenCalledOnce()
    dispose()
  })

  it('closes once the text stops looking like a path', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ items: ['src/a.ts'] })
    const { controller, dispose } = withController()
    controller.handleInput(caretAt('@sr'))
    await vi.advanceTimersByTimeAsync(200)
    expect(controller.open()).toBe(true)

    controller.handleInput(caretAt('@sr now'))
    expect(controller.open()).toBe(false)
    expect(controller.items()).toEqual([])
    dispose()
  })

  it('splices the mention over its own span only', async () => {
    vi.spyOn(api, 'listFiles').mockResolvedValue({ items: ['src/a.ts'] })
    const { controller, changes, dispose } = withController({ value: 'see @sr tail' })
    controller.handleInput(caretAt('see @sr tail', 7))
    await vi.advanceTimersByTimeAsync(200)
    const outcome = controller.select(controller.items()[0]!)
    expect(changes.at(-1)).toBe('see @src/a.ts tail')
    expect(outcome).toEqual({ kind: 'text', cursorPos: 13 })
    dispose()
  })
})

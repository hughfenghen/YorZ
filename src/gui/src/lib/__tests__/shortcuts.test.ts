import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  DEFAULT_SHORTCUTS,
  effectiveShortcuts,
  findShortcutConflicts,
  isEditableShortcutTarget,
  normalizeShortcut,
  shortcutFromEvent,
} from '../shortcuts.js'

let dom: JSDOM

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  })
})

afterEach(() => {
  dom.window.close()
})

describe('shortcuts', () => {
  it('normalizes configured bindings and keyboard events', () => {
    expect(normalizeShortcut('ctrl + shift + n')).toBe('Ctrl+Shift+N')
    expect(
      shortcutFromEvent({
        key: 'f',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      }),
    ).toBe('Ctrl+Shift+F')
  })

  it('falls back to default shortcuts when config is empty or null', () => {
    expect(effectiveShortcuts({}).newSpec).toBe(DEFAULT_SHORTCUTS.newSpec)
    expect(effectiveShortcuts({ newSpec: null }).newSpec).toBe(DEFAULT_SHORTCUTS.newSpec)
  })

  it('detects duplicate effective bindings', () => {
    expect(findShortcutConflicts({ newSpec: 'Ctrl+Shift+S' }).sort()).toEqual([
      'newSpec',
      'projectSettings',
    ])
  })

  it('skips editable targets', () => {
    expect(isEditableShortcutTarget(dom.window.document.createElement('input'))).toBe(true)
    expect(isEditableShortcutTarget(dom.window.document.createElement('textarea'))).toBe(true)
    expect(isEditableShortcutTarget(dom.window.document.createElement('button'))).toBe(false)
  })
})

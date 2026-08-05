export type ShortcutActionId = 'newSpec' | 'toggleSpecDetailFullscreen' | 'projectSettings'

export interface ShortcutBinding {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
}

export type ShortcutConfig = Partial<Record<ShortcutActionId, string | null>>

export const SHORTCUT_ACTIONS: ShortcutActionId[] = [
  'newSpec',
  'toggleSpecDetailFullscreen',
  'projectSettings',
]

export const DEFAULT_SHORTCUTS: Record<ShortcutActionId, string> = {
  newSpec: 'Ctrl+Shift+N',
  toggleSpecDetailFullscreen: 'Ctrl+Shift+F',
  projectSettings: 'Ctrl+Shift+S',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

export function normalizeShortcut(value: string | null | undefined): string | null {
  if (!value) return null
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  const binding: ShortcutBinding = { key: '' }
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') binding.ctrl = true
    else if (lower === 'shift') binding.shift = true
    else if (lower === 'alt' || lower === 'option') binding.alt = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') binding.meta = true
    else binding.key = normalizeKey(part)
  }
  if (!binding.key) return null
  return serializeShortcut(binding)
}

export function shortcutFromEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = normalizeKey(event.key)
  if (!key) return null
  return serializeShortcut({
    key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  })
}

export function effectiveShortcuts(
  config: ShortcutConfig | undefined,
): Record<ShortcutActionId, string> {
  return {
    newSpec: normalizeShortcut(config?.newSpec) ?? DEFAULT_SHORTCUTS.newSpec,
    toggleSpecDetailFullscreen:
      normalizeShortcut(config?.toggleSpecDetailFullscreen) ??
      DEFAULT_SHORTCUTS.toggleSpecDetailFullscreen,
    projectSettings:
      normalizeShortcut(config?.projectSettings) ?? DEFAULT_SHORTCUTS.projectSettings,
  }
}

export function findShortcutConflicts(config: ShortcutConfig | undefined): ShortcutActionId[] {
  const effective = effectiveShortcuts(config)
  const seen = new Map<string, ShortcutActionId>()
  const conflicts = new Set<ShortcutActionId>()
  for (const action of SHORTCUT_ACTIONS) {
    const binding = effective[action]
    const prev = seen.get(binding)
    if (prev) {
      conflicts.add(prev)
      conflicts.add(action)
    } else {
      seen.set(binding, action)
    }
  }
  return [...conflicts]
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag !== 'input') return false
  const input = target as HTMLInputElement
  const type = input.type.toLowerCase()
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'color'].includes(type)
}

export function formatShortcut(value: string | null | undefined): string {
  return normalizeShortcut(value) ?? ''
}

function serializeShortcut(binding: ShortcutBinding): string {
  const parts: string[] = []
  if (binding.ctrl) parts.push('Ctrl')
  if (binding.shift) parts.push('Shift')
  if (binding.alt) parts.push('Alt')
  if (binding.meta) parts.push('Meta')
  parts.push(normalizeKey(binding.key))
  return parts.join('+')
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase()
  if (key === ' ') return 'Space'
  if (key.startsWith('Arrow')) return key
  return key.slice(0, 1).toUpperCase() + key.slice(1)
}

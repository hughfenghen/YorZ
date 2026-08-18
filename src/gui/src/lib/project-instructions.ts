import { createSignal } from 'solid-js'
import { api, type CustomInstruction } from './api.js'

/**
 * Project-scoped slash commands, cached per project id.
 *
 * Mirrors the global config store, but keyed: the composer reads the active
 * project's list synchronously while assembling the picker, and switching
 * projects must not show the previous project's commands.
 */
const [byProject, setByProject] = createSignal<Record<string, CustomInstruction[]>>({})

export function projectInstructions(projectId: string): CustomInstruction[] {
  if (!projectId) return []
  return byProject()[projectId] ?? []
}

function put(projectId: string, list: CustomInstruction[]): CustomInstruction[] {
  setByProject((current) => ({ ...current, [projectId]: list }))
  return list
}

/** Failures degrade to an empty list: a missing project scope must not break the picker. */
export async function refreshProjectInstructions(projectId: string): Promise<CustomInstruction[]> {
  if (!projectId) return []
  try {
    const res = await api.getProjectCustomInstructions(projectId)
    return put(projectId, res.customInstructions)
  } catch {
    return put(projectId, [])
  }
}

export async function saveProjectInstructions(
  projectId: string,
  customInstructions: CustomInstruction[],
): Promise<CustomInstruction[]> {
  const res = await api.updateProjectCustomInstructions(projectId, customInstructions)
  return put(projectId, res.customInstructions)
}

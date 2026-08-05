import { resolveSkillEntry } from './global-config.js'

/**
 * Bundled skills live in one shared directory (`~/.config/yorz/skills/`) rather
 * than in each Agent's own skills dir, so no Agent can discover them by name.
 * Prompts therefore reference the absolute `SKILL.md` path and let the Agent
 * Read it on demand — which also preserves the skill's progressive-disclosure
 * design (SKILL.md pulls in stages.md / review.md only when needed).
 */
export function skillEntryPath(skillName: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveSkillEntry(skillName, env)
}

/** Prompt prefix instructing the Agent to load a bundled skill by absolute path. */
export function skillRef(skillName: string, env: NodeJS.ProcessEnv = process.env): string {
  return `请先完整阅读并严格遵循 ${skillEntryPath(skillName, env)}（YorZ 内置 ${skillName} skill 规则）`
}

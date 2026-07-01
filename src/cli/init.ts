import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ensureTmpIgnored } from './install.js'
import { isGitRepo, runGitInit } from './git.js'

export interface RunInitOptions {
  cwd?: string
  /** 非 TTY 或 CI 场景直接跳过确认。 */
  yes?: boolean
  /** 测试注入点：提问并返回用户输入（原始行，不含换行）。 */
  prompt?: (question: string) => Promise<string>
  /** 测试注入点：跑 `git init`。 */
  runGitInit?: (cwd: string) => Promise<void>
  /** 覆盖默认的 TTY 判定，主要用于测试。 */
  isTTY?: boolean
}

export interface RunInitResult {
  cwd: string
  gitInitialized: boolean
  yorzDirCreated: boolean
  gitignore: { updated: boolean; path: string } | null
}

export class InitAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InitAbortedError'
  }
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

export async function runInit(opts: RunInitOptions = {}): Promise<RunInitResult> {
  const cwd = opts.cwd ?? process.cwd()
  const gitInit = opts.runGitInit ?? runGitInit
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)

  let gitInitialized = false
  if (!(await isGitRepo(cwd))) {
    if (opts.yes) {
      await gitInit(cwd)
      gitInitialized = true
    } else if (isTTY) {
      const ask = opts.prompt ?? defaultPrompt
      const raw = await ask(
        `yorz init: ${cwd} 未 git init，是否自动执行 \`git init\`? [y/N] `,
      )
      const answer = raw.trim().toLowerCase()
      if (answer === 'y' || answer === 'yes') {
        await gitInit(cwd)
        gitInitialized = true
      } else {
        throw new InitAbortedError(
          `yorz init: aborted — current directory is not a git repository`,
        )
      }
    } else {
      throw new InitAbortedError(
        `yorz init: current directory is not a git repository; pass --yes to auto-run git init in non-interactive mode`,
      )
    }
  }

  await mkdir(join(cwd, '.yorz'), { recursive: true })
  const gitignore = await ensureTmpIgnored(cwd)

  return {
    cwd,
    gitInitialized,
    yorzDirCreated: true,
    gitignore,
  }
}

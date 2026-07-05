import { createInterface } from 'node:readline/promises'
import { addProject, prepareProjectDir, type GlobalProjectEntry } from '../service/global-config.js'
import { isGitRepo, runGitInit } from './git.js'
import { ensureTmpIgnored } from './install.js'

export interface RunAddOptions {
  path: string
  cwd?: string
  globalConfigPath?: string
  /** 非 TTY 或 CI 场景直接跳过 git-init 确认。 */
  yes?: boolean
  /** 测试注入点：提问并返回用户输入（原始行，不含换行）。 */
  prompt?: (question: string) => Promise<string>
  /** 测试注入点：跑 `git init`。 */
  runGitInit?: (cwd: string) => Promise<void>
  /** 覆盖默认的 TTY 判定，主要用于测试。 */
  isTTY?: boolean
}

export interface RunAddResult {
  entry: GlobalProjectEntry
  created: boolean
  gitInitialized: boolean
  gitignore: { updated: boolean; path: string } | null
}

export class AddGitAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AddGitAbortedError'
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

export async function runAdd(opts: RunAddOptions): Promise<RunAddResult> {
  const abs = await prepareProjectDir(opts.path, opts.cwd)
  const gitInit = opts.runGitInit ?? runGitInit
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY)

  let gitInitialized = false
  if (!(await isGitRepo(abs))) {
    if (opts.yes) {
      await gitInit(abs)
      gitInitialized = true
    } else if (isTTY) {
      const ask = opts.prompt ?? defaultPrompt
      const raw = await ask(`yorz add: ${abs} 未 git init，是否自动执行 \`git init\`? [y/N] `)
      const answer = raw.trim().toLowerCase()
      if (answer === 'y' || answer === 'yes') {
        await gitInit(abs)
        gitInitialized = true
      } else {
        throw new AddGitAbortedError(
          `yorz add: aborted — target directory is not a git repository`,
        )
      }
    } else {
      throw new AddGitAbortedError(
        `yorz add: target directory is not a git repository; pass --yes to auto-run git init in non-interactive mode`,
      )
    }
  }

  const gitignore = await ensureTmpIgnored(abs)
  const { entry, created } = await addProject(abs, opts.globalConfigPath)
  return { entry, created, gitInitialized, gitignore }
}

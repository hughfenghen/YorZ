import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await stat(join(cwd, '.git'))
    return true
  } catch {
    return false
  }
}

export async function runGitInit(cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git init exited with code ${code}`))
    })
  })
}

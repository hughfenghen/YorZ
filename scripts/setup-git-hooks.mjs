import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const insideWorktree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  cwd: projectRoot,
  encoding: 'utf8',
})

if (insideWorktree.status !== 0 || insideWorktree.stdout.trim() !== 'true') {
  process.exit(0)
}

const configured = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: projectRoot,
  stdio: 'inherit',
})

if (configured.status !== 0) {
  process.exit(configured.status ?? 1)
}

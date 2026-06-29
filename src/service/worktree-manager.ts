import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { GitError, runGitChecked, runGitRaw } from './git.js'
import {
  loadGlobalConfig,
  saveGlobalConfig,
  setProjectWorktree,
  type GlobalProjectEntry,
  type WorktreeMeta,
} from './global-config.js'
import { configPath as projectConfigPath } from './project-config.js'
import type { ProjectRegistry } from './project-registry.js'

export interface CreateWorktreeInput {
  mainProjectId: string
  specSlug: string
  branch?: string
}

export interface CreateWorktreeResult {
  entry: GlobalProjectEntry
  branch: string
  path: string
  baseRef: string
}

export interface MergeBackInput {
  worktreeProjectId: string
  commitMessage?: string
  /** Override how the conflict spec id is stamped (used by tests). */
  now?: () => Date
}

export type MergeBackResult =
  | { status: 'merged'; mainProjectId: string; mergeCommit: string }
  | {
      status: 'conflict'
      mainProjectId: string
      conflictSpecId: string
      conflictSpecPath: string
      conflictFiles: string[]
    }

export interface RelatedCommit {
  hash: string
  date: string
  author: string
  subject: string
}

export interface ConflictReport {
  files: string[]
  commitsByFile: Record<string, RelatedCommit[]>
  recentMerges: RelatedCommit[]
}

interface WorktreeManagerOptions {
  registry: ProjectRegistry
  globalConfigPath?: string
  /** Override the agent runner trigger (used by tests). */
  triggerConflictAgent?: (mainProjectId: string, specId: string) => Promise<void> | void
}

export class WorktreeManager {
  private readonly registry: ProjectRegistry
  private readonly globalConfigPath?: string
  private readonly triggerConflictAgent?: WorktreeManagerOptions['triggerConflictAgent']

  constructor(opts: WorktreeManagerOptions) {
    this.registry = opts.registry
    this.globalConfigPath = opts.globalConfigPath
    this.triggerConflictAgent = opts.triggerConflictAgent
  }

  async createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
    const main = await this.registry.findEntry(input.mainProjectId)
    if (!main) throw new GitError('not_found', `main project not found: ${input.mainProjectId}`)
    if (main.worktree) {
      throw new GitError('invalid_parent', 'cannot create worktree from another worktree')
    }
    const mainPath = main.path
    const baseRef = await detectDefaultBranch(mainPath)
    const slug = sanitizeSlug(input.specSlug)
    const baseBranch = (input.branch && input.branch.trim()) || `wt/${slug}`
    const branch = await uniqueBranch(mainPath, baseBranch)
    const wtRoot = resolve(dirname(mainPath), `${basename(mainPath)}.wt`)
    const wtPath = resolve(wtRoot, branch.replace(/[\\/]/g, '__'))
    if (existsSync(wtPath)) {
      throw new GitError('path_exists', `worktree path already exists: ${wtPath}`)
    }
    await mkdir(wtRoot, { recursive: true })
    await runGitChecked(mainPath, ['worktree', 'add', '-b', branch, wtPath, baseRef])

    const srcCfg = projectConfigPath(mainPath)
    if (existsSync(srcCfg)) {
      const dstCfg = projectConfigPath(wtPath)
      await mkdir(dirname(dstCfg), { recursive: true })
      await copyFile(srcCfg, dstCfg)
    }

    const { entry } = await this.registry.add(wtPath)
    const meta: WorktreeMeta = {
      mainProjectId: main.id,
      mainPath,
      branch,
      specId: '',
      createdAt: new Date().toISOString(),
    }
    await setProjectWorktree(entry.id, meta, this.globalConfigPath)
    const updated = (await this.registry.findEntry(entry.id)) ?? { ...entry, worktree: meta }
    return { entry: updated, branch, path: wtPath, baseRef }
  }

  /** Update the `specId` on a worktree entry once the spec has been created. */
  async attachSpecToWorktree(worktreeProjectId: string, specId: string): Promise<void> {
    const entry = await this.registry.findEntry(worktreeProjectId)
    if (!entry || !entry.worktree) return
    const next: WorktreeMeta = { ...entry.worktree, specId }
    await setProjectWorktree(worktreeProjectId, next, this.globalConfigPath)
  }

  async mergeBackToMain(input: MergeBackInput): Promise<MergeBackResult> {
    const entry = await this.registry.findEntry(input.worktreeProjectId)
    if (!entry) throw new GitError('not_found', `project not found: ${input.worktreeProjectId}`)
    if (!entry.worktree) {
      throw new GitError('not_worktree', 'project is not a worktree')
    }
    const mainEntry = await this.registry.findEntry(entry.worktree.mainProjectId)
    const mainPath = mainEntry?.path ?? entry.worktree.mainPath
    if (!existsSync(mainPath)) {
      throw new GitError('main_missing', `main project path unreachable: ${mainPath}`)
    }
    const branch = entry.worktree.branch
    const wtPath = entry.path
    const message =
      (input.commitMessage && input.commitMessage.trim()) || `feat(${branch}): merge from worktree`

    // 1. Stage all + commit if dirty.
    await runGitChecked(wtPath, ['add', '-A'])
    const status = await runGitChecked(wtPath, ['status', '--porcelain'])
    if (status.stdout.trim().length > 0) {
      await runGitChecked(wtPath, ['commit', '-m', message])
    }

    // 2. Merge into the main project's checkout.
    const merge = await runGitRaw(mainPath, ['merge', '--no-ff', '-m', message, branch])
    if (merge.code !== 0) {
      const conflict = await this.handleMergeConflict({
        mainPath,
        mainProjectId: mainEntry?.id ?? entry.worktree.mainProjectId,
        branch,
        now: input.now ?? (() => new Date()),
      })
      return conflict
    }

    const head = await runGitChecked(mainPath, ['rev-parse', 'HEAD'])
    const mergeCommit = head.stdout.trim()

    // 3. Tear down the worktree.
    await runGitRaw(mainPath, ['worktree', 'remove', wtPath])
    if (existsSync(wtPath)) {
      await runGitRaw(mainPath, ['worktree', 'remove', '--force', wtPath])
    }
    await runGitRaw(mainPath, ['branch', '-d', branch])

    // 4. Drop the worktree project entry and reload main so its watcher sees new commits.
    await this.registry.remove(entry.id)
    if (mainEntry) {
      await this.registry.reload(mainEntry.id)
    }

    return {
      status: 'merged',
      mainProjectId: mainEntry?.id ?? entry.worktree.mainProjectId,
      mergeCommit,
    }
  }

  async listWorktreesOf(mainProjectId: string): Promise<GlobalProjectEntry[]> {
    const config = await loadGlobalConfig(this.globalConfigPath)
    return config.projects.filter((p) => p.worktree?.mainProjectId === mainProjectId)
  }

  async collectConflictReport(mainPath: string): Promise<ConflictReport> {
    const unmerged = await runGitChecked(mainPath, ['diff', '--name-only', '--diff-filter=U'])
    const files = unmerged.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const commitsByFile: Record<string, RelatedCommit[]> = {}
    for (const file of files) {
      const log = await runGitRaw(mainPath, [
        'log',
        '--since=30 days ago',
        '--pretty=format:%h%x09%ad%x09%an%x09%s',
        '--date=short',
        '--',
        file,
      ])
      commitsByFile[file] = parseCommitLines(log.stdout)
    }
    const merges = await runGitRaw(mainPath, [
      'log',
      '--since=30 days ago',
      '--merges',
      '--pretty=format:%h%x09%ad%x09%an%x09%s',
      '--date=short',
    ])
    return {
      files,
      commitsByFile,
      recentMerges: parseCommitLines(merges.stdout),
    }
  }

  private async handleMergeConflict(args: {
    mainPath: string
    mainProjectId: string
    branch: string
    now: () => Date
  }): Promise<MergeBackResult> {
    const report = await this.collectConflictReport(args.mainPath)
    const specsRoot = join(args.mainPath, '.yorz', 'specs')
    const branchSegment = sanitizeSlug(args.branch.replace(/^wt\//, '')) || 'unknown'
    const stamp = compactDate(args.now())
    const baseId = `${stamp}.fix.merge-conflict-${branchSegment}`
    let specId = baseId
    let n = 2
    while (existsSync(join(specsRoot, specId))) {
      specId = `${baseId}-${n}`
      n += 1
    }
    const dir = join(specsRoot, specId)
    await mkdir(dir, { recursive: true })
    const specPath = join(dir, 'spec.md')
    await writeFile(specPath, renderConflictSpec(args.branch, report, args.now()), 'utf8')

    if (this.triggerConflictAgent) {
      await this.triggerConflictAgent(args.mainProjectId, specId)
    } else {
      const main = await this.registry.getOrCreate(args.mainProjectId)
      if (main) {
        await this.registry.reload(args.mainProjectId)
        const rebuilt = await this.registry.getOrCreate(args.mainProjectId)
        rebuilt?.runner.run({
          specId,
          mode: 'skill-run',
          prompt: `请使用 yorz-spec skill 处理 spec：${(rebuilt ?? main).specsDirRelative}/${specId}/spec.md`,
        })
      }
    }

    return {
      status: 'conflict',
      mainProjectId: args.mainProjectId,
      conflictSpecId: specId,
      conflictSpecPath: specPath,
      conflictFiles: report.files,
    }
  }
}

async function detectDefaultBranch(mainPath: string): Promise<string> {
  const res = await runGitChecked(mainPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const name = res.stdout.trim()
  if (!name || name === 'HEAD')
    throw new GitError('detached_head', 'main project is in detached HEAD; cannot base worktree')
  return name
}

async function uniqueBranch(mainPath: string, base: string): Promise<string> {
  let candidate = base
  let n = 2
  while (await branchExists(mainPath, candidate)) {
    candidate = `${base}-${n}`
    n += 1
  }
  return candidate
}

async function branchExists(mainPath: string, branch: string): Promise<boolean> {
  const res = await runGitRaw(mainPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ])
  return res.code === 0
}

function sanitizeSlug(raw: string): string {
  return (
    (raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'spec'
  )
}

function compactDate(d: Date): string {
  const y = String(d.getFullYear()).slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function parseCommitLines(stdout: string): RelatedCommit[] {
  const out: RelatedCommit[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trimEnd()
    if (!trimmed) continue
    const [hash, date, author, ...rest] = trimmed.split('\t')
    if (!hash) continue
    out.push({
      hash: hash ?? '',
      date: date ?? '',
      author: author ?? '',
      subject: rest.join('\t'),
    })
  }
  return out
}

function renderConflictSpec(branch: string, report: ConflictReport, now: Date): string {
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const fileLines = report.files.length
    ? report.files.map((f) => `- \`${f}\``).join('\n')
    : '- （无 — 合并失败但未列出冲突文件，请人工核查）'
  const commitBlocks = report.files.length
    ? report.files
        .map((f) => {
          const commits = report.commitsByFile[f] ?? []
          if (commits.length === 0) return `**\`${f}\`**：30 天内无相关 commit。`
          const rows = commits.map((c) => `- \`${c.hash}\` ${c.date} · ${c.author} · ${c.subject}`)
          return `**\`${f}\`**\n\n${rows.join('\n')}`
        })
        .join('\n\n')
    : '（无冲突文件）'
  const mergeBlock = report.recentMerges.length
    ? report.recentMerges
        .map((c) => `- \`${c.hash}\` ${c.date} · ${c.author} · ${c.subject}`)
        .join('\n')
    : '- （30 天内无合并 commit）'
  const body = `# Spec: 解决 ${branch} 合并冲突

## 1. 背景

worktree 分支 \`${branch}\` 合并回主项目时出现冲突，需要在主项目工作区内手动解决，最终保留两边的核心意图，必要时分别确认。

### 1.1 冲突文件

${fileLines}

### 1.2 近 30 天内涉及冲突文件的 commit（按文件分组）

${commitBlocks}

### 1.3 近 30 天的主项目 merge commit（参考）

${mergeBlock}

## 2. 需求

- 在主项目工作区解决以下 git merge 冲突，最终保留两边的核心意图，必要时分别确认。
- 解决完成后由用户决定何时 \`git commit\`；Agent 不应自行 \`git merge --abort\`。

## 3. 现状分析

（待 Agent 补全）

## 4. 技术实现方案

（待 Agent 补全）

## 5. 待确认问题

- 暂无

## 6. 任务清单

- [ ] 阅读冲突文件并解决冲突标记

## 7. 追加任务

- 暂无

## 8. 执行记录

- ${today} 由 worktree 合并失败触发新建本 spec；冲突文件清单与近 30 天相关 commit 已写入 1.1 / 1.2 / 1.3。
`
  const head = [
    '---',
    'stage: plan',
    'last_action: 由 worktree 合并冲突自动生成',
    `updated_at: ${today}`,
    `summary: 解决 ${branch} 合并到主项目时产生的 ${report.files.length} 个冲突文件`,
    '---',
    '',
  ].join('\n')
  return `${head}${body}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

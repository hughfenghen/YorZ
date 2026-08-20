import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, basename, dirname, relative } from 'node:path'
import { lintFile } from '../lint/index.js'
import type { LintReport } from '../lint/index.js'
import { loadProjectConfig, resolveSpecsDir } from '../service/project-config.js'
import { findProjectRoot, getTelemetry } from '../service/telemetry/index.js'

export interface RunLintOptions {
  paths: string[]
  format: 'text' | 'json'
  all: boolean
  cwd: string
  skipMermaidParse?: boolean
}

export interface RunLintResult {
  reports: LintReport[]
  errorCount: number
  warnCount: number
  exitCode: number
}

export async function runLint(opts: RunLintOptions): Promise<RunLintResult> {
  const startedAt = Date.now()
  const cwd = resolve(opts.cwd)
  let targets: string[] = []
  if (opts.all) {
    const cfg = await loadProjectConfig(cwd)
    const specsDir = resolveSpecsDir(cwd, cfg)
    if (existsSync(specsDir)) {
      const entries = await readdir(specsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const specPath = join(specsDir, entry.name, 'spec.md')
        if (existsSync(specPath)) targets.push(specPath)
        const reviewPath = join(specsDir, entry.name, 'review.md')
        if (existsSync(reviewPath)) targets.push(reviewPath)
      }
    }
  }
  for (const p of opts.paths) {
    targets.push(resolve(cwd, p))
  }
  targets = [...new Set(targets)]
  const reports: LintReport[] = []
  for (const t of targets) {
    const report = await lintFile(t, { skipMermaidParse: opts.skipMermaidParse })
    reports.push(report)
  }
  const errorCount = reports.reduce((sum, r) => sum + r.errorCount, 0)
  const warnCount = reports.reduce((sum, r) => sum + r.warnCount, 0)
  const exitCode = errorCount > 0 ? 1 : 0

  if (opts.format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          errorCount,
          warnCount,
          reports: reports.map((r) => ({
            filePath: r.filePath ? relative(cwd, r.filePath) : undefined,
            kind: r.kind,
            errorCount: r.errorCount,
            warnCount: r.warnCount,
            findings: r.findings,
          })),
        },
        null,
        2,
      )}\n`,
    )
  } else {
    for (const r of reports) {
      const relPath = r.filePath ? relative(cwd, r.filePath) : `<${r.kind}>`
      if (r.findings.length === 0) {
        process.stdout.write(`✓ ${relPath} — 0 findings\n`)
        continue
      }
      process.stdout.write(`✗ ${relPath} — ${r.errorCount} error(s), ${r.warnCount} warn(s)\n`)
      for (const f of r.findings) {
        const lineStr = f.line ? `:${f.line}` : ''
        process.stdout.write(`  [${f.severity}] ${f.ruleId}${lineStr} — ${f.message}\n`)
        if (f.hint) process.stdout.write(`    hint: ${f.hint}\n`)
      }
    }
    process.stdout.write(`\nTotal: ${errorCount} error(s), ${warnCount} warn(s) across ${reports.length} file(s).\n`)
  }
  await recordLintRun(cwd, {
    fileCount: targets.length,
    errorCount,
    warnCount,
    exitCode,
    durMs: Date.now() - startedAt,
  })
  return { reports, errorCount, warnCount, exitCode }
}

/**
 * Lint is CLI-only, so it has to locate the project root itself and flush
 * before the process exits — the sink's queue would otherwise die with it.
 */
async function recordLintRun(cwd: string, payload: Record<string, number>): Promise<void> {
  const root = findProjectRoot(cwd)
  if (!root) return
  const telemetry = getTelemetry(root)
  telemetry.record('lint.run', payload)
  await telemetry.flush()
}

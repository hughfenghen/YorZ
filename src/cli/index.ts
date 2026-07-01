import { homedir } from 'node:os'
import { Command, Option } from 'commander'
import { install } from './install.js'
import { uninstall } from './uninstall.js'
import { runServe } from './serve.js'
import { runAdd } from './add.js'
import { runInit, InitAbortedError } from './init.js'
import { runLint } from './lint.js'
import type { AgentName, InstallScope } from './adapters/types.js'
import { INSTALL_SCOPE_DEFAULT, installScopeTip } from './defaults.js'

interface CliOpts {
  agent: string
  scope: string
}

interface ServeOpts {
  port?: string
  open?: boolean
  cwd?: string
  noRegisterCwd?: boolean
}

interface InitOpts {
  yes?: boolean
  cwd?: string
}

const ALL_AGENTS: AgentName[] = ['claude', 'opencode']

function parseAgents(value: string): AgentName[] {
  if (value === 'all') return ALL_AGENTS
  if (value === 'claude' || value === 'opencode') return [value]
  throw new Error(`Invalid --agent: ${value}. Use 'claude' | 'opencode' | 'all'.`)
}

function parseScope(value: string): InstallScope {
  if (value === 'user' || value === 'project') return value
  throw new Error(`Invalid --scope: ${value}. Use 'user' or 'project'.`)
}

const program = new Command()
program.name('yorz').description('YorZ CLI — manage the yorz-spec skill.').version('0.0.1')

program
  .command('init')
  .description('Initialize a YorZ project (create .yorz/, ensure .gitignore, guide git init).')
  .option('-y, --yes', 'skip the git-init confirmation prompt', false)
  .option('--cwd <path>', 'target directory (default: process.cwd())')
  .action(async (opts: InitOpts) => {
    try {
      const result = await runInit({ cwd: opts.cwd, yes: opts.yes })
      if (result.gitInitialized) {
        console.log(`[git] initialized ${result.cwd}`)
      }
      console.log(`[yorz] ensured ${result.cwd}/.yorz`)
      if (result.gitignore?.updated) {
        console.log(`[gitignore] appended .yorz/tmp to ${result.gitignore.path}`)
      } else if (result.gitignore && !result.gitignore.updated) {
        console.log(`[gitignore] already ignored .yorz/tmp`)
      }
    } catch (err) {
      if (err instanceof InitAbortedError) {
        console.error(`error: ${err.message}`)
        process.exit(1)
      }
      throw err
    }
  })

const installCmd = program
  .command('install')
  .description('Install YorZ artifacts (skills, ...).')
installCmd.action(() => {
  installCmd.help()
})

installCmd
  .command('skills')
  .description('Install the yorz-spec skill into the target agent(s).')
  .option('-a, --agent <agent>', 'target agent: claude | opencode | all', 'all')
  .addOption(
    new Option('-s, --scope <scope>', 'install scope: user | project').default(
      INSTALL_SCOPE_DEFAULT,
    ),
  )
  .action(async function (this: Command, opts: CliOpts) {
    const tip = installScopeTip(this.getOptionValueSource('scope'))
    if (tip) console.log(tip)
    const agents = parseAgents(opts.agent)
    const scope = parseScope(opts.scope)
    for (const agent of agents) {
      const result = await install({ agent, scope, home: homedir(), cwd: process.cwd() })
      const verb = result.overwritten ? 'overwritten' : 'installed'
      console.log(`[${agent}] ${verb}: ${result.path}`)
      if (result.gitignore?.updated) {
        console.log(`[gitignore] appended .yorz/tmp to ${result.gitignore.path}`)
      } else if (result.gitignore && !result.gitignore.updated) {
        console.log(`[gitignore] already ignored .yorz/tmp`)
      }
    }
  })

const uninstallCmd = program
  .command('uninstall')
  .description('Remove YorZ artifacts (skills, ...).')
uninstallCmd.action(() => {
  uninstallCmd.help()
})

uninstallCmd
  .command('skills')
  .description('Remove the yorz-spec skill from the target agent(s).')
  .option('-a, --agent <agent>', 'target agent: claude | opencode | all', 'all')
  .option('-s, --scope <scope>', 'uninstall scope: user | project', INSTALL_SCOPE_DEFAULT)
  .action(async (opts: CliOpts) => {
    const agents = parseAgents(opts.agent)
    const scope = parseScope(opts.scope)
    for (const agent of agents) {
      const result = await uninstall({ agent, scope, home: homedir(), cwd: process.cwd() })
      if (result.removed) console.log(`[${agent}] removed: ${result.path}`)
      else console.log(`[${agent}] not installed at ${result.path}`)
    }
  })

program
  .command('add <path>')
  .description('Register a directory as a YorZ project in the global config.')
  .action(async (input: string) => {
    const { entry, created } = await runAdd({ path: input })
    if (created) console.log(`added project ${entry.id}: ${entry.path}`)
    else console.log(`project already registered: ${entry.id} -> ${entry.path}`)
  })

program
  .command('lint [paths...]')
  .description('Lint spec.md / review.md files for structural rules.')
  .option('--format <format>', 'output format: text | json', 'text')
  .option('--all', 'lint every spec.md / review.md under the project specsDir', false)
  .option('--cwd <path>', 'working directory (default: process.cwd())')
  .option('--skip-mermaid-parse', 'skip mermaid deep-parse rule (fence rule still runs)', false)
  .action(async (paths: string[], opts: { format?: string; all?: boolean; cwd?: string; skipMermaidParse?: boolean }) => {
    const format = opts.format === 'json' ? 'json' : 'text'
    const result = await runLint({
      paths: paths ?? [],
      format,
      all: opts.all === true,
      cwd: opts.cwd ?? process.cwd(),
      skipMermaidParse: opts.skipMermaidParse === true,
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

program
  .command('serve')
  .description('Start the YorZ Service (HTTP + SSE + static GUI; multi-project).')
  .option('-p, --port <port>', 'port to listen on', '7423')
  .option('--open', 'open the GUI in the default browser', false)
  .option(
    '--cwd <path>',
    'directory to auto-register when it contains .yorz/ (default: process.cwd())',
  )
  .option('--no-register-cwd', 'do not auto-register the current directory')
  .action(async (opts: ServeOpts) => {
    const port = opts.port === undefined ? undefined : Number.parseInt(opts.port, 10)
    if (port !== undefined && (!Number.isFinite(port) || port < 0)) {
      throw new Error(`Invalid --port: ${opts.port}`)
    }
    await runServe({
      port,
      open: opts.open,
      cwd: opts.cwd,
      noRegisterCwd: opts.noRegisterCwd === false ? true : false,
    })
  })

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`error: ${err.message}`)
  process.exit(1)
})

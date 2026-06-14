import { homedir } from 'node:os'
import { Command } from 'commander'
import { install } from './install.js'
import { uninstall } from './uninstall.js'
import type { AgentName, InstallScope } from './adapters/types.js'

interface CliOpts {
  agent: string
  scope: string
}

function parseAgent(value: string): AgentName {
  if (value === 'claude' || value === 'opencode') return value
  throw new Error(`Invalid --agent: ${value}. Use 'claude' or 'opencode'.`)
}

function parseScope(value: string): InstallScope {
  if (value === 'user' || value === 'project') return value
  throw new Error(`Invalid --scope: ${value}. Use 'user' or 'project'.`)
}

const program = new Command()
program.name('yorz').description('YorZ CLI — manage the yorz-spec skill.').version('0.0.1')

program
  .command('install')
  .description('Install the yorz-spec skill into the target agent.')
  .option('-a, --agent <agent>', 'target agent: claude | opencode', 'claude')
  .option('-s, --scope <scope>', 'install scope: user | project', 'user')
  .action(async (opts: CliOpts) => {
    const agent = parseAgent(opts.agent)
    const scope = parseScope(opts.scope)
    const result = await install({ agent, scope, home: homedir(), cwd: process.cwd() })
    const verb = result.overwritten ? 'overwritten' : 'installed'
    console.log(`${verb}: ${result.path}`)
  })

program
  .command('uninstall')
  .description('Remove the yorz-spec skill from the target agent.')
  .option('-a, --agent <agent>', 'target agent: claude | opencode', 'claude')
  .option('-s, --scope <scope>', 'uninstall scope: user | project', 'user')
  .action(async (opts: CliOpts) => {
    const agent = parseAgent(opts.agent)
    const scope = parseScope(opts.scope)
    const result = await uninstall({ agent, scope, home: homedir(), cwd: process.cwd() })
    if (result.removed) console.log(`removed: ${result.path}`)
    else console.log(`not installed at ${result.path}`)
  })

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`error: ${err.message}`)
  process.exit(1)
})

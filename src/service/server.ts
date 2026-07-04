import { Hono } from 'hono'
import { createSpecsRoutes } from './routes/specs.js'
import { createSpecReviewRoutes } from './routes/spec-review.js'
import { createEventsRoutes } from './routes/events.js'
import { createProjectRoutes } from './routes/project.js'
import { createProjectConfigRoutes } from './routes/project-config.js'
import { createSpecDraftsRoutes } from './routes/spec-drafts.js'
import { createWorktreeRoutes } from './routes/worktree.js'
import { createAgentLogsRoutes } from './routes/agent-logs.js'
import { createProjectFilesRoutes } from './routes/project-files.js'
import { createStaticRoutes } from './static.js'
import type { ProjectRegistry } from './project-registry.js'
import { RegistryEventBus } from './registry-events.js'
import { WorktreeManager } from './worktree-manager.js'

export interface CreateAppOptions {
  registry: ProjectRegistry
  guiRoot?: string
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono()

  const api = new Hono()
  const resolveProject = (id: string) => opts.registry.getOrCreate(id)
  const projectsBus = new RegistryEventBus()
  projectsBus.start(opts.registry.configPath())
  const worktreeManager = new WorktreeManager({
    registry: opts.registry,
    onProjectsChanged: () => projectsBus.emit(),
    triggerConflictAgent: async (mainProjectId, specId) => {
      const main = await opts.registry.getOrCreate(mainProjectId)
      if (!main) {
        console.warn(
          `[worktree] cannot launch conflict Agent: main project ${mainProjectId} not resolvable`,
        )
        return
      }
      main.runner.run({
        specId,
        mode: 'skill-run',
        prompt: `请使用 yorz-spec skill 处理 spec：${main.specsDirRelative}/${specId}/spec.md`,
      })
    },
  })

  api.route('/', createProjectRoutes(opts.registry, worktreeManager))
  api.route('/', createProjectConfigRoutes(opts.registry))
  api.route('/', createSpecsRoutes(resolveProject))
  api.route('/', createSpecReviewRoutes(resolveProject))
  api.route('/', createSpecDraftsRoutes(resolveProject))
  api.route('/', createWorktreeRoutes(opts.registry, worktreeManager))
  api.route('/', createAgentLogsRoutes(resolveProject))
  api.route('/', createProjectFilesRoutes(resolveProject))
  api.route('/', createEventsRoutes(resolveProject, opts.registry, projectsBus))
  app.route('/api', api)

  app.route('/', createStaticRoutes(opts.guiRoot))

  return app
}

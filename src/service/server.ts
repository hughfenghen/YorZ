import { Hono } from 'hono'
import { createSpecsRoutes } from './routes/specs.js'
import { createEventsRoutes } from './routes/events.js'
import { createProjectRoutes } from './routes/project.js'
import { createProjectConfigRoutes } from './routes/project-config.js'
import { createSpecDraftsRoutes } from './routes/spec-drafts.js'
import { createWorktreeRoutes } from './routes/worktree.js'
import { createStaticRoutes } from './static.js'
import type { ProjectRegistry } from './project-registry.js'
import { WorktreeManager } from './worktree-manager.js'

export interface CreateAppOptions {
  registry: ProjectRegistry
  guiRoot?: string
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono()

  const api = new Hono()
  const resolveProject = (id: string) => opts.registry.getOrCreate(id)
  const worktreeManager = new WorktreeManager({ registry: opts.registry })

  api.route('/', createProjectRoutes(opts.registry))
  api.route('/', createProjectConfigRoutes(opts.registry))
  api.route('/', createSpecsRoutes(resolveProject))
  api.route('/', createSpecDraftsRoutes(resolveProject))
  api.route('/', createWorktreeRoutes(opts.registry, worktreeManager))
  api.route('/', createEventsRoutes(resolveProject, opts.registry))
  app.route('/api', api)

  app.route('/', createStaticRoutes(opts.guiRoot))

  return app
}

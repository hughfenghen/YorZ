import { Hono } from 'hono'
import { createSpecsRoutes } from './routes/specs.js'
import { createSessionsRoutes } from './routes/sessions.js'
import { createSpecReviewRoutes } from './routes/spec-review.js'
import { createEventsRoutes } from './routes/events.js'
import { createProjectRoutes } from './routes/project.js'
import { createProjectConfigRoutes } from './routes/project-config.js'
import { createGlobalConfigRoutes } from './routes/global-config.js'
import { createSpecDraftsRoutes } from './routes/spec-drafts.js'
import { createWorktreeRoutes } from './routes/worktree.js'
import { createProjectFilesRoutes } from './routes/project-files.js'
import { createStaticRoutes } from './static.js'
import type { ProjectRegistry } from './project-registry.js'
import { RegistryEventBus } from './registry-events.js'
import { WorktreeManager } from './worktree-manager.js'
import { getLogger } from './logger.js'

export interface CreateAppOptions {
  registry: ProjectRegistry
  guiRoot?: string
}

/** Requests slower than this are surfaced at `warn` even when they succeed. */
const SLOW_REQUEST_MS = 1000

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono()
  const httpLog = getLogger().child('http')
  const worktreeLog = getLogger().child('worktree')

  app.use('*', async (c, next) => {
    const startedAt = Date.now()
    await next()
    const durationMs = Date.now() - startedAt
    const meta = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    }
    if (c.res.status >= 400) httpLog.warn('request failed', meta)
    else if (durationMs >= SLOW_REQUEST_MS) httpLog.warn('slow request', meta)
    else httpLog.debug('request', meta)
  })

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
        worktreeLog.warn('cannot launch conflict Agent: main project not resolvable', {
          mainProjectId,
          specId,
        })
        return
      }
      const { sessionId } = await main.sessions.ensureSessionForSpec(specId)
      void main.sessions.send(
        sessionId,
        `请使用 yorz-spec skill 处理 spec：${main.specsDirRelative}/${specId}/spec.md`,
      )
    },
  })

  api.route('/', createProjectRoutes(opts.registry, worktreeManager))
  api.route('/', createGlobalConfigRoutes(opts.registry.configPath()))
  api.route('/', createProjectConfigRoutes(opts.registry))
  api.route('/', createSpecsRoutes(resolveProject))
  api.route('/', createSessionsRoutes(resolveProject))
  api.route('/', createSpecReviewRoutes(resolveProject))
  api.route('/', createSpecDraftsRoutes(resolveProject))
  api.route('/', createWorktreeRoutes(opts.registry, worktreeManager))
  api.route('/', createProjectFilesRoutes(resolveProject))
  api.route('/', createEventsRoutes(resolveProject, opts.registry, projectsBus))
  app.route('/api', api)

  app.route('/', createStaticRoutes(opts.guiRoot))

  app.onError((err, c) => {
    httpLog.error('route error', {
      method: c.req.method,
      path: c.req.path,
      status: 500,
      message: err.message,
      stack: err.stack,
    })
    return c.json({ error: 'Internal Server Error', message: err.message }, 500)
  })

  return app
}

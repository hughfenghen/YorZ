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
import { createCommandsRoutes } from './routes/commands.js'
import { createSystemNotificationsRoutes } from './routes/system-notifications.js'
import { createStaticRoutes } from './static.js'
import type { ProjectRegistry } from './project-registry.js'
import { RegistryEventBus } from './registry-events.js'
import { WorktreeManager } from './worktree-manager.js'
import { getLogger } from './logger.js'
import type { SystemNotificationCenter } from './system-notifications.js'
import { skillRef } from './skill-ref.js'

export interface CreateAppOptions {
  registry: ProjectRegistry
  guiRoot?: string
  systemNotifications?: SystemNotificationCenter
  /** 受 runtime 随机令牌保护的本地停服回调。 */
  shutdown?: {
    token: string
    request: () => void
  }
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
  if (opts.shutdown) {
    api.post('/internal/shutdown', (c) => {
      const token = c.req.header('x-yorz-shutdown-token')
      if (token !== opts.shutdown!.token) return c.json({ error: 'Forbidden' }, 403)

      // 让 Node 先把响应交给 socket，再关闭监听器，避免 CLI 将正常停服误判为网络失败。
      setTimeout(opts.shutdown!.request, 0)
      return c.json({ accepted: true }, 202)
    })
  }
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
        `${skillRef('yorz-spec')}，然后处理 spec：${main.specsDirRelative}/${specId}/spec.md`,
      )
    },
  })

  api.route('/', createProjectRoutes(opts.registry, worktreeManager))
  if (opts.systemNotifications) {
    api.route('/', createSystemNotificationsRoutes(opts.systemNotifications))
  }
  api.route('/', createGlobalConfigRoutes(opts.registry.configPath()))
  api.route('/', createProjectConfigRoutes(opts.registry))
  api.route('/', createSpecsRoutes(resolveProject))
  api.route('/', createSessionsRoutes(resolveProject))
  api.route('/', createSpecReviewRoutes(resolveProject))
  api.route('/', createSpecDraftsRoutes(resolveProject))
  api.route('/', createWorktreeRoutes(opts.registry, worktreeManager))
  api.route('/', createProjectFilesRoutes(resolveProject))
  api.route('/', createCommandsRoutes(resolveProject))
  api.route(
    '/',
    createEventsRoutes(resolveProject, opts.registry, projectsBus, opts.systemNotifications),
  )
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

import { Hono } from 'hono'
import { createSpecsRoutes } from './routes/specs.js'
import { createSessionsRoutes } from './routes/sessions.js'
import { createSpecReviewRoutes } from './routes/spec-review.js'
import { createGitRoutes } from './routes/git.js'
import { createEventsRoutes } from './routes/events.js'
import { createProjectRoutes } from './routes/project.js'
import { createProjectConfigRoutes } from './routes/project-config.js'
import { createGlobalConfigRoutes } from './routes/global-config.js'
import { createPushRoutes } from './routes/push.js'
import { createSpecDraftsRoutes } from './routes/spec-drafts.js'
import { createWorktreeRoutes } from './routes/worktree.js'
import { createProjectFilesRoutes } from './routes/project-files.js'
import { createFsRoutes } from './routes/fs.js'
import { createCommandsRoutes } from './routes/commands.js'
import { createSystemNotificationsRoutes } from './routes/system-notifications.js'
import { createPairingRoutes } from './routes/pairing.js'
import { createStaticRoutes } from './static.js'
import { createAuthStore, type AuthStore } from './auth-store.js'
import type { ProjectRegistry } from './project-registry.js'
import { RegistryEventBus } from './registry-events.js'
import { WorktreeManager } from './worktree-manager.js'
import { getLogger } from './logger.js'
import type { SystemNotificationCenter } from './system-notifications.js'
import { buildSpecDispatch } from './slash-command.js'

export interface CreateAppOptions {
  registry: ProjectRegistry
  guiRoot?: string
  systemNotifications?: SystemNotificationCenter
  /** 配对鉴权令牌 store；未提供时按全局配置目录惰性创建。 */
  authStore?: AuthStore
  /** 关闭 /api 配对鉴权中间件（仅供聚焦非鉴权行为的集成测试）。生产不应设置。 */
  disableAuth?: boolean
  /** 受 runtime 随机令牌保护的本地停服回调。 */
  shutdown?: {
    token: string
    request: () => void
  }
}

/**
 * 命中放行清单的 `/api/*` 路径（不需携带配对令牌）：
 * - `/api/pairing/claim`：设备引导入口，无令牌时用于以配对码换设备令牌；
 * - `/api/internal/shutdown`：有自身的 `x-yorz-shutdown-token` 校验。
 */
const AUTH_ALLOWLIST = new Set(['/api/pairing/claim', '/api/internal/shutdown'])

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
  const authStore = opts.authStore ?? createAuthStore(opts.registry.configPath())

  // 能力 URL / 持有令牌模型：/api/* 一律校验 bearer 令牌（主令牌或设备令牌），
  // 放行清单内的握手/停服入口除外。静态资源不走 /api，天然放行。
  if (!opts.disableAuth) {
    api.use('*', async (c, next) => {
      if (AUTH_ALLOWLIST.has(c.req.path)) return next()
      // EventSource 无法设置自定义头，故 SSE 走 `?token=` query；其余请求用 header。
      const token = c.req.header('x-yorz-pair-token') ?? c.req.query('token')
      if (await authStore.validateToken(token)) return next()
      return c.json({ error: 'Unauthorized' }, 401)
    })
  }

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
  // 会话 running 翻转 → 防抖广播 projects-changed，驱动项目侧栏呼吸点刷新。
  opts.registry.setSessionActivityListener(() => projectsBus.emitDebounced())
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
      // Same-spec serialization, without an HTTP caller to report to: skip the
      // dispatch rather than run a second agent against the same spec.md.
      if (await main.sessions.isSpecRunning(specId)) {
        worktreeLog.warn('skip conflict Agent: spec already has a running session', {
          mainProjectId,
          specId,
        })
        return
      }
      const { sessionId } = await main.sessions.createSessionForSpec(specId)
      const { commandLine, prompt } = buildSpecDispatch({
        specsDirRelative: main.specsDirRelative,
        specId,
        debug: false,
      })
      void main.sessions.send(sessionId, prompt, commandLine, { trigger: 'conflict', specId })
    },
  })

  api.route('/', createProjectRoutes(opts.registry, worktreeManager))
  if (opts.systemNotifications) {
    api.route('/', createSystemNotificationsRoutes(opts.systemNotifications))
  }
  api.route('/', createGlobalConfigRoutes(opts.registry.configPath()))
  api.route('/', createPushRoutes(opts.registry.configPath()))
  api.route('/', createPairingRoutes(authStore))
  api.route('/', createProjectConfigRoutes(opts.registry))
  api.route('/', createSpecsRoutes(resolveProject))
  api.route('/', createSessionsRoutes(resolveProject))
  api.route('/', createSpecReviewRoutes(resolveProject))
  api.route('/', createGitRoutes(resolveProject))
  api.route('/', createSpecDraftsRoutes(resolveProject))
  api.route('/', createWorktreeRoutes(opts.registry, worktreeManager))
  api.route('/', createProjectFilesRoutes(resolveProject))
  api.route('/', createFsRoutes())
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

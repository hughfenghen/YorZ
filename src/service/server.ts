import { Hono } from 'hono'
import { createSpecsRoutes } from './routes/specs.js'
import { createEventsRoutes } from './routes/events.js'
import { createProjectRoutes } from './routes/project.js'
import { createStaticRoutes } from './static.js'
import type { SpecStore } from './spec-store.js'
import type { SpecWatcher } from './watcher.js'
import type { AgentRunner } from './agent.js'

export interface CreateAppOptions {
  store: SpecStore
  watcher: SpecWatcher
  runner: AgentRunner
  cwd: string
  guiRoot?: string
}

export function createApp(opts: CreateAppOptions): Hono {
  const app = new Hono()

  const api = new Hono()
  api.route('/', createSpecsRoutes({ store: opts.store, runner: opts.runner }))
  api.route(
    '/',
    createEventsRoutes({ store: opts.store, watcher: opts.watcher, runner: opts.runner }),
  )
  api.route('/', createProjectRoutes(opts.cwd))
  app.route('/api', api)

  app.route('/', createStaticRoutes(opts.guiRoot))

  return app
}

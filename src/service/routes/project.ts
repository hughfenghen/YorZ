import { Hono } from 'hono'
import { basename } from 'node:path'

export function createProjectRoutes(cwd: string): Hono {
  const app = new Hono()
  app.get('/projects/current', (c) => {
    return c.json({ cwd, name: basename(cwd) })
  })
  return app
}

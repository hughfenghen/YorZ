import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { Hono } from 'hono'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
}

export function createStaticRoutes(guiRoot?: string): Hono {
  const root = guiRoot ?? defaultGuiRoot()
  const app = new Hono()

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api')) return c.notFound()
    const file = resolveStaticFile(root, c.req.path)
    if (file) return serveFile(c, file)
    const indexPath = join(root, 'index.html')
    if (existsSync(indexPath)) return serveFile(c, indexPath)
    return c.text('YorZ GUI is not built. Run `pnpm build:gui` first, then reload this page.', 503)
  })

  return app
}

function defaultGuiRoot(): string {
  // The CLI script lives at dist/cli/index.js; the GUI bundle sits at dist/gui.
  // We compute the path from process.argv[1] so the resolution survives Vite's
  // lib-mode bundling (which would otherwise inline import.meta.url as a data: URL).
  const entry = process.argv[1]
  if (entry) return resolve(dirname(entry), '..', 'gui')
  return resolve(process.cwd(), 'dist', 'gui')
}

function resolveStaticFile(root: string, urlPath: string): string | null {
  const safe = normalize(urlPath).replace(/^\/+/, '')
  if (safe.startsWith('..')) return null
  const candidate = safe === '' ? join(root, 'index.html') : join(root, safe)
  if (!candidate.startsWith(root)) return null
  if (!existsSync(candidate)) return null
  const stats = statSync(candidate)
  if (stats.isDirectory()) {
    const idx = join(candidate, 'index.html')
    return existsSync(idx) ? idx : null
  }
  return candidate
}

async function serveFile(c: import('hono').Context, file: string): Promise<Response> {
  const body = await readFile(file)
  const mime = MIME[extname(file)] ?? 'application/octet-stream'
  c.header('Content-Type', mime)
  return c.body(body)
}

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // PWA 清单：用 application/json 也能跑，但 Chrome 的安装性检查会报警告
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  // 自托管字体：类型错了 Firefox 会直接拒绝加载
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/**
 * 移动端 PWA 的挂载前缀。三处必须一致：这里、vite.gui-mobile.config.ts 的 base、
 * 以及 manifest 的 start_url/scope。Service Worker 的控制范围由它所在目录决定，
 * 前缀对不上 SW 就接管不到页面（或反过来越界接管桌面端）。
 */
const MOBILE_PREFIX = '/m'

export function createStaticRoutes(guiRoot?: string): Hono {
  const root = guiRoot ?? defaultGuiRoot()
  // 两份产物是 dist 下的兄弟目录，跟着 guiRoot 走，测试覆盖 guiRoot 时无需再传一个参数
  const mobileRoot = resolve(root, '..', 'gui-mobile')
  const app = new Hono()

  // /m 与 /m/ 必须都能进：少了这条重定向，用户手输不带斜杠的地址会落到桌面端的
  // SPA 兜底上，拿到桌面端 index.html。
  app.get(MOBILE_PREFIX, (c) => c.redirect(`${MOBILE_PREFIX}/`))

  app.get(`${MOBILE_PREFIX}/*`, async (c) => {
    // 去掉前缀后按移动端产物根目录解析；保留前导斜杠交给 resolveStaticFile 归一化
    const subPath = c.req.path.slice(MOBILE_PREFIX.length) || '/'
    const file = resolveStaticFile(mobileRoot, subPath)
    if (file) return serveFile(c, file)
    const indexPath = join(mobileRoot, 'index.html')
    if (existsSync(indexPath)) return serveFile(c, indexPath)
    return c.text(
      'YorZ mobile GUI is not built. Run `pnpm build:gui-mobile` first, then reload this page.',
      503,
    )
  })

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
  // The CLI bundle lives at dist/cli/index.js; the GUI sits at dist/gui (sibling).
  // Resolve from the module's own location, not process.argv[1]: under a global
  // install the bin is a symlink and argv[1] points at the bin dir (Node does not
  // realpath argv[1]), which would send us looking for gui/ outside the package.
  // import.meta.url is realpath'd by Node for ESM, so it survives the symlink.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return resolve(here, '..', 'gui')
  } catch {
    const entry = process.argv[1]
    if (entry) return resolve(dirname(entry), '..', 'gui')
    return resolve(process.cwd(), 'dist', 'gui')
  }
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
  const ext = extname(file)
  const mime = MIME[ext] ?? 'application/octet-stream'
  c.header('Content-Type', mime)
  // 入口页与 Service Worker 必须每次回源校验：它们的 URL 不带内容哈希，
  // 一旦被浏览器的启发式缓存留住，用户会一直卡在旧版本上（PWA 尤其明显——
  // 旧 sw.js 会继续用旧的预缓存清单服务页面）。带哈希的资源不受影响。
  if (ext === '.html' || /\bsw\.js$/.test(file) || /\bregisterSW\.js$/.test(file)) {
    c.header('Cache-Control', 'no-cache')
  }
  return c.body(body)
}

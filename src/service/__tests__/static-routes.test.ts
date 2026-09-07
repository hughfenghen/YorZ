import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { createStaticRoutes } from '../static.js'

/**
 * 两个前端共用一个静态服务：桌面端在 `/`，移动端 PWA 在 `/m/`。
 * 这里盯住的是「前缀剥离」和「SPA 兜底不越界」——移动端的 SW 一旦拿到桌面端的
 * index.html，安装出来的应用就是错的，而且会被缓存住，很难在真机上定位。
 */

let dist: string
let app: Hono

async function seed(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dist, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
}

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'yorz-static-'))
})

afterEach(async () => {
  await rm(dist, { recursive: true, force: true })
})

function mount(): void {
  app = new Hono()
  app.route('/', createStaticRoutes(join(dist, 'gui')))
}

describe('createStaticRoutes', () => {
  it('serves the desktop SPA at / and falls back to its index for unknown paths', async () => {
    await seed({
      'gui/index.html': '<html>desktop</html>',
      'gui/assets/app.js': 'console.log(1)',
      'gui-mobile/index.html': '<html>mobile</html>',
    })
    mount()

    expect(await (await app.request('/')).text()).toBe('<html>desktop</html>')
    expect(await (await app.request('/some/spec/route')).text()).toBe('<html>desktop</html>')

    const asset = await app.request('/assets/app.js')
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
  })

  it('serves the mobile SPA under /m/ and strips the prefix when resolving files', async () => {
    await seed({
      'gui/index.html': '<html>desktop</html>',
      'gui-mobile/index.html': '<html>mobile</html>',
      'gui-mobile/manifest.webmanifest': '{"name":"YorZ"}',
      'gui-mobile/icons/icon-192.png': 'png-bytes',
    })
    mount()

    expect(await (await app.request('/m/')).text()).toBe('<html>mobile</html>')
    // 深链直达必须回落到**移动端**入口，不能漏到桌面端的兜底上
    expect(await (await app.request('/m/settings')).text()).toBe('<html>mobile</html>')
    expect(await (await app.request('/m/icons/icon-192.png')).text()).toBe('png-bytes')

    const manifest = await app.request('/m/manifest.webmanifest')
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8')
  })

  it('redirects /m to /m/ so the service worker scope still matches', async () => {
    await seed({ 'gui/index.html': 'd', 'gui-mobile/index.html': 'm' })
    mount()

    const res = await app.request('/m')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/m/')
  })

  it('redirects mobile root visits to /m/ without affecting desktop root visits', async () => {
    await seed({
      'gui/index.html': '<html>desktop</html>',
      'gui-mobile/index.html': '<html>mobile</html>',
    })
    mount()

    const mobile = await app.request('/', {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile' },
    })
    expect(mobile.status).toBe(302)
    expect(mobile.headers.get('location')).toBe('/m/')

    const desktop = await app.request('/', {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    })
    expect(await desktop.text()).toBe('<html>desktop</html>')
  })

  it('honors client hints when deciding whether the root visit is mobile', async () => {
    await seed({ 'gui/index.html': 'd', 'gui-mobile/index.html': 'm' })
    mount()

    const res = await app.request('/', { headers: { 'sec-ch-ua-mobile': '?1' } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/m/')
  })

  it('marks the entry document and the service worker as no-cache', async () => {
    await seed({
      'gui/index.html': 'd',
      'gui-mobile/index.html': 'm',
      'gui-mobile/sw.js': 'self.skipWaiting()',
      'gui-mobile/assets/index-abc123.js': 'hashed',
    })
    mount()

    expect((await app.request('/m/')).headers.get('cache-control')).toBe('no-cache')
    expect((await app.request('/m/sw.js')).headers.get('cache-control')).toBe('no-cache')
    // 带内容哈希的资源不该被打上 no-cache，否则每次导航都要重下整包
    expect((await app.request('/m/assets/index-abc123.js')).headers.get('cache-control')).toBeNull()
  })

  it('reports 503 for /m when only the desktop GUI has been built', async () => {
    await seed({ 'gui/index.html': '<html>desktop</html>' })
    mount()

    const res = await app.request('/m/')
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('build:gui-mobile')
  })

  it('never answers /api from the static tree', async () => {
    await seed({ 'gui/index.html': 'd', 'gui-mobile/index.html': 'm' })
    mount()

    expect((await app.request('/api/projects')).status).toBe(404)
  })
})

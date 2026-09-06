import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string
}

/**
 * 移动端 GUI（PWA）的构建配置，与 vite.gui.config.ts 是两个独立应用：
 * 同一套技术栈（Solid + Vite + Tailwind + Kobalte + i18next），不同的入口与产物目录。
 *
 * 为什么挂在 `/m/` 而不是根路径：桌面端已经占了 `/`，而 Service Worker 的控制范围
 * 受 scope 限制、只能覆盖自身所在目录及其子路径。把移动端整体放进 `/m/`，
 * SW 就只接管移动端的导航请求，不会劫持桌面端页面，也不会缓存到 `/api`。
 * 这里的 base 必须与 src/service/static.ts 里的挂载前缀、以及 manifest 的
 * start_url/scope 保持一致，改动需要三处同步。
 */
const BASE = '/m/'

export default defineConfig({
  root: resolve(__dirname, 'src/gui-mobile'),
  base: BASE,
  plugins: [
    solid(),
    VitePWA({
      // 新版本上线后自动接管，不给用户留「点一下才更新」的旧壳；
      // 需要提示式更新时改成 'prompt' 并在 src/lib/pwa.ts 里接住回调。
      registerType: 'autoUpdate',
      // 注册代码由 src/lib/pwa.ts 显式引入 virtual:pwa-register 完成，
      // 避免插件再往 index.html 里塞一段无法控制时序的内联脚本。
      injectRegister: null,
      manifest: {
        id: BASE,
        name: 'YorZ Mobile',
        short_name: 'YorZ',
        description: 'YorZ 移动端：随时随地查看与推进 spec',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        lang: 'zh-CN',
        // 与 app.css 中 paper 亮色主题的 --background/--primary 对齐，
        // 保证启动画面与首屏之间没有色块跳变。
        background_color: '#f2f2e9',
        theme_color: '#146638',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA 直连深层路由时回落到入口页；但 /api 必须走网络，
        // 否则接口请求会被 SW 用 index.html 应答。
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // 开发期也生成 SW，方便在真机上验证安装/离线行为
        enabled: true,
        type: 'module',
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  resolve: {
    alias: {
      // 刻意没有指向 src/gui 的别名：两个前端是各自独立的 TS composite 工程，
      // 跨工程直引源码会让文件同时归属两个 project，破坏增量构建。
      // 需要共享逻辑时抽成独立模块、两边各自 include —— 样式走
      // src/styles/theme-tokens.css，TS 逻辑走下面的 @shared。
      '@': resolve(__dirname, 'src/gui-mobile/src'),
      '@shared': resolve(__dirname, 'src/gui-shared'),
    },
  },
  // 版本号来自 package.json，避免设置页里再手抄一份
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: resolve(__dirname, 'dist/gui-mobile'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:7424',
    },
  },
})

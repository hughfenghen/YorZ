/* @refresh reload */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import './i18n/config.js'
import { initTheme } from './lib/theme.js'
import { initPWA } from './lib/pwa.js'
import { AppShell } from './AppShell.jsx'
import { Home } from './pages/Home.jsx'
import { Specs } from './pages/Specs.jsx'
import { Settings } from './pages/Settings.jsx'
import { NotFound } from './pages/NotFound.jsx'

// 早于首次渲染接管主题（index.html 的内联脚本已写好初始属性，这里只是绑定后续变化）
initTheme()
// SW 注册不阻塞首屏：registerSW 内部是异步的，失败也只是降级成纯在线应用
initPWA()

const root = document.getElementById('app')
if (!root) throw new Error('missing #app root')

render(
  () => (
    /*
     * base 与 vite.gui-mobile.config.ts 的 base、以及服务端挂载前缀必须一致：
     * 应用整体挂在 /m/ 下，路由若按 / 计算，深链刷新后会算错路径。
     */
    <Router root={AppShell} base="/m">
      <Route path="/" component={Home} />
      <Route path="/specs" component={Specs} />
      <Route path="/settings" component={Settings} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
)

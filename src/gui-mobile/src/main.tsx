/* @refresh reload */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import './i18n/config.js'
import { initTheme } from './lib/theme.js'
import { initPWA } from './lib/pwa.js'
import { AppShell } from './AppShell.jsx'
import { Sessions } from './pages/Sessions.jsx'
import { Specs } from './pages/Specs.jsx'
import { Extensions } from './pages/Extensions.jsx'
import { Projects } from './pages/Projects.jsx'
import { GlobalSettings } from './pages/settings/GlobalSettings.jsx'
import { ProjectSettings } from './pages/settings/ProjectSettings.jsx'
import { NotFound } from './pages/NotFound.jsx'

// 早于首次渲染接管主题（index.html 的内联脚本已写好初始属性，这里只是绑定后续变化）
// 移动端没有服务端外观真值这一层，首屏提示由主题模块自己写 localStorage。
initTheme({ persistHint: true })
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
      {/* 四个一级页面与底部导航一一对应，见 components/TabBar.tsx */}
      <Route path="/" component={Sessions} />
      <Route path="/specs" component={Specs} />
      <Route path="/ext" component={Extensions} />
      <Route path="/projects" component={Projects} />
      {/* 二级页面：本次只实现两个设置页，其余入口点击弹「即将支持」 */}
      <Route path="/settings/global" component={GlobalSettings} />
      <Route path="/settings/project" component={ProjectSettings} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
)

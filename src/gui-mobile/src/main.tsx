/* @refresh reload */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import './i18n/config.js'
import { initTheme } from './lib/theme.js'
import { ROUTER_BASE } from './lib/routes.js'
import { initPWA } from './lib/pwa.js'
import { AppShell } from './AppShell.jsx'
import { Sessions } from './pages/Sessions.jsx'
import { Specs } from './pages/Specs.jsx'
import { ChatDetail } from './pages/ChatDetail.jsx'
import { SpecDetail } from './pages/SpecDetail.jsx'
import { NewSpec } from './pages/NewSpec.jsx'
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
    <Router root={AppShell} base={ROUTER_BASE}>
      {/* 四个一级页面与底部导航一一对应，见 components/TabBar.tsx */}
      <Route path="/" component={Sessions} />
      <Route path="/specs" component={Specs} />
      <Route path="/ext" component={Extensions} />
      <Route path="/projects" component={Projects} />
      {/*
        二级页面。/specs/new 必须排在 /specs/:id 之前：Solid Router 里静态段
        虽然优先级更高，但把顺序写反会让「新建」在阅读时被误当成一个 id。
        会话详情与新建会话共用 ChatDetail，按 params.id 是否存在分支。
      */}
      <Route path="/sessions/new" component={ChatDetail} />
      <Route path="/sessions/:id" component={ChatDetail} />
      <Route path="/specs/new" component={NewSpec} />
      <Route path="/specs/:id" component={SpecDetail} />
      <Route path="/settings/global" component={GlobalSettings} />
      <Route path="/settings/project" component={ProjectSettings} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
)

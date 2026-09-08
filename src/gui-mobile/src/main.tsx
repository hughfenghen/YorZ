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
import { SpecGit } from './pages/SpecGit.jsx'
import { NewSpec } from './pages/NewSpec.jsx'
import { Extensions } from './pages/Extensions.jsx'
import { Scripts } from './pages/ext/Scripts.jsx'
import { RunOutput } from './pages/ext/RunOutput.jsx'
import { GitStatus } from './pages/ext/GitStatus.jsx'
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
      */}
      {/*
        草稿与会话详情必须是**同一条 Route**，两个 path 写进数组里。

        solid-router 判断「路由切换时能否复用已挂载的实例」看的是 `route.key`，
        而 key 就是这条 Route 的定义对象本身：写成两条 Route 就是两个对象，
        `/sessions/new → /sessions/<id>` 于是走 dispose + createRoot，ChatDetail
        整个重建——首发时刚压进去的用户气泡、以及「本 tab 的内存消息比磁盘
        transcript 更完整」这个凭据（freshSids）随实例一起消失，页面退回空白，
        随后只剩 Agent 的输出。同一条 Route 的数组 path 展开出的各分支共享同一个
        key，实例被复用；`params.id` 是响应式的，草稿分支下仍是 undefined，
        页面按它分支即可。顺序不必操心：静态段计 3 分、`:param` 计 2 分，
        `/sessions/new` 的匹配分天然高于 `/sessions/:id`。
      */}
      <Route path={['/sessions/new', '/sessions/:id']} component={ChatDetail} />
      <Route path="/specs/new" component={NewSpec} />
      <Route path="/specs/:id" component={SpecDetail} />
      {/* spec 作用域的 git 三级页；深度不同，不与上面两条相互遮挡。 */}
      <Route path="/specs/:id/git" component={SpecGit} />
      {/* 同理，两条静态的扩展二级页排在 /ext/runs/:runId 之前。 */}
      <Route path="/ext/scripts" component={Scripts} />
      <Route path="/ext/git" component={GitStatus} />
      <Route path="/ext/runs/:runId" component={RunOutput} />
      <Route path="/settings/global" component={GlobalSettings} />
      <Route path="/settings/project" component={ProjectSettings} />
      <Route path="*" component={NotFound} />
    </Router>
  ),
  root,
)

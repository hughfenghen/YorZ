/* @refresh reload */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import './i18n/config.js'
import { SpecList } from './pages/SpecList.jsx'
import { NewSpec } from './pages/NewSpec.jsx'
import { SpecDetail } from './pages/SpecDetail.jsx'
import { SpecReview } from './pages/SpecReview.jsx'
import { SpecDebug } from './pages/SpecDebug.jsx'
import { CommandRunDetail } from './pages/CommandRunDetail.jsx'
import { ProjectIndexRedirect } from './pages/ProjectIndexRedirect.jsx'
import { WelcomePage } from './pages/Welcome.jsx'
import { AppShell } from './AppShell.jsx'

const root = document.getElementById('app')
if (!root) throw new Error('missing #app root')

render(
  () => (
    <Router root={AppShell}>
      <Route path="/" component={ProjectIndexRedirect} />
      <Route path="/:projectId" component={SpecList} />
      <Route path="/:projectId/commands/:runId" component={CommandRunDetail} />
      <Route path="/:projectId/specs/new" component={NewSpec} />
      <Route path="/:projectId/specs/:id" component={SpecDetail} />
      <Route path="/:projectId/specs/:id/review" component={SpecReview} />
      <Route path="/:projectId/specs/:id/debug" component={SpecDebug} />
      <Route path="*" component={WelcomePage} />
    </Router>
  ),
  root,
)

queueMicrotask(() => {
  const body = document.body
  const doc = document.documentElement
  console.log('[body-overflow-diagnostic]', {
    bodyScrollHeight: body.scrollHeight,
    bodyClientHeight: body.clientHeight,
    docScrollHeight: doc.scrollHeight,
    docClientHeight: doc.clientHeight,
    windowInnerHeight: window.innerHeight,
    bodyOverflowing: body.scrollHeight > body.clientHeight,
    docOverflowing: doc.scrollHeight > doc.clientHeight,
  })
})

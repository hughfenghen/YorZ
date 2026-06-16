/* @refresh reload */
import { render } from 'solid-js/web'
import { Router, Route } from '@solidjs/router'
import { Home } from './pages/Home.jsx'
import { NewSpec } from './pages/NewSpec.jsx'
import { SpecDetail } from './pages/SpecDetail.jsx'
import { AppShell } from './AppShell.jsx'

const root = document.getElementById('app')
if (!root) throw new Error('missing #app root')

render(
  () => (
    <Router root={AppShell}>
      <Route path="/" component={Home} />
      <Route path="/specs/new" component={NewSpec} />
      <Route path="/specs/:id" component={SpecDetail} />
    </Router>
  ),
  root,
)

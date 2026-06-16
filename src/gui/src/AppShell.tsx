import { A } from '@solidjs/router'
import type { JSX, ParentComponent } from 'solid-js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  return (
    <div class="app">
      <header class="topbar">
        <A href="/" class="brand">
          YorZ
        </A>
        <A href="/specs/new" class="primary-action">
          ＋ 新建 spec
        </A>
      </header>
      <main class="content">{props.children}</main>
    </div>
  )
}

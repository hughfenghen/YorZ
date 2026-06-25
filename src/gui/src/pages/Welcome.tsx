import { type Component } from 'solid-js'

export const WelcomePage: Component = () => {
  return (
    <section class="page welcome">
      <header class="page-head">
        <h1>欢迎使用 YorZ</h1>
      </header>
      <p class="muted">
        YorZ 通过本地目录托管 spec 文档；请先添加一个项目目录，然后即可开始管理它的需求。
      </p>
      <p class="projects-sidebar-hint">
        添加项目请在终端执行：
        <code>yorz add &lt;path&gt;</code>
      </p>
    </section>
  )
}

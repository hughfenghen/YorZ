import { createSignal, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api } from '../lib/api.js'
import { promptAddProject } from '../components/ProjectsSidebar.jsx'

export const WelcomePage: Component = () => {
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  async function onAdd() {
    if (busy()) return
    setError(null)
    setBusy(true)
    try {
      const path = await promptAddProject()
      if (!path) return
      const entry = await api.addProject(path)
      navigate(`/${encodeURIComponent(entry.id)}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="page welcome">
      <header class="page-head">
        <h1>欢迎使用 YorZ</h1>
      </header>
      <p class="muted">
        YorZ 通过本地目录托管 spec 文档；请先添加一个项目目录，然后即可开始管理它的需求。
      </p>
      <button class="primary-action" disabled={busy()} onClick={() => void onAdd()}>
        ＋ 添加你的第一个项目
      </button>
      {error() && <p class="error">{error()}</p>}
    </section>
  )
}

import { For, Show, Suspense, createResource, type Component } from 'solid-js'
import { A } from '@solidjs/router'
import { api, type SpecListItem } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'

export const Home: Component = () => {
  const projectId = useCurrentProjectId()
  const [specs, { refetch }] = createResource<SpecListItem[], string>(projectId, (pid) =>
    pid ? api.listSpecs() : Promise.resolve([]),
  )

  return (
    <section class="page">
      <header class="page-head">
        <h1>需求列表</h1>
        <button class="ghost" onClick={() => refetch()}>
          刷新
        </button>
      </header>
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <Show
          when={(specs() ?? []).length > 0}
          fallback={
            <div class="empty">
              <p>还没有 spec。</p>
              <A href={projectHref('specs/new')} class="primary-action">
                ＋ 新建第一个 spec
              </A>
            </div>
          }
        >
          <ul class="spec-grid">
            <For each={specs() ?? []}>
              {(spec) => (
                <li class="spec-card">
                  <A href={projectHref(`specs/${encodeURIComponent(spec.id)}`)}>
                    <div class="spec-card-head">
                      <span class={`badge stage-${spec.stage}`}>{spec.stage}</span>
                      <time>{spec.updated_at}</time>
                    </div>
                    <h2>{spec.title || '（待 Agent 补全）'}</h2>
                    <p class="summary">{spec.summary || '（待 Agent 补全）'}</p>
                    <code class="id">{spec.id}</code>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>
    </section>
  )
}

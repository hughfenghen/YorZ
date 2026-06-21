import { For, Show, Suspense, createMemo, createResource, createSignal, type Component } from 'solid-js'
import { A } from '@solidjs/router'
import { api, type SpecListItem } from '../lib/api.js'
import { getRecentSpecs, clearRecentSpecs } from '../lib/recent-specs.js'

export const Home: Component = () => {
  const [specs, { refetch }] = createResource<SpecListItem[]>(() => api.listSpecs())
  const [recentTick, setRecentTick] = createSignal(0)

  const recentSpecs = createMemo(() => {
    recentTick()
    const all = specs() ?? []
    if (all.length === 0) return []
    const entries = getRecentSpecs()
    if (entries.length === 0) return []
    const byId = new Map(all.map((s) => [s.id, s]))
    return entries
      .map((e) => byId.get(e.specId))
      .filter((s): s is SpecListItem => s !== undefined)
  })

  function handleClearRecent() {
    if (window.confirm('确定要清空最近访问记录吗？')) {
      clearRecentSpecs()
      setRecentTick((t) => t + 1)
    }
  }

  return (
    <section class="page">
      <header class="page-head">
        <h1>需求列表</h1>
        <button class="ghost" onClick={() => refetch()}>
          刷新
        </button>
      </header>
      <Show when={recentSpecs().length > 0}>
        <section class="recent-specs">
          <div class="recent-specs-head">
            <h2 class="recent-specs-title">最近访问</h2>
            <button class="ghost recent-clear-btn" onClick={handleClearRecent}>
              清空
            </button>
          </div>
          <ul class="recent-specs-grid">
            <For each={recentSpecs()}>
              {(spec) => (
                <li class="spec-card recent-spec-card">
                  <A href={`/specs/${encodeURIComponent(spec.id)}`}>
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
        </section>
      </Show>
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <Show
          when={(specs() ?? []).length > 0}
          fallback={
            <div class="empty">
              <p>还没有 spec。</p>
              <A href="/specs/new" class="primary-action">
                ＋ 新建第一个 spec
              </A>
            </div>
          }
        >
          <ul class="spec-grid">
            <For each={specs() ?? []}>
              {(spec) => (
                <li class="spec-card">
                  <A href={`/specs/${encodeURIComponent(spec.id)}`}>
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

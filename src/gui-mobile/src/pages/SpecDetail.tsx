import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  startTransition,
  type Component,
} from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import morphdom from 'morphdom'
import { CircleHelp, MessageSquare } from 'lucide-solid'
import { api, type SpecDetail as SpecDetailDoc } from '@shared/api/index.js'
import { subscribeSession, subscribeSessions, subscribeSpec } from '@shared/api/sse.js'
import { renderMarkdown } from '@shared/lib/markdown.js'
import { renderMermaidCore } from '@shared/lib/mermaid-core.js'
import { parseConfirmQuestions } from '@shared/lib/question-parse.js'
import { specFilePath } from '@shared/lib/spec-path.js'
import { stageBadgeClass } from '@shared/lib/spec-meta.js'
import { formatSpecUpdatedAt } from '@shared/lib/time.js'
import { Page } from '@/components/Page.jsx'
import { ActionSheet } from '@/components/ActionSheet.jsx'
import { MermaidViewer } from '@/components/MermaidViewer.jsx'
import { QuestionSheet } from '@/components/QuestionSheet.jsx'
import { AppendSheet } from '@/components/AppendSheet.jsx'
import {
  ErrorNotice,
  LoadingNotice,
  NoProjectNotice,
  comingSoon,
} from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { copyText } from '@/lib/clipboard.js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/** 合并 agent 连续写盘产生的 SSE 事件风暴。 */
const SSE_DEBOUNCE_MS = 120
const FETCH_RETRIES = 3
const FETCH_BACKOFF_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * agent 与编辑器都是「临时文件 + rename」的原子写，refetch 落在那个窗口里就会
 * 看到文件不存在、接口回 404。重试几次；仍失败则回退上一份好文档而不是抛出——
 * fetcher 抛出会把 Suspense 永久钉在 loading 上。只有从未加载成功过的 spec
 * 才解析为 null（真正的不存在）。
 */
async function fetchSpecWithRetry(
  pid: string,
  id: string,
  prev: SpecDetailDoc | null | undefined,
): Promise<SpecDetailDoc | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await api.getSpec(pid, id)
    } catch (err) {
      const is404 = (err as Error).message.startsWith('404')
      if (!is404) throw err
      if (attempt < FETCH_RETRIES) await sleep(FETCH_BACKOFF_MS)
    }
  }
  return prev ?? null
}

/**
 * spec 详情：顶栏 / meta 卡 / 正文滚动区 / 右下角待确认项 FAB。
 *
 * 正文渲染与桌面端同一条链路：`renderMarkdown` 产出 HTML 字符串 → `morphdom`
 * 增量 diff 进 `<article>` → mermaid 补渲染新增节点。三段都不能省：全量替换
 * 会让正文高度瞬间塌成 0、滚动锚点失效，每次 SSE 刷新都把读者弹回顶部。
 */
export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const pid = () => activeProjectId() ?? ''

  const [refreshTick, setRefreshTick] = createSignal(0)
  const [running, setRunning] = createSignal(false)
  const [specSid, setSpecSid] = createSignal('')
  const [articleEl, setArticleEl] = createSignal<HTMLElement | null>(null)
  const [questionOpen, setQuestionOpen] = createSignal(false)
  const [appendOpen, setAppendOpen] = createSignal(false)
  const [moreOpen, setMoreOpen] = createSignal(false)
  const [diagram, setDiagram] = createSignal<string | null>(null)

  const [spec, { refetch }] = createResource<
    SpecDetailDoc | null,
    readonly [string, string, number]
  >(
    () => [pid(), params.id, refreshTick()] as const,
    async ([p, id], info) => fetchSpecWithRetry(p, id, info.value),
  )

  const questions = createMemo(() => {
    const s = spec()
    return s ? parseConfirmQuestions(s.body) : []
  })

  // SSE：spec 文档变更 → 防抖 refetch。放进 startTransition，否则资源重取会让
  // <Suspense> 重新挂起，正文容器被拆掉重建，滚动位置归零。
  createEffect(() => {
    const id = params.id
    const p = pid()
    if (!id || !p) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = subscribeSpec(p, id, {
      onUpdated: () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(
          () => void startTransition(() => setRefreshTick((n) => n + 1)),
          SSE_DEBOUNCE_MS,
        )
      },
    })
    onCleanup(() => {
      if (timer) clearTimeout(timer)
      unsub()
    })
  })

  /**
   * 只读探针：拿到这个 spec 已绑定的 session（没有就是 null，绝不新建）。
   * 它同时是「顶栏是否渲染跳会话 icon」和「running 初值」的来源——SSE 不回放
   * 快照，页面在后台轮次进行中被打开时只能靠这一发问出当前状态。
   */
  createEffect(() => {
    const id = params.id
    const p = pid()
    if (!id || !p) return
    void api
      .getSpecSession(p, id)
      .then(({ sessionId, running: r }) => {
        if (!sessionId) return
        setSpecSid(sessionId)
        setRunning(r)
      })
      .catch(() => {})
  })

  // 项目级 status 报告开始与结束（含别处发起的轮次）；单会话流只把它落回 false。
  createEffect(() => {
    const p = pid()
    const sid = specSid()
    if (!p || !sid) return
    const unsub = subscribeSessions(p, {
      onStatus: (ev) => {
        if (ev.sessionId === sid) setRunning(ev.running)
      },
    })
    onCleanup(unsub)
  })

  createEffect(() => {
    const p = pid()
    const sid = specSid()
    if (!p || !sid) return
    const unsub = subscribeSession(p, sid, {
      onEvent: (ev) => {
        if (ev.type === 'turn-completed' || ev.type === 'error') setRunning(false)
      },
    })
    onCleanup(unsub)
  })

  // 正文：renderMarkdown → morphdom 增量 diff → mermaid 补渲染。
  createEffect(() => {
    const el = articleEl()
    const s = spec()
    if (!el || !s) return
    const p = pid()

    let active = true
    let cleanupFn: (() => void) | undefined

    // projectId 必须传：附件 URL 的重写靠它，少了它 spec 里的
    // `attachments/xxx.png` 会保持相对路径并 404。
    const html = renderMarkdown(s.body, { specId: s.id, projectId: p || undefined })
    morphdom(el, `<article>${html}</article>`, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        // 源码没变的 mermaid 节点保持原样：否则每次刷新都会把已渲染的 SVG
        // 打回原始占位符，图表整屏闪一次。
        if (
          fromEl.classList?.contains('mermaid') &&
          fromEl.getAttribute('data-mermaid-source') ===
            (toEl as Element).getAttribute?.('data-mermaid-source')
        ) {
          return false
        }
        return true
      },
    })

    void renderMermaidCore(el).then((cleanup) => {
      if (!active) {
        cleanup()
        return
      }
      cleanupFn = cleanup
    })

    onCleanup(() => {
      active = false
      cleanupFn?.()
    })
  })

  /**
   * 正文里的图表点击 → 全屏查看。事件委托到容器：图表数量随文档变化，
   * 而 morphdom 会不断替换节点，逐个挂监听必然漏。
   */
  function onArticleClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return
    const host = e.target.closest('.mermaid')
    const svg = host?.querySelector('svg')
    if (!svg) return
    setDiagram(svg.outerHTML)
  }

  function goSession() {
    const sid = specSid()
    if (sid) navigate(`/sessions/${encodeURIComponent(sid)}`)
  }

  async function copySpecPath() {
    const ok = await copyText(specFilePath(params.id))
    showToast(
      ok ? t('specDetail.specPathCopied') : t('chat.filePathCopyFailed'),
      ok ? 'default' : 'error',
    )
    setMoreOpen(false)
  }

  return (
    <Page
      title={params.id}
      padded={false}
      onBack={() => navigate('/specs')}
      leading={
        <Show when={specSid()}>
          <button
            type="button"
            class="tap-target flex items-center justify-center rounded-md text-muted-foreground active:bg-accent"
            aria-label={t('specDetail.openSession')}
            onClick={goSession}
          >
            <MessageSquare size={20} aria-hidden="true" />
          </button>
        </Show>
      }
    >
      <Show when={pid()} fallback={<div class="px-4 py-4">{<NoProjectNotice />}</div>}>
        <Show when={!spec.loading || spec()} fallback={<LoadingNotice />}>
          <Show
            when={!spec.error}
            fallback={<ErrorNotice error={spec.error} onRetry={() => void refetch()} />}
          >
            <Show
              when={spec()}
              fallback={
                <p class="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('specDetail.notFound')}
                </p>
              }
            >
              {(doc) => (
                <>
                  {/* meta 卡：概要 / 阶段 / 更新时间 / 运行态。阶段徽章只读——
                      强制切 stage 是把文档状态机拧到不一致的操作，不该塞进
                      一块拇指随时会蹭到的区域。 */}
                  <section class="border-b border-border px-4 py-3">
                    <p class="text-sm leading-relaxed">
                      {doc().frontmatter.summary || t('common.pendingAgent')}
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        class={cn(
                          'rounded border px-1.5 py-0.5',
                          stageBadgeClass(doc().frontmatter.stage),
                        )}
                      >
                        {doc().frontmatter.stage}
                      </span>
                      <Show when={running()}>
                        <span class="flex items-center gap-1 text-primary">
                          <span class="size-2 animate-pulse rounded-full bg-primary" />
                          {t('specDetail.running')}
                        </span>
                      </Show>
                      <time class="text-muted-foreground">
                        {formatSpecUpdatedAt(doc().frontmatter.updated_at)}
                      </time>
                    </div>

                    {/* 动作行。debug / git 照常渲染但点击弹「即将支持」：
                        设计稿把它们画在这里，隐藏会让结构对不上；沿用上一个
                        spec 已确立的降级口径，不新造第三种表达。 */}
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="min-h-9 rounded-md border border-border px-3 text-xs active:bg-accent"
                        onClick={() => setAppendOpen(true)}
                      >
                        {t('specDetail.appendTask')}
                      </button>
                      <button
                        type="button"
                        class="min-h-9 rounded-md border border-border px-3 text-xs text-muted-foreground active:bg-accent"
                        onClick={comingSoon}
                      >
                        {t('specDetail.debug')}
                      </button>
                      <button
                        type="button"
                        class="min-h-9 rounded-md border border-border px-3 text-xs text-muted-foreground active:bg-accent"
                        onClick={comingSoon}
                      >
                        {t('specDetail.git')}
                      </button>
                      <button
                        type="button"
                        class="min-h-9 rounded-md border border-border px-3 text-xs text-muted-foreground active:bg-accent"
                        onClick={() => setMoreOpen(true)}
                      >
                        {t('specDetail.more')}
                      </button>
                    </div>
                  </section>

                  <article
                    ref={(el) => setArticleEl(el)}
                    class="markdown px-4 py-4"
                    onClick={onArticleClick}
                  />

                  {/* 有待确认项才出 FAB。运行中禁用，与桌面端 showPanel 的门禁
                      同因：可见即可提交，会并发拉起第二个改写同一文档的 session。 */}
                  <Show when={questions().length > 0}>
                    <button
                      type="button"
                      class="fixed bottom-6 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:opacity-80 disabled:opacity-40"
                      aria-label={t('specDetail.questions')}
                      disabled={running()}
                      onClick={() => setQuestionOpen(true)}
                    >
                      <CircleHelp size={24} aria-hidden="true" />
                      <span class="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full border border-background bg-destructive px-1 text-[11px] text-destructive-foreground">
                        {questions().length}
                      </span>
                    </button>
                  </Show>

                  <QuestionSheet
                    open={questionOpen()}
                    projectId={pid()}
                    specId={doc().id}
                    questions={questions()}
                    onClose={() => setQuestionOpen(false)}
                    onSubmitted={(sessionId) => {
                      setQuestionOpen(false)
                      setRunning(true)
                      if (sessionId) {
                        setSpecSid(sessionId)
                        navigate(`/sessions/${encodeURIComponent(sessionId)}`)
                      }
                    }}
                  />
                  <AppendSheet
                    open={appendOpen()}
                    projectId={pid()}
                    specId={doc().id}
                    onClose={() => setAppendOpen(false)}
                    onSubmitted={(sessionId) => {
                      setAppendOpen(false)
                      if (sessionId) {
                        setRunning(true)
                        setSpecSid(sessionId)
                        navigate(`/sessions/${encodeURIComponent(sessionId)}`)
                      }
                    }}
                  />
                </>
              )}
            </Show>
          </Show>
        </Show>
      </Show>

      <ActionSheet
        open={moreOpen()}
        title={params.id}
        items={[{ label: t('specDetail.copySpecPath'), onSelect: () => void copySpecPath() }]}
        onClose={() => setMoreOpen(false)}
      />
      <MermaidViewer svg={diagram()} onClose={() => setDiagram(null)} />
    </Page>
  )
}

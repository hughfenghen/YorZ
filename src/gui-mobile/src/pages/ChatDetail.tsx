import { Show, createEffect, createMemo, createResource, createSignal } from 'solid-js'
import type { Component } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { FileText } from 'lucide-solid'
import { api, type SessionInfo, type SpecListItem } from '@shared/api/index.js'
import { createChatTranscript } from '@shared/lib/chat-transcript.js'
import { createAttachments } from '@shared/lib/attachments.js'
import type { SlashCommand } from '@shared/lib/completion.js'
import { buildSlashReplacement, mergeScopedInstructions } from '@shared/lib/slash-commands.js'
import {
  projectInstructions,
  refreshProjectInstructions,
} from '@shared/lib/project-instructions.js'
import { attachmentLabels } from '@/lib/attachment-labels.js'
import { Page } from '@/components/Page.jsx'
import { AgentUsageHint } from '@/components/AgentUsageHint.jsx'
import { MessageList } from '@/components/MessageList.jsx'
import { ChatComposer } from '@/components/ChatComposer.jsx'
import { NoProjectNotice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { transcriptCache } from '@/lib/transcript-cache.js'
import { readSessionCache, writeSessionCache } from '@/lib/session-cache.js'
import { readSpecCache, writeSpecCache } from '@/lib/spec-cache.js'
import { copyText } from '@/lib/clipboard.js'
import { watchKeyboardInset } from '@/lib/keyboard.js'
import { t } from '@/i18n/index.js'

/** 距底多少像素以内算「贴着底」，仍自动跟随新内容。桌面取 96，触屏视口更矮。 */
const AUTO_SCROLL_THRESHOLD = 80

function closestFileLink(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-file-link="true"]')
}

/**
 * 会话详情，同时承载 `/sessions/:id` 与 `/sessions/new`。
 *
 * 两者不是两个页面：草稿态就是「sessionId 为空串」的会话详情，session 由首条
 * 消息创建（见 `createChatTranscript` 的 `sendFromDraft`）。分成两个组件会把
 * 「首发后从空白页变成真会话」拆成一次卸载 + 挂载，正在流式输出的内容会闪掉。
 *
 * 编排（历史加载 / SSE / delta 缓冲 / 竞态守卫）全部来自共享 hook，与桌面端
 * ChatPanel 跑的是同一份不变量。
 */
export const ChatDetail: Component = () => {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  watchKeyboardInset()

  const pid = () => activeProjectId() ?? ''
  /**
   * 路由 id 是唯一真相，但 codex 会在一轮中途换 id、草稿首发也会凭空产生 id，
   * 那两条路径要在导航生效之前就把新 id 交给 hook（订阅与 POST 都等着它）。
   * 于是本地留一个覆盖信号：写它 → hook 立刻改订阅，随后再 replace 路由。
   */
  const [sidOverride, setSidOverride] = createSignal<string | null>(null)
  const sid = () => sidOverride() ?? params.id ?? ''

  const [input, setInput] = createSignal('')
  const [autoScroll, setAutoScroll] = createSignal(true)
  /**
   * 本页只关心当前这一条会话跑没跑。桌面端那份 `runningSids` 是**列表**级投影，
   * 移动端列表在另一个页面，这里用一个布尔就够。
   */
  const [running, setRunning] = createSignal(false)
  let messagesEl: HTMLDivElement | undefined

  /**
   * session 元信息只能从列表里查——后端没有「单个 session 的 GET」端点，
   * 本次也不新增（沿用上一个 spec 确立的后端零改动边界）。查不到就回退
   * 未命名、且不渲染跳转 icon，而不是渲染一个点了没反应的按钮。
   */
  const [list, setList] = createSignal<SessionInfo[] | null>(null)
  const [sessions] = createResource<SessionInfo[], string>(
    () => pid() || undefined,
    (p) => api.listSessions(p),
  )

  // 详情页标题优先走列表缓存：从会话列表点进来时首帧就能拿到真实 title，
  // 不再先显示"未命名会话"再被接口结果替换。
  createEffect(() => {
    const p = pid()
    setList(p ? readSessionCache(p) : null)
  })

  createEffect(() => {
    if (sessions.state !== 'ready') return
    const p = pid()
    const fresh = sessions()
    if (!p || !fresh) return
    setList(fresh)
    writeSessionCache(p, fresh)
  })

  const current = createMemo(() => list()?.find((s) => s.id === sid()))
  const specId = () => current()?.specId

  const [specList, setSpecList] = createSignal<SpecListItem[] | null>(null)
  const [specs] = createResource<SpecListItem[], string>(
    () => pid() || undefined,
    (p) => api.listSpecs(p),
  )

  createEffect(() => {
    const p = pid()
    setSpecList(p ? readSpecCache(p) : null)
  })

  createEffect(() => {
    if (specs.state !== 'ready') return
    const p = pid()
    const fresh = specs()
    if (!p || !fresh) return
    setSpecList(fresh)
    writeSpecCache(p, fresh)
  })

  const specById = createMemo(() => {
    const map = new Map<string, SpecListItem>()
    for (const spec of specList() ?? []) map.set(spec.id, spec)
    return map
  })
  const title = () => specById().get(specId() ?? '')?.title || current()?.title || t('chat.untitled')

  // 列表是运行态的权威来源（服务端的 running 集合），SSE 只送变化。
  createEffect(() => {
    const info = current()
    if (info) setRunning(Boolean(info.running))
  })

  const attachments = createAttachments({ projectId: pid, labels: attachmentLabels() })

  /**
   * `/` 指令表：两个 scope 合并，project 在前并遮蔽同名 global——与服务端
   * `mergeCustomInstructions` 同口径，选中的那条才等于服务端解析出的那条。
   */
  const [globalInstructions] = createResource(() => api.getGlobalConfig())
  createEffect(() => {
    const p = pid()
    if (p) void refreshProjectInstructions(p)
  })
  const slashCommands = createMemo<SlashCommand[]>(() => {
    const custom = mergeScopedInstructions(
      projectInstructions(pid()),
      globalInstructions()?.customInstructions ?? [],
    ).map((cmd) => {
      const value = `/${cmd.name}`
      return {
        value,
        label: value,
        // 不回退到 hiddenPrompt：它按定义就是用户看不到的那部分，
        // 摆进选择器等于自相矛盾（与桌面端同口径）。
        description: cmd.description || t('chat.customSlashCommandNoDescription'),
        replacement: buildSlashReplacement(cmd.name, cmd.prefill),
        customId: cmd.id,
      }
    })
    // 移动端不提供「新建指令」入口（那是一个带四个字段的表单，属二期），
    // 因此也不放桌面端的 `/add-command` 项——点了没有去处的入口比没有更糟。
    return [
      { value: '/yorz-debug', description: t('chat.slashCommandYorzDebug') },
      { value: '/yorz-spec', description: t('chat.slashCommandYorzSpec') },
      ...custom,
    ]
  })

  const tx = createChatTranscript({
    projectId: pid,
    sessionId: sid,
    specId,
    running,
    listPending: () => sessions.loading,
    known: () => Boolean(current()),
    onSessionIdChange: (next) => {
      // 先让 hook 看到新 id（订阅要立刻跟上），再 replace 路由。
      // replace 而不是 push：草稿页已经没有意义，返回键应当直接回到列表。
      setSidOverride(next)
      navigate(`/sessions/${encodeURIComponent(next)}`, { replace: true })
    },
    onRunningChange: (changed, value) => {
      if (changed === sid()) setRunning(value)
    },
    onSubjectChange: () => setAutoScroll(true),
    errorLabel: (message) => t('chat.errorMessage', { message }),
    // 本页每次导航都重挂载，屏上内容不跨页留存；缓存交给 hook 后，进页先画上次
    // 读到的那份，权威读取到达再按尾部比对决定要不要换。桌面端不传，行为不变。
    transcriptCache,
  })

  function isNearBottom(el: HTMLDivElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
  }

  createEffect(() => {
    tx.blocks()
    if (!autoScroll() || !messagesEl) return
    const el = messagesEl
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  })

  async function onSend() {
    const prompt = input().trim()
    if (!prompt) return
    setInput('')
    setAutoScroll(true)
    const outcome = await tx.send(prompt, attachments.draftId() ?? undefined)
    if (outcome === 'sent') attachments.reset()
    // 建号就失败时把文本还给用户：那条消息还没有出现在气泡里。
    // 建号成功但 POST 失败则不还——消息已经作为用户气泡在屏幕上了。
    else if (outcome === 'not-started') {
      setInput(prompt)
      showToast(t('chat.sendFailed'), 'error')
    }
  }

  /**
   * 文件路径链接是 `renderMarkdown(fileLinks:'copy')` 产出的非导航按钮，
   * 数量随消息增长，逐个挂监听不现实——委托到滚动容器上。
   * 复制必须走 `lib/clipboard.ts`：真机是 http 局域网地址，
   * `navigator.clipboard` 在那里是 undefined。
   */
  function onMessagesClick(e: MouseEvent) {
    const link = closestFileLink(e.target)
    if (!link) return
    const path = link.dataset.filePath
    if (!path) return
    e.preventDefault()
    void copyText(path).then((ok) =>
      showToast(
        ok ? t('chat.filePathCopied') : t('chat.filePathCopyFailed'),
        ok ? 'default' : 'error',
      ),
    )
  }

  return (
    <Page
      title={title()}
      padded={false}
      onBack={() => navigate('/')}
      scrollRef={(el) => (messagesEl = el)}
      onScroll={() => messagesEl && setAutoScroll(isNearBottom(messagesEl))}
      actions={
        <Show when={specId()}>
          {(id) => (
            <button
              type="button"
              class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
              aria-label={t('chat.openSpec')}
              onClick={() => navigate(`/specs/${encodeURIComponent(id())}`)}
            >
              <FileText size={20} aria-hidden="true" />
            </button>
          )}
        </Show>
      }
      footer={
        <ChatComposer
          value={input()}
          onInput={setInput}
          onSend={() => void onSend()}
          onAbort={() => void tx.abort()}
          running={running()}
          starting={tx.starting()}
          attachments={attachments}
          projectId={pid()}
          slashCommands={slashCommands()}
        />
      }
    >
      <Show when={pid()} fallback={<div class="px-4 py-4">{<NoProjectNotice />}</div>}>
        <div class="px-4 py-3" onClick={onMessagesClick}>
          {/* 三态而非二态：历史是异步读的，`blocks` 为空既可能是「还没读到」也可能是
              「真的没有」。只有 hook 分得清这两者（见 historyLoading），页面自己拿
              sessions.loading 猜会在弱网下反复抖动。 */}
          <Show
            when={!tx.historyLoading()}
            fallback={
              <p class="m-0 py-8 text-center text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            }
          >
            <Show
              when={tx.blocks().length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 py-8 text-center">
                  <p class="m-0 text-sm text-muted-foreground">
                    {sid() ? t('chat.empty') : t('chat.draftEmpty')}
                  </p>
                  {/* 与桌面端同口径：只有草稿态（还没有会话）才提示 Agent 余额，
                      已经在聊的会话里没人关心这条。 */}
                  <Show when={!sid()}>
                    <AgentUsageHint />
                  </Show>
                </div>
              }
            >
              <MessageList blocks={tx.blocks()} expand={tx.toolExpand} />
            </Show>
          </Show>
        </div>
      </Show>
    </Page>
  )
}

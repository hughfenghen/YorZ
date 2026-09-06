import { For, Show, createEffect, createMemo, createSignal, type Component } from 'solid-js'
import { api, type QuestionAnswersBody } from '@shared/api/index.js'
import { FREEFORM_SENTINEL } from '@shared/lib/answer-payload.js'
import type { ConfirmQuestion } from '@shared/lib/question-parse.js'
import {
  buildAnswerItems,
  countUnanswered,
  impactAccent,
  initialAnswers,
  type AnswerDraft,
  type ConfirmTop,
  type DropTarget,
  type RejectIntent,
} from '@shared/lib/question-draft.js'
import { Sheet } from './Sheet.jsx'
import { showToast } from './Toast.jsx'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/** 整行可点的单选卡，44px 触摸区。移动端唯一的选择器形态。 */
const OptionRow: Component<{
  label: string
  selected: boolean
  hint?: string
  accent?: boolean
  onSelect: () => void
}> = (props) => (
  <button
    type="button"
    role="radio"
    aria-checked={props.selected}
    class={cn(
      'flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm active:opacity-80',
      props.selected ? 'border-primary bg-primary/10' : 'border-border bg-background',
      props.accent && !props.selected && 'bg-primary/5',
    )}
    onClick={() => props.onSelect()}
  >
    <span
      class={cn(
        'size-4 shrink-0 rounded-full border',
        props.selected ? 'border-[5px] border-primary' : 'border-muted-foreground/40',
      )}
      aria-hidden="true"
    />
    <span class="min-w-0 flex-1">
      <span class="block">{props.label}</span>
      <Show when={props.hint}>
        <span class="mt-0.5 block text-xs text-muted-foreground">{props.hint}</span>
      </Show>
    </span>
  </button>
)

/**
 * 待确认项弹窗。
 *
 * 「什么算答完」「提交出什么 payload」两件事都来自共享的 `question-draft`，
 * 与桌面端同一份判定——回写文档的 `！！！选择：…` 文案一旦两端不一致，
 * agent 在 tasks 阶段的分派就会错。这里只负责把它画成触屏能用的样子。
 *
 * confirm 型的三级否决意图，桌面端是嵌套 RadioGroup 逐级缩进；375px 宽下
 * 三层缩进会把选项挤成竖排单字，所以改成**分级就地展开**：选了「否决」才出
 * 第二级，选了「弃目标」才出第三级。
 */
export const QuestionSheet: Component<{
  open: boolean
  projectId: string
  specId: string
  questions: ConfirmQuestion[]
  onClose: () => void
  /** 提交并拉起 agent 之后回调，带上新会话 id（拿不到则为空串）。 */
  onSubmitted: (sessionId: string) => void
}> = (props) => {
  const [answers, setAnswers] = createSignal<Record<string, AnswerDraft>>({})
  const [busy, setBusy] = createSignal(false)

  // 每次打开都从初值重来：弹窗关掉意味着这一轮草稿作废，留着上次的选择
  // 会让人以为自己已经答过。
  createEffect(() => {
    if (props.open) setAnswers(initialAnswers(props.questions))
  })

  const unanswered = createMemo(() => countUnanswered(props.questions, answers()))

  const patch = (qid: string, next: Partial<AnswerDraft>) =>
    setAnswers((prev) => ({ ...prev, [qid]: { ...(prev[qid] ?? { note: '' }), ...next } }))

  const draftOf = (qid: string): AnswerDraft => answers()[qid] ?? { note: '' }

  function setConfirmTop(qid: string, top: ConfirmTop) {
    // 切回「确认」时清掉否决的子选择，避免残留状态在下次改主意时复活。
    if (top === 'accept') {
      patch(qid, { confirmTop: top, confirmIntent: undefined, confirmDrop: undefined, note: '' })
    } else {
      patch(qid, { confirmTop: top })
    }
  }

  function setConfirmIntent(qid: string, intent: RejectIntent) {
    if (intent === 'dropGoal') patch(qid, { confirmIntent: intent })
    else patch(qid, { confirmIntent: intent, confirmDrop: undefined })
  }

  async function submit() {
    setBusy(true)
    try {
      const built = buildAnswerItems(props.questions, answers())
      if (!built.ok) {
        showToast(t('specDetail.reasonRequired'), 'error')
        return
      }
      if (built.items.length === 0) {
        showToast(t('specDetail.unanswered', { count: props.questions.length }), 'error')
        return
      }
      // freeformAnnotations 恒为空数组：移动端不做正文选区批注（见 spec 5.2），
      // 没有能产出 sectionPath / quote 的入口。
      const payload: QuestionAnswersBody = { answers: built.items, freeformAnnotations: [] }
      await api.submitQuestionAnswers(props.projectId, props.specId, payload)
      const { sessionId } = await api.runAgent(props.projectId, props.specId)
      showToast(t('specDetail.submitted'))
      props.onSubmitted(sessionId)
    } catch (err) {
      showToast((err as Error).message || t('specDetail.submitFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={props.open}
      title={t('specDetail.questions')}
      onClose={props.onClose}
      footer={
        <div class="flex items-center gap-3">
          <Show when={unanswered() > 0}>
            <span class="text-xs text-muted-foreground">
              {t('specDetail.unanswered', { count: unanswered() })}
            </span>
          </Show>
          <button
            type="button"
            class="ml-auto min-h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
            disabled={busy()}
            onClick={() => void submit()}
          >
            {busy() ? t('specDetail.submitting') : t('specDetail.submit')}
          </button>
        </div>
      }
    >
      <Show
        when={props.questions.length > 0}
        fallback={
          <p class="py-6 text-center text-sm text-muted-foreground">
            {t('specDetail.questionsEmpty')}
          </p>
        }
      >
        <div class="space-y-5">
          <For each={props.questions}>
            {(q) => (
              <section>
                <h3 class="mb-2 text-sm font-medium leading-relaxed">{q.text}</h3>

                <Show when={q.kind === 'confirm'}>
                  <div
                    class={cn(
                      'mb-2 space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs',
                      impactAccent(q.impact),
                    )}
                  >
                    <Show when={q.plan}>
                      <p>
                        <span class="font-medium">{t('specDetail.plan')}：</span>
                        {q.plan}
                      </p>
                    </Show>
                    <Show when={q.impact}>
                      <p>
                        <span class="font-medium">{t('specDetail.impact')}：</span>
                        {q.impact}
                      </p>
                    </Show>
                  </div>

                  <div class="space-y-2" role="radiogroup">
                    <OptionRow
                      label={t('specDetail.decisionAccept')}
                      selected={draftOf(q.id).confirmTop === 'accept'}
                      onSelect={() => setConfirmTop(q.id, 'accept')}
                    />
                    <OptionRow
                      label={t('specDetail.decisionReject')}
                      selected={draftOf(q.id).confirmTop === 'reject'}
                      onSelect={() => setConfirmTop(q.id, 'reject')}
                    />
                  </div>

                  {/* 第二级：就地展开，不缩进 */}
                  <Show when={draftOf(q.id).confirmTop === 'reject'}>
                    <div class="mt-2 space-y-2 border-l-2 border-border pl-3" role="radiogroup">
                      <For
                        each={
                          [
                            ['alternative', t('specDetail.decisionAlternative')],
                            ['constraint', t('specDetail.decisionConstraint')],
                            ['dropGoal', t('specDetail.decisionDropGoal')],
                          ] as const
                        }
                      >
                        {([intent, label]) => (
                          <OptionRow
                            label={label}
                            selected={draftOf(q.id).confirmIntent === intent}
                            onSelect={() => setConfirmIntent(q.id, intent as RejectIntent)}
                          />
                        )}
                      </For>

                      {/* 第三级 */}
                      <Show when={draftOf(q.id).confirmIntent === 'dropGoal'}>
                        <div class="space-y-2 border-l-2 border-border pl-3" role="radiogroup">
                          <For
                            each={
                              [
                                ['current', t('specDetail.decisionDropCurrent')],
                                ['spec', t('specDetail.decisionDropSpec')],
                              ] as const
                            }
                          >
                            {([target, label]) => (
                              <OptionRow
                                label={label}
                                selected={draftOf(q.id).confirmDrop === target}
                                onSelect={() => patch(q.id, { confirmDrop: target as DropTarget })}
                              />
                            )}
                          </For>
                        </div>
                      </Show>

                      {/* 否决必须带理由：`buildConfirmAnswerItem` 缺理由时返 null，
                          整次提交会被挡下，所以这里同步把输入摆在眼前。 */}
                      <label class="block">
                        <span class="mb-1 block text-xs text-muted-foreground">
                          {t('specDetail.rejectReason')}
                        </span>
                        <textarea
                          rows={3}
                          class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
                          placeholder={t('specDetail.rejectReasonHint')}
                          value={draftOf(q.id).note}
                          onInput={(e) => patch(q.id, { note: e.currentTarget.value })}
                        />
                      </label>
                    </div>
                  </Show>
                </Show>

                <Show when={q.kind === 'choice'}>
                  <div class="space-y-2" role="radiogroup">
                    <For each={q.options}>
                      {(opt) => (
                        <OptionRow
                          label={opt.label}
                          accent={opt.recommended}
                          selected={draftOf(q.id).selectedOptionLabel === opt.label}
                          onSelect={() => patch(q.id, { selectedOptionLabel: opt.label })}
                        />
                      )}
                    </For>
                    {/* 末位固定一项自由文本：候选没覆盖到的情况下，用户仍有出口 */}
                    <OptionRow
                      label={t('specDetail.freeformOther')}
                      selected={draftOf(q.id).selectedOptionLabel === FREEFORM_SENTINEL}
                      onSelect={() => patch(q.id, { selectedOptionLabel: FREEFORM_SENTINEL })}
                    />
                    <Show when={draftOf(q.id).selectedOptionLabel === FREEFORM_SENTINEL}>
                      <textarea
                        rows={3}
                        class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
                        placeholder={t('specDetail.freeformHint')}
                        value={draftOf(q.id).note}
                        onInput={(e) => patch(q.id, { note: e.currentTarget.value })}
                      />
                    </Show>
                  </div>
                </Show>

                <Show when={q.kind === 'freeform'}>
                  <textarea
                    rows={4}
                    class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
                    placeholder={t('specDetail.freeformHint')}
                    value={draftOf(q.id).note}
                    onInput={(e) => patch(q.id, { note: e.currentTarget.value })}
                  />
                </Show>
              </section>
            )}
          </For>
        </div>
      </Show>
    </Sheet>
  )
}

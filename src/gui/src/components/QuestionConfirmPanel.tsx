import { For, Show, createMemo, createSignal, type Component } from 'solid-js'
import type { ConfirmQuestion } from '../lib/question-parse.js'
import type { AnnotationBody, QuestionAnswerBody, QuestionAnswersBody } from '../lib/api.js'
import {
  buildAnswerItem,
  buildConfirmAnswerItem,
  FREEFORM_SENTINEL,
  type ConfirmDecisionKey,
} from '../lib/answer-payload.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'
import { Send, X } from 'lucide-solid'
import { t } from '../i18n/index.js'

export interface FreeformDraft {
  id: string
  sectionPath: string
  quote: string
  note: string
}

interface Props {
  questions: ConfirmQuestion[]
  freeforms: FreeformDraft[]
  running?: boolean
  onRemoveFreeform: (id: string) => void
  onSubmit: (payload: QuestionAnswersBody) => Promise<void>
}

// confirm 型的三级否决意图状态。
type ConfirmTop = 'accept' | 'reject'
type RejectIntent = 'alternative' | 'constraint' | 'dropGoal'
type DropTarget = 'current' | 'spec'

interface AnswerDraft {
  // choice / freeform
  selectedOptionLabel?: string
  note: string
  // confirm
  confirmTop?: ConfirmTop
  confirmIntent?: RejectIntent
  confirmDrop?: DropTarget
}

/** 把三级 confirm 选择折叠为规范决策 key；未选全返回 null。 */
function resolveConfirmKey(d: AnswerDraft): ConfirmDecisionKey | null {
  if (d.confirmTop === 'accept') return 'accept'
  if (d.confirmTop !== 'reject') return null
  if (d.confirmIntent === 'alternative') return 'rejectAlternative'
  if (d.confirmIntent === 'constraint') return 'rejectConstraint'
  if (d.confirmIntent === 'dropGoal') {
    if (d.confirmDrop === 'current') return 'rejectDropGoal'
    if (d.confirmDrop === 'spec') return 'rejectDropSpec'
  }
  return null
}

/** confirm 草稿是否完整可提交（已选决策；若否决则理由非空）。 */
function isConfirmComplete(d: AnswerDraft): boolean {
  const key = resolveConfirmKey(d)
  if (!key) return false
  if (key === 'accept') return true
  return d.note.trim().length > 0
}

/** 影响文本含 🔴 → 高危红边，🟡 → 中危黄边。 */
function impactAccent(impact: string | undefined): string {
  if (!impact) return 'border-border'
  if (impact.includes('🔴')) return 'border-l-2 border-l-destructive'
  if (impact.includes('🟡')) return 'border-l-2 border-l-amber-500'
  return 'border-border'
}

export const QuestionConfirmPanel: Component<Props> = (props) => {
  const initialAnswers = (): Record<string, AnswerDraft> => {
    const out: Record<string, AnswerDraft> = {}
    for (const q of props.questions) {
      if (q.kind === 'confirm') {
        // 确认型默认「确认，按此推进」——它是知会 + 急停语义，放行是常态。
        out[q.id] = { note: '', confirmTop: 'accept' }
        continue
      }
      const recommended = q.options.find((o) => o.recommended)
      out[q.id] = {
        selectedOptionLabel: recommended?.label ?? q.options[0]?.label,
        note: '',
      }
    }
    return out
  }

  const [answers, setAnswers] = createSignal<Record<string, AnswerDraft>>(initialAnswers())
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  function patch(qid: string, next: Partial<AnswerDraft>) {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], ...next } }))
  }
  function setChoice(qid: string, label: string) {
    patch(qid, { selectedOptionLabel: label })
  }
  function setNote(qid: string, note: string) {
    patch(qid, { note })
  }
  function setConfirmTop(qid: string, top: ConfirmTop) {
    // 切回确认时清掉否决子选择，避免残留状态污染。
    if (top === 'accept') patch(qid, { confirmTop: top, confirmIntent: undefined, confirmDrop: undefined })
    else patch(qid, { confirmTop: top })
  }
  function setConfirmIntent(qid: string, intent: RejectIntent) {
    if (intent === 'dropGoal') patch(qid, { confirmIntent: intent })
    else patch(qid, { confirmIntent: intent, confirmDrop: undefined })
  }
  function setConfirmDrop(qid: string, drop: DropTarget) {
    patch(qid, { confirmDrop: drop })
  }

  const unanswered = createMemo(() => {
    const a = answers()
    let count = 0
    for (const q of props.questions) {
      const draft = a[q.id]
      if (!draft) {
        count += 1
        continue
      }
      if (q.kind === 'confirm') {
        if (!isConfirmComplete(draft)) count += 1
        continue
      }
      const note = draft.note ?? ''
      if (q.isFreeform) {
        if (!note.trim()) count += 1
      } else if (draft.selectedOptionLabel === FREEFORM_SENTINEL) {
        if (!note.trim()) count += 1
      } else if (!draft.selectedOptionLabel) {
        count += 1
      }
    }
    return count
  })

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const a = answers()
      const items: QuestionAnswerBody[] = []
      for (const q of props.questions) {
        const draft = a[q.id] ?? { note: '' }
        if (q.kind === 'confirm') {
          const key = resolveConfirmKey(draft)
          if (!key) continue // 未选决策：视作未答，跳过
          // 否决必须携带理由，否则阻塞整次提交。
          const item = buildConfirmAnswerItem(q, key, draft.note)
          if (!item) {
            setError(t('questionConfirm.reasonRequired'))
            return
          }
          items.push(item)
          continue
        }
        const item = buildAnswerItem(q, draft)
        if (item) items.push(item)
      }
      const payload: QuestionAnswersBody = {
        answers: items,
        freeformAnnotations: props.freeforms.map(
          (f): AnnotationBody => ({
            sectionPath: f.sectionPath,
            quote: f.quote,
            note: f.note,
          }),
        ),
      }
      if (payload.answers.length === 0 && payload.freeformAnnotations.length === 0) {
        setError(t('questionConfirm.noAnswers'))
        return
      }
      await props.onSubmit(payload)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      class="flex min-w-0 flex-[4] flex-col overflow-hidden rounded-lg border bg-card shadow-lg"
      data-testid="question-confirm-panel"
    >
      <header class="flex items-center justify-between gap-2 border-b bg-background px-3 py-2.5">
        {/* The panel is narrow (flex-[4]), so the three items compete for one
            row. Degrade in priority order: the title truncates first, while the
            count and the button — the actionable bits — always stay whole. */}
        <div class="flex min-w-0 flex-1 items-baseline gap-2">
          <strong class="min-w-0 truncate font-semibold" title={t('questionConfirm.title')}>
            {t('questionConfirm.title')}
          </strong>
          <span class="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
            {t('questionConfirm.unanswered')}{' '}
            <span class="font-semibold text-accent">{unanswered()}</span> / {props.questions.length}
          </span>
        </div>
        {/* Same shape as the Chat composer's Send: every button that kicks off an
            agent run reads identically. */}
        <Button size="sm" class="shrink-0" disabled={busy() || props.running} onClick={submit}>
          <Send class="mr-1 h-3.5 w-3.5" />
          {busy()
            ? t('common.submitting')
            : props.running
              ? t('questionConfirm.running')
              : t('questionConfirm.submitAll')}
        </Button>
      </header>
      <Show when={error()}>
        <p class="text-destructive mx-3 mt-1 ">{error()}</p>
      </Show>
      <ul class="m-0 flex min-h-0 min-w-0 list-none flex-1 flex-col gap-2 overflow-auto p-2">
        <For each={props.questions}>
          {(q) => {
            const draft = () => answers()[q.id] ?? { note: '' }
            const showChoiceNote = () =>
              q.kind !== 'confirm' &&
              (q.isFreeform || draft().selectedOptionLabel === FREEFORM_SENTINEL)
            const showRejectReason = () => q.kind === 'confirm' && draft().confirmTop === 'reject'
            return (
              <li class="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2.5">
                <p class="qcp-question m-0 font-medium break-words">{q.text}</p>

                {/* choice / freeform：沿用有序候选 + 自由项 */}
                <Show when={q.kind === 'choice'}>
                  <ul class="m-0 flex list-none flex-col gap-1 p-0">
                    <For each={q.options}>
                      {(opt) => (
                        <li>
                          <label class="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={draft().selectedOptionLabel === opt.label}
                              onChange={() => setChoice(q.id, opt.label)}
                            />
                            <span class="min-w-0 break-words">
                              {opt.label}
                              <Show when={opt.recommended}>
                                <em class="text-accent text-sm not-italic">
                                  {' '}
                                  {t('questionConfirm.recommended')}
                                </em>
                              </Show>
                            </span>
                          </label>
                        </li>
                      )}
                    </For>
                    <li>
                      <label class="qcp-option-freeform flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={draft().selectedOptionLabel === FREEFORM_SENTINEL}
                          onChange={() => setChoice(q.id, FREEFORM_SENTINEL)}
                        />
                        <span>{t('questionConfirm.freeformLabel')}</span>
                      </label>
                    </li>
                  </ul>
                </Show>

                {/* confirm：只读方案/影响 + 确认/否决三级单选 */}
                <Show when={q.kind === 'confirm'}>
                  <div
                    class={`flex flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-sm ${impactAccent(q.impact)}`}
                  >
                    <Show when={q.plan}>
                      <p class="m-0 break-words">
                        <strong>{t('questionConfirm.confirmPlanLabel')}</strong>：{q.plan}
                      </p>
                    </Show>
                    <Show when={q.impact}>
                      <p class="m-0 break-words">
                        <strong>{t('questionConfirm.confirmImpactLabel')}</strong>：{q.impact}
                      </p>
                    </Show>
                  </div>
                  <ul class="m-0 flex list-none flex-col gap-1 p-0">
                    <li>
                      <label class="qcp-confirm-accept flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={draft().confirmTop === 'accept'}
                          onChange={() => setConfirmTop(q.id, 'accept')}
                        />
                        <span>{t('questionConfirm.decisionAccept')}</span>
                      </label>
                    </li>
                    <li>
                      <label class="qcp-confirm-reject flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={draft().confirmTop === 'reject'}
                          onChange={() => setConfirmTop(q.id, 'reject')}
                        />
                        <span class="font-medium text-destructive">
                          {t('questionConfirm.decisionReject')}
                        </span>
                      </label>
                    </li>
                    {/* 二级：否决意图 */}
                    <Show when={draft().confirmTop === 'reject'}>
                      <ul class="m-0 ml-5 flex list-none flex-col gap-1 border-l border-border pl-2">
                        <For
                          each={
                            [
                              ['alternative', t('questionConfirm.intentAlternative')],
                              ['constraint', t('questionConfirm.intentConstraint')],
                              ['dropGoal', t('questionConfirm.intentDropGoal')],
                            ] as const
                          }
                        >
                          {([intent, label]) => (
                            <li>
                              <label class="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                                <input
                                  type="radio"
                                  name={`q-${q.id}-intent`}
                                  checked={draft().confirmIntent === intent}
                                  onChange={() => setConfirmIntent(q.id, intent)}
                                />
                                <span class="min-w-0 break-words">{label}</span>
                              </label>
                            </li>
                          )}
                        </For>
                        {/* 三级：弃目标范围 */}
                        <Show when={draft().confirmIntent === 'dropGoal'}>
                          <ul class="m-0 ml-5 flex list-none flex-col gap-1 border-l border-border pl-2">
                            <For
                              each={
                                [
                                  ['current', t('questionConfirm.dropGoalCurrent')],
                                  ['spec', t('questionConfirm.dropGoalSpec')],
                                ] as const
                              }
                            >
                              {([drop, label]) => (
                                <li>
                                  <label class="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                                    <input
                                      type="radio"
                                      name={`q-${q.id}-drop`}
                                      checked={draft().confirmDrop === drop}
                                      onChange={() => setConfirmDrop(q.id, drop)}
                                    />
                                    <span class="min-w-0 break-words">{label}</span>
                                  </label>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </ul>
                    </Show>
                  </ul>
                </Show>

                <Show when={showChoiceNote()}>
                  <Textarea
                    class="qcp-note"
                    rows={2}
                    placeholder={t('questionConfirm.notePlaceholder')}
                    value={draft().note}
                    onInput={(e) => setNote(q.id, e.currentTarget.value)}
                  />
                </Show>
                <Show when={showRejectReason()}>
                  <Textarea
                    class="qcp-reject-reason"
                    rows={2}
                    placeholder={t('questionConfirm.reasonPlaceholder')}
                    value={draft().note}
                    onInput={(e) => setNote(q.id, e.currentTarget.value)}
                  />
                </Show>
              </li>
            )
          }}
        </For>
        <For each={props.freeforms}>
          {(f) => (
            <li class="flex min-w-0 flex-col gap-2 rounded-lg border border-accent/60 bg-background p-2.5">
              <header class="text-muted-foreground flex items-center justify-between text-sm">
                <strong>{t('questionConfirm.selectionAnnotation')}</strong>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6"
                  onClick={() => props.onRemoveFreeform(f.id)}
                  aria-label="remove"
                >
                  <X class="h-4 w-4" />
                </Button>
              </header>
              <blockquote class="border-border bg-card m-0 border-l-2 px-2 py-1 text-sm text-muted-foreground break-words">
                <em>{f.sectionPath}</em> {t('questionConfirm.quoteConnector')} "
                {f.quote.slice(0, 200)}"
              </blockquote>
              <p class="m-0 whitespace-pre-wrap break-words">！！！{f.note}</p>
            </li>
          )}
        </For>
      </ul>
    </aside>
  )
}

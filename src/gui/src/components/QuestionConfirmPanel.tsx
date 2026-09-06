import { For, Show, createMemo, createSignal, type Component } from 'solid-js'
import type { ConfirmQuestion } from '../lib/question-parse.js'
import type { QuestionAnswersBody } from '../lib/api.js'
import { FREEFORM_SENTINEL } from '../lib/answer-payload.js'
import {
  buildAnswerItems,
  countUnanswered,
  impactAccent,
  initialAnswers,
  toAnnotationBodies,
  type AnswerDraft,
  type ConfirmTop,
  type DropTarget,
  type FreeformDraft,
  type RejectIntent,
} from '@shared/lib/question-draft.js'
import { Button } from './ui/button.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from './ui/radio-group.jsx'
import { Textarea } from './ui/textarea.jsx'
import { Send, X } from 'lucide-solid'
import { t } from '../i18n/index.js'

interface Props {
  questions: ConfirmQuestion[]
  freeforms: FreeformDraft[]
  running?: boolean
  onRemoveFreeform: (id: string) => void
  onSubmit: (payload: QuestionAnswersBody) => Promise<void>
}

export const QuestionConfirmPanel: Component<Props> = (props) => {
  const [answers, setAnswers] = createSignal<Record<string, AnswerDraft>>(
    initialAnswers(props.questions),
  )
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
    if (top === 'accept')
      patch(qid, { confirmTop: top, confirmIntent: undefined, confirmDrop: undefined })
    else patch(qid, { confirmTop: top })
  }
  function setConfirmIntent(qid: string, intent: RejectIntent) {
    if (intent === 'dropGoal') patch(qid, { confirmIntent: intent })
    else patch(qid, { confirmIntent: intent, confirmDrop: undefined })
  }
  function setConfirmDrop(qid: string, drop: DropTarget) {
    patch(qid, { confirmDrop: drop })
  }

  const unanswered = createMemo(() => countUnanswered(props.questions, answers()))

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const built = buildAnswerItems(props.questions, answers())
      if (!built.ok) {
        setError(t('questionConfirm.reasonRequired'))
        return
      }
      const payload: QuestionAnswersBody = {
        answers: built.items,
        freeformAnnotations: toAnnotationBodies(props.freeforms),
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
            {/* 未答数是「待办」语义；不能用 text-accent——accent 已回归中性 hover 底色 */}
            <span class="font-semibold text-warning">{unanswered()}</span> /{' '}
            {props.questions.length}
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
                  <RadioGroup
                    class="m-0 flex flex-col gap-1 p-0"
                    value={draft().selectedOptionLabel ?? ''}
                    onChange={(v) => setChoice(q.id, v)}
                  >
                    <For each={q.options}>
                      {(opt) => (
                        <RadioGroupItem
                          value={opt.label}
                          class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                        >
                          <RadioGroupItemInput />
                          <RadioGroupItemControl />
                          <RadioGroupItemLabel class="min-w-0 cursor-pointer break-words">
                            {opt.label}
                            <Show when={opt.recommended}>
                              <em class="text-sm not-italic text-primary">
                                {' '}
                                {t('questionConfirm.recommended')}
                              </em>
                            </Show>
                          </RadioGroupItemLabel>
                        </RadioGroupItem>
                      )}
                    </For>
                    <RadioGroupItem
                      value={FREEFORM_SENTINEL}
                      class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                    >
                      <RadioGroupItemInput />
                      <RadioGroupItemControl />
                      <RadioGroupItemLabel class="qcp-option-freeform cursor-pointer">
                        {t('questionConfirm.freeformLabel')}
                      </RadioGroupItemLabel>
                    </RadioGroupItem>
                  </RadioGroup>
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
                  <RadioGroup
                    class="m-0 flex flex-col gap-1 p-0"
                    value={draft().confirmTop ?? ''}
                    onChange={(v) => setConfirmTop(q.id, v as ConfirmTop)}
                  >
                    <RadioGroupItem
                      value="accept"
                      class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                    >
                      <RadioGroupItemInput />
                      <RadioGroupItemControl />
                      <RadioGroupItemLabel class="qcp-confirm-accept cursor-pointer">
                        {t('questionConfirm.decisionAccept')}
                      </RadioGroupItemLabel>
                    </RadioGroupItem>
                    <RadioGroupItem
                      value="reject"
                      class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                    >
                      <RadioGroupItemInput />
                      <RadioGroupItemControl />
                      <RadioGroupItemLabel class="qcp-confirm-reject cursor-pointer font-medium text-destructive">
                        {t('questionConfirm.decisionReject')}
                      </RadioGroupItemLabel>
                    </RadioGroupItem>
                  </RadioGroup>
                  {/* 二级：否决意图 */}
                  <Show when={draft().confirmTop === 'reject'}>
                    <RadioGroup
                      class="m-0 ml-5 flex flex-col gap-1 border-l border-border pl-2"
                      value={draft().confirmIntent ?? ''}
                      onChange={(v) => setConfirmIntent(q.id, v as RejectIntent)}
                    >
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
                          <RadioGroupItem
                            value={intent}
                            class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                          >
                            <RadioGroupItemInput />
                            <RadioGroupItemControl />
                            <RadioGroupItemLabel class="min-w-0 cursor-pointer break-words">
                              {label}
                            </RadioGroupItemLabel>
                          </RadioGroupItem>
                        )}
                      </For>
                      {/* 三级：弃目标范围 */}
                      <Show when={draft().confirmIntent === 'dropGoal'}>
                        <RadioGroup
                          class="m-0 ml-5 flex flex-col gap-1 border-l border-border pl-2"
                          value={draft().confirmDrop ?? ''}
                          onChange={(v) => setConfirmDrop(q.id, v as DropTarget)}
                        >
                          <For
                            each={
                              [
                                ['current', t('questionConfirm.dropGoalCurrent')],
                                ['spec', t('questionConfirm.dropGoalSpec')],
                              ] as const
                            }
                          >
                            {([drop, label]) => (
                              <RadioGroupItem
                                value={drop}
                                class="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-primary/5"
                              >
                                <RadioGroupItemInput />
                                <RadioGroupItemControl />
                                <RadioGroupItemLabel class="min-w-0 cursor-pointer break-words">
                                  {label}
                                </RadioGroupItemLabel>
                              </RadioGroupItem>
                            )}
                          </For>
                        </RadioGroup>
                      </Show>
                    </RadioGroup>
                  </Show>
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

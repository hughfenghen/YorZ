import { For, Show, createMemo, createSignal, type Component } from 'solid-js'
import type { ConfirmQuestion } from '../lib/question-parse.js'
import type { AnnotationBody, QuestionAnswerBody, QuestionAnswersBody } from '../lib/api.js'
import { buildAnswerItem, FREEFORM_SENTINEL } from '../lib/answer-payload.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'
import { X } from 'lucide-solid'
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

interface AnswerDraft {
  selectedOptionLabel?: string
  note: string
}

export const QuestionConfirmPanel: Component<Props> = (props) => {
  const initialAnswers = (): Record<string, AnswerDraft> => {
    const out: Record<string, AnswerDraft> = {}
    for (const q of props.questions) {
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

  function setChoice(qid: string, label: string) {
    setAnswers((prev) => ({
      ...prev,
      [qid]: { ...prev[qid], selectedOptionLabel: label },
    }))
  }
  function setNote(qid: string, note: string) {
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], note } }))
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
      <header class="grid [grid-template-columns:auto_1fr] gap-x-2 gap-y-1.5 border-b bg-background px-3 py-2.5">
        <strong class="font-semibold">{t('questionConfirm.title')}</strong>
        <span class="text-muted-foreground text-right">
          {t('questionConfirm.unanswered')} <span class="font-semibold text-accent">{unanswered()}</span> / {props.questions.length}
        </span>
        <div class="col-span-full flex gap-1.5">
          <Button
            disabled={busy() || props.running}
            onClick={submit}
          >
            {busy() ? t('common.submitting') : props.running ? t('questionConfirm.running') : t('questionConfirm.submitAll')}
          </Button>
        </div>
      </header>
      <Show when={error()}>
        <p class="text-destructive mx-3 mt-1 ">{error()}</p>
      </Show>
      <ul class="m-0 flex min-h-0 min-w-0 list-none flex-1 flex-col gap-2 overflow-auto p-2">
        <For each={props.questions}>
          {(q) => {
            const draft = () => answers()[q.id] ?? { note: '' }
            const showNote = () => q.isFreeform || draft().selectedOptionLabel === FREEFORM_SENTINEL
            return (
              <li class="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2.5">
                <p class="qcp-question m-0 font-medium break-words">{q.text}</p>
                <Show when={!q.isFreeform}>
                  <ul class="m-0 flex list-none flex-col gap-1 p-0">
                    <For each={q.options}>
                      {(opt) => (
                        <li>
                          <label class="flex cursor-pointer items-start gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={draft().selectedOptionLabel === opt.label}
                              onChange={() => setChoice(q.id, opt.label)}
                            />
                            <span class="min-w-0 break-words">
                              {opt.label}
                              <Show when={opt.recommended}>
                                <em class="text-accent text-sm not-italic"> {t('questionConfirm.recommended')}</em>
                              </Show>
                            </span>
                          </label>
                        </li>
                      )}
                    </For>
                    <li>
                      <label class="qcp-option-freeform flex cursor-pointer items-start gap-1.5 px-1 py-0.5 rounded-md hover:bg-primary/5">
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
                <Show when={showNote()}>
                  <Textarea
                    class="qcp-note"
                    rows={2}
                    placeholder={t('questionConfirm.notePlaceholder')}
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
                <em>{f.sectionPath}</em> {t('questionConfirm.quoteConnector')} "{f.quote.slice(0, 200)}"
              </blockquote>
              <p class="m-0 whitespace-pre-wrap break-words">！！！{f.note}</p>
            </li>
          )}
        </For>
      </ul>
    </aside>
  )
}

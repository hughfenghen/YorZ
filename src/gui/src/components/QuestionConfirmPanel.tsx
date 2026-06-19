import { For, Show, createMemo, createSignal, type Component } from 'solid-js'
import type { ConfirmQuestion } from '../lib/question-parse.js'
import type { AnnotationBody, QuestionAnswerBody, QuestionAnswersBody } from '../lib/api.js'
import { buildAnswerItem, FREEFORM_OPTION_LABEL, FREEFORM_SENTINEL } from '../lib/answer-payload.js'

export interface FreeformDraft {
  id: string
  sectionPath: string
  quote: string
  note: string
}

interface Props {
  questions: ConfirmQuestion[]
  freeforms: FreeformDraft[]
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
    setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], selectedOptionLabel: label } }))
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
      if (q.isFreeform) {
        if (!draft.note.trim()) count += 1
      } else if (draft.selectedOptionLabel === FREEFORM_SENTINEL) {
        if (!draft.note.trim()) count += 1
      } else if (!draft.selectedOptionLabel) {
        count += 1
      }
    }
    return count
  })

  function useAllRecommended() {
    setAnswers((prev) => {
      const next: Record<string, AnswerDraft> = { ...prev }
      for (const q of props.questions) {
        if (q.isFreeform) continue
        const recommended = q.options.find((o) => o.recommended) ?? q.options[0]
        if (recommended) {
          next[q.id] = { ...next[q.id], selectedOptionLabel: recommended.label }
        }
      }
      return next
    })
  }

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
        setError('没有可提交的答复')
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
    <aside class="question-confirm-panel" data-testid="question-confirm-panel">
      <header class="qcp-head">
        <strong>待确认问题</strong>
        <span class="muted">
          未答题 <span class="qcp-count">{unanswered()}</span> / {props.questions.length}
        </span>
        <div class="qcp-head-actions">
          <button type="button" onClick={useAllRecommended}>
            全部使用推荐
          </button>
          <button type="button" class="primary-action" disabled={busy()} onClick={submit}>
            {busy() ? '提交中…' : '提交全部'}
          </button>
        </div>
      </header>
      <Show when={error()}>
        <p class="error qcp-error">{error()}</p>
      </Show>
      <ul class="qcp-list">
        <For each={props.questions}>
          {(q) => {
            const draft = () => answers()[q.id] ?? { note: '' }
            const showNote = () => q.isFreeform || draft().selectedOptionLabel === FREEFORM_SENTINEL
            return (
              <li class="qcp-card">
                <p class="qcp-question">{q.text}</p>
                <Show when={!q.isFreeform}>
                  <ul class="qcp-options">
                    <For each={q.options}>
                      {(opt) => (
                        <li>
                          <label class="qcp-option">
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={draft().selectedOptionLabel === opt.label}
                              onChange={() => setChoice(q.id, opt.label)}
                            />
                            <span>
                              {opt.label}
                              <Show when={opt.recommended}>
                                <em class="qcp-recommended"> (推荐)</em>
                              </Show>
                            </span>
                          </label>
                        </li>
                      )}
                    </For>
                    <li>
                      <label class="qcp-option qcp-option-freeform">
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={draft().selectedOptionLabel === FREEFORM_SENTINEL}
                          onChange={() => setChoice(q.id, FREEFORM_SENTINEL)}
                        />
                        <span>{FREEFORM_OPTION_LABEL}</span>
                      </label>
                    </li>
                  </ul>
                </Show>
                <Show when={showNote()}>
                  <textarea
                    class="qcp-note"
                    rows={2}
                    placeholder="写下你的答复…"
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
            <li class="qcp-card qcp-card-freeform">
              <header class="qcp-card-head">
                <strong>选区批注</strong>
                <button
                  type="button"
                  class="qcp-remove"
                  onClick={() => props.onRemoveFreeform(f.id)}
                  aria-label="移除"
                >
                  ×
                </button>
              </header>
              <blockquote class="qcp-quote">
                <em>{f.sectionPath}</em> 中 “{f.quote.slice(0, 200)}”
              </blockquote>
              <p class="qcp-freeform-note">！！！{f.note}</p>
            </li>
          )}
        </For>
      </ul>
    </aside>
  )
}

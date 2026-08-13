import type { AgentContextKind, MessagePart, SessionMessage } from './api.js'

/**
 * Chat's rendering model, in two layers.
 *
 * Layer 1 — the **part stream**: an append-only, flat list of what actually
 * happened, in arrival order. Both entry points (the transcript API and the SSE
 * live stream) translate their input into the same `ChatPart`s, which is what
 * makes a reloaded session look identical to the one you just watched stream in.
 *
 * Layer 2 — **blocks**: `groupParts()` folds the stream into the bubbles we draw.
 * Keeping this a pure function (no solid-js, no DOM) is deliberate: vitest runs
 * in a node environment over `src/**\/*.test.ts` only, so any logic that lives in
 * a `.tsx` component is untestable. All grouping decisions therefore live here.
 */

export type ChatRole = 'user' | 'assistant'

export interface TextPart {
  kind: 'text'
  role: ChatRole
  text: string
}

export interface ToolPart {
  kind: 'tool'
  name?: string
  input?: unknown
  result?: string
}

export interface AgentContextPart {
  kind: 'context'
  contextKind: AgentContextKind
  text: string
}

export type ChatPart = TextPart | ToolPart | AgentContextPart

export interface UserBlock {
  kind: 'user'
  text: string
}

export interface TextSegment {
  kind: 'text'
  text: string
}

export interface ToolsSegment {
  kind: 'tools'
  tools: ToolPart[]
}

export type Segment = TextSegment | ToolsSegment

export interface AssistantBlock {
  kind: 'assistant'
  segments: Segment[]
}

export interface AgentContextBlock {
  kind: 'context'
  contexts: AgentContextPart[]
}

export type ChatBlock = UserBlock | AssistantBlock | AgentContextBlock

const MESSAGE_TEXT_SEPARATOR = '\n\n'

/**
 * Mirror of the markers in `src/service/custom-instruction.ts`. The GUI reaches
 * the service over HTTP and shares no module graph with it, so the pair is
 * duplicated here — keep both sides in sync.
 */
const HIDDEN_PROMPT_OPEN = '<!-- yorz:hidden -->'
const HIDDEN_PROMPT_RE = /<!-- yorz:hidden -->[\s\S]*?<!-- \/yorz:hidden -->\n?/g

/**
 * Remove prompt text the service injected on the user's behalf (a custom slash
 * command's hidden prompt, the `/yorz-debug` expansion, attachment paths). The
 * user's own words are stored outside the markers, so what remains equals the
 * text the composer optimistically rendered at send time.
 */
export function stripHiddenPrompt(text: string): string {
  if (!text.includes(HIDDEN_PROMPT_OPEN)) return text
  return text.replace(HIDDEN_PROMPT_RE, '').trim()
}

/**
 * Translate one wire-level `MessagePart` into a `ChatPart`.
 *
 * Note the role is dropped for tool parts. The protocol reports `tool-result`
 * under `role: 'user'` (it is a tool-call response, not a human turn), but
 * semantically it belongs to the assistant's current turn — so tool parts carry
 * no role at all and never split a bubble. See `groupParts`.
 */
export function toPart(role: ChatRole, part: MessagePart): ChatPart {
  if (part.type === 'text') {
    if (part.contextKind) return { kind: 'context', contextKind: part.contextKind, text: part.text }
    return { kind: 'text', role, text: role === 'user' ? stripHiddenPrompt(part.text) : part.text }
  }
  if (part.type === 'tool-use') return { kind: 'tool', name: part.name, input: part.input }
  return { kind: 'tool', result: part.text }
}

/**
 * Convert transcript messages into the same part stream used by live SSE, while
 * preserving one piece of information that plain `flatMap(toPart)` loses: a
 * boundary between two persisted messages with the same role and text type.
 */
export function messagesToParts(messages: readonly SessionMessage[]): ChatPart[] {
  const out: ChatPart[] = []

  for (const message of messages) {
    let emittedTextInMessage = false

    for (const wirePart of message.parts) {
      const part = toPart(message.role, wirePart)

      if (part.kind === 'text') {
        const prev = out[out.length - 1]
        const startsNewSameRoleTextMessage =
          !emittedTextInMessage && prev?.kind === 'text' && prev.role === part.role
        out.push(
          startsNewSameRoleTextMessage
            ? { ...part, text: MESSAGE_TEXT_SEPARATOR + part.text }
            : part,
        )
        emittedTextInMessage = true
      } else {
        out.push(part)
      }
    }
  }

  return out
}

/** Attach a tool-result to the last tool that is still waiting for one. */
function absorbResult(tools: ToolPart[], result: string): void {
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i]!
    if (t.result === undefined) {
      t.result = result
      return
    }
  }
  // A result with no preceding un-answered use (e.g. a transcript that starts
  // mid-turn) still deserves to be shown — keep it as a standalone item.
  tools.push({ kind: 'tool', result })
}

/**
 * Fold the part stream into bubbles.
 *
 * The one rule that matters: **only a user text part starts a new bubble.**
 * Everything between two user turns — assistant text and every tool part — lands
 * in a single assistant bubble, whose segments alternate between markdown text
 * and collapsible `[Tool]` runs. This is what removes the bubble-per-message
 * fragmentation: a long agent turn is one bubble, not a dozen.
 */
export function groupParts(parts: readonly ChatPart[]): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let current: AssistantBlock | null = null

  const assistant = (): AssistantBlock => {
    if (!current) {
      current = { kind: 'assistant', segments: [] }
      blocks.push(current)
    }
    return current
  }

  for (const part of parts) {
    if (part.kind === 'context') {
      current = null
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock?.kind === 'context') lastBlock.contexts.push(part)
      else blocks.push({ kind: 'context', contexts: [part] })
      continue
    }

    if (part.kind === 'text' && part.role === 'user') {
      // Close the open assistant bubble; the next agent output starts a fresh one.
      current = null
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock?.kind === 'user') lastBlock.text += part.text
      else blocks.push({ kind: 'user', text: part.text })
      continue
    }

    const block = assistant()
    const last = block.segments[block.segments.length - 1]

    if (part.kind === 'text') {
      // Streaming deltas arrive as many small parts — merge them so markdown is
      // parsed over a whole paragraph, not over each fragment.
      if (last?.kind === 'text') last.text += part.text
      else block.segments.push({ kind: 'text', text: part.text })
      continue
    }

    if (last?.kind === 'tools') {
      if (part.result !== undefined && part.name === undefined)
        absorbResult(last.tools, part.result)
      else last.tools.push({ ...part })
    } else {
      block.segments.push({ kind: 'tools', tools: [{ ...part }] })
    }
  }

  // An empty assistant bubble can only come from a turn that produced nothing;
  // rendering it would reintroduce the blank-bubble bug this model exists to fix.
  return blocks.filter((b) => b.kind !== 'assistant' || b.segments.length > 0)
}

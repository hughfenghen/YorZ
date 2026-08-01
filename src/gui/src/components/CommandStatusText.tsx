import type { Component } from 'solid-js'
import type { CommandRunStatus } from '../lib/api.js'
import { t } from '../i18n/index.js'

/**
 * Run status is read-only information, so it renders as coloured text rather
 * than a badge/pill — a filled rounded chip reads as a button and invites a
 * click that does nothing.
 *
 * Shared by the running-commands list and the run detail page so the two can
 * never drift apart.
 */
const STATUS_TEXT: Record<CommandRunStatus, string> = {
  running: 'text-emerald-600 dark:text-emerald-400',
  exited: 'text-muted-foreground',
  killed: 'text-amber-600 dark:text-amber-400',
  failed: 'text-rose-600 dark:text-rose-400',
}

export interface CommandStatusTextProps {
  status: CommandRunStatus
  class?: string
}

export const CommandStatusText: Component<CommandStatusTextProps> = (props) => (
  <span class={`shrink-0 text-xs font-medium ${STATUS_TEXT[props.status]} ${props.class ?? ''}`}>
    {t(`commands.status.${props.status}`)}
  </span>
)

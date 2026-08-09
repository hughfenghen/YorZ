import type { SystemNotification } from './api.js'

export interface WaitForNotificationResetOptions {
  id: string
  list: () => Promise<SystemNotification[]>
  intervalMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_INTERVAL_MS = 200
const DEFAULT_TIMEOUT_MS = 8000

export async function waitForNotificationReset({
  id,
  list,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = delay,
}: WaitForNotificationResetOptions): Promise<boolean> {
  const step = Math.max(1, intervalMs)
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / step) + 1)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const items = await list()
      if (!items.some((item) => item.id === id)) return true
    } catch {
      // The service may be between stop and start during restart.
    }
    if (attempt < maxAttempts - 1) await sleep(step)
  }

  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

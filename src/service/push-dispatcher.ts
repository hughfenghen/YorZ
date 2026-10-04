import webpush from 'web-push'
import { getLogger } from './logger.js'
import { createPushStore, type PushStore } from './push-store.js'

/**
 * Web Push 发送器：用 VAPID 私钥签名后向全部订阅投递通知。
 *
 * 全程 best-effort——单个订阅失败不影响其余，整体不抛；订阅失效（Push 服务返回
 * 404/410）时自动从 push-store 剔除，避免僵尸订阅长期堆积。
 */

export interface PushPayload {
  title: string
  body: string
  /** 点击通知后要聚焦/打开的路径，SW 侧消费。 */
  url?: string
}

export interface PushDispatcher {
  send(payload: PushPayload): Promise<{ sent: number; pruned: number }>
}

export function createPushDispatcher(store: PushStore = createPushStore()): PushDispatcher {
  const log = getLogger().child('push')
  return {
    async send(payload) {
      const subs = await store.listSubscriptions()
      if (subs.length === 0) return { sent: 0, pruned: 0 }
      const keys = await store.getVapidKeys()
      const body = JSON.stringify(payload)
      let sent = 0
      let pruned = 0
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(sub, body, {
              vapidDetails: {
                subject: keys.subject,
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
              },
            })
            sent++
          } catch (err) {
            const statusCode =
              err && typeof err === 'object' ? (err as { statusCode?: number }).statusCode : undefined
            if (statusCode === 404 || statusCode === 410) {
              await store.removeSubscription(sub.endpoint).catch(() => {})
              pruned++
            } else {
              log.warn('push send failed', { endpoint: sub.endpoint, statusCode })
            }
          }
        }),
      )
      return { sent, pruned }
    },
  }
}

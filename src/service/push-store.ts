import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import webpush from 'web-push'
import { resolveGlobalConfigDir } from './global-config.js'

/**
 * Web Push 的 VAPID 密钥与浏览器订阅持久化。
 *
 * 刻意不塞进 `config.json`：密钥是长随机串、订阅是易变的浏览器端点，塞进用户可读写的
 * 配置只会污染可读性并增加被误删的面。两者各自落在全局配置目录的独立 JSON 文件，
 * 复用 {@link resolveGlobalConfigDir} 的定位逻辑（`YORZ_HOME` > `XDG_CONFIG_HOME` > `~/.config/yorz`）。
 */

/** 浏览器 `PushSubscription.toJSON()` 的结构，与前端 POST 上来的体一致。 */
export interface PushSubscriptionJSON {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** web-push 要求的联系人标识，必须是 `mailto:` 或 http(s) URL。 */
  subject: string
}

/** 本地占位联系人：仅用于满足 VAPID subject 的格式要求，不对外暴露真实邮箱。 */
const DEFAULT_SUBJECT = 'mailto:push@yorz.local'

export interface PushStore {
  getVapidKeys(): Promise<VapidKeys>
  getVapidPublicKey(): Promise<string>
  listSubscriptions(): Promise<PushSubscriptionJSON[]>
  /** 按 endpoint 去重保存；已存在则覆盖其 keys。 */
  addSubscription(sub: PushSubscriptionJSON): Promise<void>
  /** 按 endpoint 退订；返回是否命中删除。 */
  removeSubscription(endpoint: string): Promise<boolean>
}

function resolveDir(globalConfigPath?: string): string {
  // 与 session-end-notifier 对齐：传入的是 config.json 路径，取其所在目录。
  if (globalConfigPath && globalConfigPath.trim()) return dirname(globalConfigPath)
  return resolveGlobalConfigDir()
}

async function writeJsonAtomic(fp: string, value: unknown): Promise<void> {
  await mkdir(dirname(fp), { recursive: true })
  const body = `${JSON.stringify(value, null, 2)}\n`
  const tmp = `${fp}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, fp)
}

async function readJson<T>(fp: string): Promise<T | null> {
  if (!existsSync(fp)) return null
  try {
    const raw = await readFile(fp, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.endpoint !== 'string' || !obj.endpoint) return false
  const keys = obj.keys
  if (!keys || typeof keys !== 'object') return false
  const k = keys as Record<string, unknown>
  return typeof k.p256dh === 'string' && typeof k.auth === 'string'
}

export function createPushStore(globalConfigPath?: string): PushStore {
  const dir = resolveDir(globalConfigPath)
  const vapidPath = join(dir, 'vapid.json')
  const subsPath = join(dir, 'push-subscriptions.json')

  // 串行化读-改-写，避免并发订阅操作互相覆盖。
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn)
    tail = next.catch(() => {})
    return next
  }

  const loadSubs = async (): Promise<PushSubscriptionJSON[]> => {
    const parsed = await readJson<unknown>(subsPath)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidSubscription)
  }

  return {
    async getVapidKeys() {
      const existing = await readJson<Partial<VapidKeys>>(vapidPath)
      if (existing && existing.publicKey && existing.privateKey) {
        return {
          publicKey: existing.publicKey,
          privateKey: existing.privateKey,
          subject: existing.subject || DEFAULT_SUBJECT,
        }
      }
      const generated = webpush.generateVAPIDKeys()
      const keys: VapidKeys = {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
        subject: DEFAULT_SUBJECT,
      }
      await serialize(() => writeJsonAtomic(vapidPath, keys))
      return keys
    },

    async getVapidPublicKey() {
      return (await this.getVapidKeys()).publicKey
    },

    listSubscriptions() {
      return loadSubs()
    },

    addSubscription(sub) {
      return serialize(async () => {
        const subs = await loadSubs()
        const next = subs.filter((s) => s.endpoint !== sub.endpoint)
        next.push(sub)
        await writeJsonAtomic(subsPath, next)
      })
    },

    removeSubscription(endpoint) {
      return serialize(async () => {
        const subs = await loadSubs()
        const next = subs.filter((s) => s.endpoint !== endpoint)
        if (next.length === subs.length) return false
        await writeJsonAtomic(subsPath, next)
        return true
      })
    },
  }
}

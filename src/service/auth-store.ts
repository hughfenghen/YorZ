import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveGlobalConfigDir } from './global-config.js'

/**
 * 配对鉴权的令牌持久化（能力 URL / 持有令牌模型）。
 *
 * 落在全局配置目录的独立文件 `auth.json`，复用 {@link resolveGlobalConfigDir} 的定位逻辑
 * （`YORZ_HOME` > `XDG_CONFIG_HOME` > `~/.config/yorz`），与 push-store 同范式。
 *
 * - **主令牌（token）**：高熵随机串，明文持久化——`yorz serve` 启动需回读以重新打印
 *   能力 URL，且重启复用令牌使旧授权（localStorage）持续有效。安全性等同 shutdown token
 *   （落在用户私有配置目录）。
 * - **设备令牌（devices[].tokenHash）**：手机经配对码换取的各自令牌，服务端只存其 sha256
 *   哈希，可按设备单独吊销。
 *
 * 校验统一走哈希比对 + 常量时间比较，避免长度泄漏与计时侧信道。
 */

export interface PairedDevice {
  /** 设备令牌的 sha256（hex）。服务端不存明文。 */
  tokenHash: string
  /** 便于人读的标签（如 UA 摘要），仅用于展示/吊销。 */
  label: string
  /** ISO 时间戳。 */
  pairedAt: string
}

interface AuthFile {
  token: string
  devices: PairedDevice[]
}

export interface AuthStore {
  /** 惰性生成并返回明文主令牌，用于打印能力 URL。 */
  getMasterToken(): Promise<string>
  /** 校验 bearer 令牌：命中主令牌或任一设备令牌即放行。 */
  validateToken(token: string | undefined | null): Promise<boolean>
  /** 保存一个设备令牌（存其哈希），返回保存后的设备条目。 */
  addDevice(token: string, label: string): Promise<PairedDevice>
  listDevices(): Promise<PairedDevice[]>
}

function resolveDir(globalConfigPath?: string): string {
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 常量时间比较两个等长 hex 摘要，长度不同视为不匹配。 */
function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function normalizeDevice(value: unknown): PairedDevice | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.tokenHash !== 'string' || !obj.tokenHash) return null
  const label = typeof obj.label === 'string' ? obj.label : ''
  const pairedAt = typeof obj.pairedAt === 'string' ? obj.pairedAt : ''
  return { tokenHash: obj.tokenHash, label, pairedAt }
}

export function createAuthStore(globalConfigPath?: string): AuthStore {
  const dir = resolveDir(globalConfigPath)
  const authPath = join(dir, 'auth.json')

  // 串行化读-改-写，避免并发写令牌文件互相覆盖。
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn)
    tail = next.catch(() => {})
    return next
  }

  const loadFile = async (): Promise<AuthFile> => {
    const parsed = await readJson<Partial<AuthFile>>(authPath)
    const token = parsed && typeof parsed.token === 'string' ? parsed.token : ''
    const devices = Array.isArray(parsed?.devices)
      ? (parsed!.devices.map(normalizeDevice).filter(Boolean) as PairedDevice[])
      : []
    return { token, devices }
  }

  const ensureMaster = (): Promise<string> =>
    serialize(async () => {
      const file = await loadFile()
      if (file.token) return file.token
      const token = randomBytes(32).toString('base64url')
      await writeJsonAtomic(authPath, { token, devices: file.devices })
      return token
    })

  return {
    getMasterToken() {
      return ensureMaster()
    },

    async validateToken(token) {
      if (!token || typeof token !== 'string') return false
      const incoming = hashToken(token)
      const master = await ensureMaster()
      if (hashEquals(incoming, hashToken(master))) return true
      const file = await loadFile()
      return file.devices.some((d) => hashEquals(incoming, d.tokenHash))
    },

    addDevice(token, label) {
      return serialize(async () => {
        const file = await loadFile()
        if (!file.token) file.token = randomBytes(32).toString('base64url')
        const device: PairedDevice = {
          tokenHash: hashToken(token),
          label: label.slice(0, 120),
          pairedAt: new Date().toISOString(),
        }
        file.devices.push(device)
        await writeJsonAtomic(authPath, file)
        return device
      })
    },

    async listDevices() {
      return (await loadFile()).devices
    },
  }
}

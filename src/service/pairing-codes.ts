import { randomInt } from 'node:crypto'

/**
 * 内存一次性配对码。已授权端（PC 持主令牌）签发短码，手机扫码/手输后以码换设备令牌。
 *
 * 设计（见 spec D4/D9）：
 * - 8 位，字母表为 Crockford base32 去除易混的 `0 O 1 I L`（共 30 个字符）；
 * - TTL 5 分钟、一次性（claim 成功即失效）、单活动码（新签发覆盖旧）；
 * - 失败计数限流：连续失败达到阈值后短暂封禁，杜绝暴力猜码。
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 8
const DEFAULT_TTL_MS = 5 * 60 * 1000
const MAX_FAILURES = 5
const LOCKOUT_MS = 60 * 1000

export interface IssuedCode {
  code: string
  expiresAt: number
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'locked'; retryAfterMs: number }
  | { ok: false; reason: 'invalid' }

export interface PairingCodes {
  issue(now?: number): IssuedCode
  claim(input: string, now?: number): ClaimResult
}

function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)]
  }
  return out
}

/** 归一化用户输入：去空白、转大写，便于手输容错。 */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

export function createPairingCodes(options?: { ttlMs?: number }): PairingCodes {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  let active: { code: string; expiresAt: number } | null = null
  let failures = 0
  let lockedUntil = 0

  return {
    issue(now = Date.now()) {
      const code = generateCode()
      const expiresAt = now + ttlMs
      active = { code, expiresAt }
      // 新码签发时重置失败计数，避免旧码的失败影响新配对。
      failures = 0
      lockedUntil = 0
      return { code, expiresAt }
    },

    claim(input, now = Date.now()) {
      if (now < lockedUntil) {
        return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - now }
      }
      const code = normalizeCode(input)
      const current = active
      const valid = current && current.expiresAt > now && current.code === code
      if (!valid) {
        failures += 1
        if (failures >= MAX_FAILURES) {
          lockedUntil = now + LOCKOUT_MS
          failures = 0
        }
        return { ok: false, reason: 'invalid' }
      }
      // 一次性：命中即作废并复位限流。
      active = null
      failures = 0
      lockedUntil = 0
      return { ok: true }
    },
  }
}

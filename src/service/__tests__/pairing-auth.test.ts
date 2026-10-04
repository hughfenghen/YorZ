import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'
import { createAuthStore } from '../auth-store.js'
import { createPairingCodes, normalizeCode } from '../pairing-codes.js'

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function startWithAuth(): Promise<{ url: string; cfgDir: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-pair-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-pair-cfg-'))
  // 真·鉴权（不设 disableAuth），配对相关端点/中间件全链路生效。
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  return { url: handle.url, cfgDir }
}

describe('pairing auth middleware', () => {
  it('rejects /api without a token and accepts the master token', async () => {
    const { url, cfgDir } = await startWithAuth()

    const anon = await fetch(`${url}api/global-config`)
    expect(anon.status).toBe(401)

    const authFile = JSON.parse(await readFile(join(cfgDir, 'auth.json'), 'utf8')) as {
      token: string
    }
    expect(authFile.token).toBeTruthy()

    const authed = await fetch(`${url}api/global-config`, {
      headers: { 'x-yorz-pair-token': authFile.token },
    })
    expect(authed.status).toBe(200)

    // query 形式（供 EventSource）同样放行。
    const viaQuery = await fetch(`${url}api/global-config?token=${authFile.token}`)
    expect(viaQuery.status).toBe(200)
  })

  it('issues a code with the master token and claims a device token (end to end)', async () => {
    const { url, cfgDir } = await startWithAuth()
    const authFile = JSON.parse(await readFile(join(cfgDir, 'auth.json'), 'utf8')) as {
      token: string
    }

    // 无令牌不能签发配对码。
    const denied = await fetch(`${url}api/pairing/code`)
    expect(denied.status).toBe(401)

    const codeRes = await fetch(`${url}api/pairing/code`, {
      headers: { 'x-yorz-pair-token': authFile.token },
    })
    expect(codeRes.status).toBe(200)
    const { code } = (await codeRes.json()) as { code: string }
    expect(code).toHaveLength(8)

    // claim 在放行清单内，无需令牌。
    const claimRes = await fetch(`${url}api/pairing/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(claimRes.status).toBe(200)
    const { token: deviceToken } = (await claimRes.json()) as { token: string }
    expect(deviceToken).toBeTruthy()
    expect(deviceToken).not.toBe(authFile.token)

    // 设备令牌可访问 /api。
    const withDevice = await fetch(`${url}api/global-config`, {
      headers: { 'x-yorz-pair-token': deviceToken },
    })
    expect(withDevice.status).toBe(200)

    // 一次性：同一个码再次 claim 应失败。
    const reuse = await fetch(`${url}api/pairing/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(reuse.status).toBe(401)
  })
})

describe('auth-store', () => {
  it('reuses the persisted master token and validates device hashes', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-authstore-'))
    const globalConfigPath = join(cfgDir, 'config.json')
    const store = createAuthStore(globalConfigPath)

    const master = await store.getMasterToken()
    expect(master).toBeTruthy()
    // 重启复用：新建 store 读同一文件应得同一主令牌。
    expect(await createAuthStore(globalConfigPath).getMasterToken()).toBe(master)

    expect(await store.validateToken(master)).toBe(true)
    expect(await store.validateToken('bogus')).toBe(false)
    expect(await store.validateToken(undefined)).toBe(false)

    const deviceToken = 'device-token-value'
    await store.addDevice(deviceToken, 'ua')
    expect(await store.validateToken(deviceToken)).toBe(true)
    expect((await store.listDevices())[0]?.tokenHash).not.toBe(deviceToken)
  })
})

describe('pairing codes', () => {
  it('is single-use, respects TTL, and locks out after repeated failures', () => {
    const codes = createPairingCodes({ ttlMs: 1000 })
    const t0 = 1_000_000

    const { code } = codes.issue(t0)
    // 大小写/空白容错。
    expect(normalizeCode(` ${code.toLowerCase()} `)).toBe(code)
    expect(codes.claim(code.toLowerCase(), t0 + 10)).toEqual({ ok: true })
    // 一次性。
    expect(codes.claim(code, t0 + 20).ok).toBe(false)

    const second = codes.issue(t0)
    // 过期。
    const expired = codes.claim(second.code, t0 + 2000)
    expect(expired.ok).toBe(false)

    // 连续失败触发锁定。
    codes.issue(t0)
    let locked = false
    for (let i = 0; i < 6; i++) {
      const r = codes.claim('WRONGCOD', t0 + 1)
      if (!r.ok && r.reason === 'locked') locked = true
    }
    expect(locked).toBe(true)
  })
})

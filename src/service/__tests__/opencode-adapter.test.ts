import { describe, expect, it } from 'vitest'
import { parseOpencodeQuotaOutput } from '../agent-sdk/opencode-adapter.js'

describe('parseOpencodeQuotaOutput', () => {
  it('parses opencode-quota show --json output', () => {
    const status = parseOpencodeQuotaOutput(
      JSON.stringify({
        version: 2,
        providers: {
          'google-antigravity': {
            status: 'ok',
            entries: [
              {
                name: 'Antigravity: Claude',
                percentRemaining: 100,
                resetAt: 1787208833,
              },
            ],
          },
          zhipu: {
            status: 'ok',
            entries: [
              { name: 'Zhipu 5h', percentRemaining: 85 },
              { name: 'Zhipu Weekly', percentRemaining: 60, resetAt: 1787191199 },
            ],
          },
        },
      }),
    )

    expect(status).toMatchObject({
      kind: 'opencode',
      status: 'available',
      source: 'external-cli',
      windows: [
        { label: 'Antigravity: Claude', utilization: 0 },
        { label: 'Zhipu 5h', utilization: 15 },
        { label: 'Zhipu Weekly', utilization: 40 },
      ],
    })
  })

  it('parses /quota TUI text output', () => {
    const status = parseOpencodeQuotaOutput(`
Quota (/quota) 14:57 13/08/2026

→ [Antigravity (kad…)]
  Quota         ██████████  100% left | reset 7d

→ [Zhipu]
  5h quota      ██████████  100% left
  Week quota    ██████████  75% left | reset 7d
  Quota         ██████████  50% left | reset 31d

Partial failures
  OpenAI: Token expired
`)

    expect(status).toMatchObject({
      kind: 'opencode',
      status: 'available',
      source: 'external-cli',
      windows: [
        { label: 'Antigravity (kad…): Quota', utilization: 0 },
        { label: 'Zhipu: 5h quota', utilization: 0 },
        { label: 'Zhipu: Week quota', utilization: 25 },
        { label: 'Zhipu: Quota', utilization: 50 },
      ],
    })
  })
})

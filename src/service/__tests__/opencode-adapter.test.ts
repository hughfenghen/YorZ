import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OpenCodeAdapter,
  parseOpenCodeModelCatalog,
  parseQualifiedModel,
} from '../agent-sdk/opencode-adapter.js'

const sdk = vi.hoisted(() => ({
  prompt: vi.fn(),
  abort: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  messages: vi.fn(),
  providers: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencode: vi.fn(async () => ({
    client: {
      session: {
        prompt: sdk.prompt,
        abort: sdk.abort,
        create: sdk.create,
        list: sdk.list,
        messages: sdk.messages,
      },
      provider: { list: sdk.providers },
    },
    server: { url: 'http://127.0.0.1', close: sdk.close },
  })),
}))

describe('OpenCodeAdapter model settings', () => {
  beforeEach(() => {
    for (const mock of Object.values(sdk)) mock.mockReset()
    sdk.create.mockResolvedValue({ data: { id: 'sid' } })
    sdk.prompt.mockResolvedValue({
      data: {
        info: { tokens: {}, modelID: 'model-a' },
        parts: [{ type: 'text', text: 'ok' }],
      },
    })
    sdk.list.mockResolvedValue({ data: [] })
    sdk.messages.mockResolvedValue({ data: [] })
  })

  it('parses provider/model ids without truncating model slashes', () => {
    expect(parseQualifiedModel('openrouter/anthropic/claude')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude',
    })
    expect(parseQualifiedModel('invalid')).toBeUndefined()
  })

  it('passes model and variant to prompt and omits them by default', async () => {
    const adapter = new OpenCodeAdapter('/repo')
    const configured = await adapter.createSession({
      model: 'openai/gpt-test',
      reasoningEffort: 'high',
    })
    for await (const _ of configured.send('hello')) void _
    expect(sdk.prompt.mock.calls[0]?.[0]).toMatchObject({
      sessionID: 'sid',
      model: { providerID: 'openai', modelID: 'gpt-test' },
      variant: 'high',
    })

    const implicit = await adapter.resumeSession('sid-2')
    for await (const _ of implicit.send('hello')) void _
    expect(sdk.prompt.mock.calls[1]?.[0]).not.toHaveProperty('model')
    expect(sdk.prompt.mock.calls[1]?.[0]).not.toHaveProperty('variant')
  })

  it('only exposes models from connected providers and maps variants', () => {
    expect(
      parseOpenCodeModelCatalog({
        connected: ['openai'],
        all: [
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              test: {
                id: 'gpt-test',
                name: 'GPT Test',
                variants: { low: {}, high: {} },
              },
            },
          },
          { id: 'other', name: 'Other', models: {} },
        ],
      } as never),
    ).toEqual({
      models: [
        {
          id: 'openai/gpt-test',
          displayName: 'OpenAI · GPT Test',
          reasoningEfforts: [
            { id: 'low', displayName: 'low' },
            { id: 'high', displayName: 'high' },
          ],
        },
      ],
      defaultReasoningEfforts: [],
    })
  })
})

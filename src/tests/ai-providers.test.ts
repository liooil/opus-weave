import { describe, expect, test } from 'bun:test'
import { aiProviderHint, aiRequestEndpoint, aiRequestHeaders, discoverAiModels, resolvedAiProtocol } from '../domain/ai/providers.ts'
import { createOwtWithAi } from '../domain/ai/owt-ai.ts'

const validOwt = `owt 0.1 score

title "Provider"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major
track "Melody" channel=1 program=0 velocity=88
| C4:1 D4:1 E4:1 F4:1 |
end
`

const request = { task: 'prompt' as const, instruction: 'keep it', currentOwt: validOwt }

describe('AI provider resolution', () => {
  test('recognizes official, proxy and local service URLs', () => {
    expect(aiProviderHint('https://api.openai.com')).toBe('openai')
    expect(aiProviderHint('https://api.anthropic.com')).toBe('anthropic')
    expect(aiProviderHint('https://openrouter.ai')).toBe('openrouter')
    expect(aiProviderHint('http://localhost:11434')).toBe('ollama')
    expect(aiProviderHint('http://127.0.0.1:8080')).toBe('llama.cpp')
    expect(aiProviderHint('http://192.168.6.130:8080')).toBe('llama.cpp')
  })

  test('normalizes request endpoints without duplicating API paths', () => {
    expect(aiRequestEndpoint({ baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' })).toBe('https://api.openai.com/v1/responses')
    expect(aiRequestEndpoint({ baseUrl: 'https://openrouter.ai', protocol: 'openai-chat-completions' })).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'http://localhost:11434/v1/chat/completions', protocol: 'openai-chat-completions' })).toBe('http://localhost:11434/v1/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'http://localhost:11434', protocol: 'ollama-native' })).toBe('http://localhost:11434/api/chat')
  })

  test('chooses safe defaults and Anthropic authentication headers', () => {
    expect(resolvedAiProtocol({ baseUrl: 'https://api.openai.com' })).toBe('openai-responses')
    expect(resolvedAiProtocol({ baseUrl: 'https://api.anthropic.com' })).toBe('anthropic-messages')
    expect(resolvedAiProtocol({ baseUrl: 'https://openrouter.ai' })).toBe('openai-chat-completions')
    expect(aiRequestHeaders({ baseUrl: 'https://api.anthropic.com', apiKey: 'secret' }, 'anthropic-messages')).toMatchObject({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' })
  })
})

describe('AI model discovery', () => {
  test('loads OpenAI-compatible model lists', async () => {
    let endpoint = ''
    const fetcher = (async (input: URL | RequestInfo) => {
      endpoint = String(input)
      return Response.json({ data: [{ id: 'model-a', owned_by: 'local' }, { id: 'model-b', name: 'Model B', context_length: 32768 }] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'http://model.test', protocol: 'openai-chat-completions' }, { fetcher })
    expect(endpoint).toBe('http://model.test/v1/models')
    expect(result.models.map((model) => model.id)).toEqual(['model-a', 'model-b'])
  })

  test('loads llama.cpp model lists from root and falls back to v1', async () => {
    const endpoints: string[] = []
    const fetcher = (async (input: URL | RequestInfo) => {
      endpoints.push(String(input))
      if (endpoints.length === 1) return new Response(null, { status: 404 })
      return Response.json({ models: [{ name: 'gemma4-vl-long', model: 'gemma4-vl-long', capabilities: ['completion', 'multimodal'] }] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'http://192.168.6.130:8080' }, { fetcher })
    expect(endpoints).toEqual(['http://192.168.6.130:8080/models', 'http://192.168.6.130:8080/v1/models'])
    expect(result).toMatchObject({ provider: 'llama.cpp', protocol: 'openai-chat-completions' })
    expect(result.models[0]).toMatchObject({ id: 'gemma4-vl-long', name: 'gemma4-vl-long', inputModalities: ['completion', 'multimodal'] })
  })

  test('loads native Ollama tags first', async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      expect(String(input)).toBe('http://localhost:11434/api/tags')
      return Response.json({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', details: { family: 'qwen3' } }] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'http://localhost:11434' }, { fetcher })
    expect(result).toMatchObject({ provider: 'ollama', protocol: 'ollama-native' })
    expect(result.models[0]?.id).toBe('qwen3:8b')
  })

  test('routes discovery through the desktop proxy without embedding credentials in forwarded headers', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('/api/ai/chat')
      const body = JSON.parse(String(init?.body)) as { endpoint: string; method: string; headers: Record<string, string>; apiKey: string }
      expect(body).toMatchObject({ endpoint: 'https://api.anthropic.com/v1/models', method: 'GET', apiKey: 'secret' })
      expect(body.headers.authorization).toBeUndefined()
      expect(body.headers['x-api-key']).toBeUndefined()
      return Response.json({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'https://api.anthropic.com', apiKey: 'secret' }, { fetcher, proxyUrl: '/api/ai/chat' })
    expect(result.models[0]).toMatchObject({ id: 'claude-test', name: 'Claude Test' })
  })
})

describe('AI protocol adapters', () => {
  test('sends OpenAI Responses requests and extracts output text', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('input')
      expect(body).toHaveProperty('max_output_tokens', 4096)
      expect(body).toHaveProperty('stream', true)
      return Response.json({ output_text: validOwt })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'https://api.openai.com', model: 'gpt-test' }, request, { fetcher })).toBe(validOwt)
  })

  test('sends Anthropic Messages requests and extracts content blocks', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages')
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('stream', true)
      expect(body).toHaveProperty('system')
      return Response.json({ content: [{ type: 'text', text: validOwt }] })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'https://api.anthropic.com', model: 'claude-test', apiKey: 'secret' }, request, { fetcher })).toBe(validOwt)
  })

  test('sends Ollama native chat requests and extracts message content', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:11434/api/chat')
      expect(JSON.parse(String(init?.body))).toHaveProperty('options.num_predict', 4096)
      expect(JSON.parse(String(init?.body))).toHaveProperty('stream', true)
      return Response.json({ message: { role: 'assistant', content: validOwt } })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'http://localhost:11434', model: 'qwen3:8b' }, request, { fetcher })).toBe(validOwt)
  })

  test('applies OpenAI-compatible SSE deltas while the score is still arriving', async () => {
    const pieces = [validOwt.slice(0, 24), validOwt.slice(24, 90), validOwt.slice(90)]
    const encoder = new TextEncoder()
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toHaveProperty('stream', true)
      return new Response(new ReadableStream({
        start(controller) {
          for (const content of pieces) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const updates: string[] = []
    const result = await createOwtWithAi({ baseUrl: 'http://model.test', model: 'stream-test' }, request, { fetcher, onUpdate: (text) => updates.push(text) })
    expect(result).toBe(validOwt)
    expect(updates).toHaveLength(3)
    expect(updates[0]!.length).toBeLessThan(result.length)
    expect(updates.at(-1)).toBe(validOwt)
  })
})

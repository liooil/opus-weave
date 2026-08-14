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
    expect(aiProviderHint('https://api.deepseek.com')).toBe('deepseek')
    expect(aiProviderHint('https://openrouter.ai')).toBe('openrouter')
    expect(aiProviderHint('http://localhost:11434')).toBe('ollama')
    expect(aiProviderHint('http://127.0.0.1:8080')).toBe('llama.cpp')
    expect(aiProviderHint('http://192.168.6.130:8080')).toBe('llama.cpp')
  })

  test('normalizes request endpoints without duplicating API paths', () => {
    expect(aiRequestEndpoint({ baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' })).toBe('https://api.openai.com/v1/responses')
    expect(aiRequestEndpoint({ baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat-completions' })).toBe('https://api.deepseek.com/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-chat-completions' })).toBe('https://api.deepseek.com/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'https://openrouter.ai', protocol: 'openai-chat-completions' })).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'http://localhost:11434/v1/chat/completions', protocol: 'openai-chat-completions' })).toBe('http://localhost:11434/v1/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'http://localhost:11434', protocol: 'ollama-native' })).toBe('http://localhost:11434/api/chat')
  })

  test('chooses safe defaults and Anthropic authentication headers', () => {
    expect(resolvedAiProtocol({ baseUrl: 'https://api.openai.com' })).toBe('openai-responses')
    expect(resolvedAiProtocol({ baseUrl: 'https://api.anthropic.com' })).toBe('anthropic-messages')
    expect(resolvedAiProtocol({ baseUrl: 'https://api.deepseek.com' })).toBe('openai-chat-completions')
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

  test('discovers models directly from the configured provider endpoint', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/models')
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('x-api-key')).toBe('secret')
      return Response.json({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'https://api.anthropic.com', apiKey: 'secret' }, { fetcher })
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
      expect(body).toHaveProperty('temperature', 0.2)
      expect(body).toHaveProperty('top_p', 0.8)
      expect(body).toHaveProperty('reasoning.effort', 'high')
      expect(body).toHaveProperty('stream', true)
      return Response.json({ output_text: validOwt })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'https://api.openai.com', model: 'gpt-test', temperature: 0.2, topP: 0.8, reasoningEffort: 'high' }, request, { fetcher })).toBe(validOwt)
  })

  test('sends Anthropic Messages requests and extracts content blocks', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages')
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('stream', true)
      expect(body).toHaveProperty('system')
      expect(body).toHaveProperty('thinking.type', 'adaptive')
      expect(body).toHaveProperty('output_config.effort', 'xhigh')
      return Response.json({ content: [{ type: 'text', text: validOwt }] })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'https://api.anthropic.com', model: 'claude-test', apiKey: 'secret', thinkingMode: 'adaptive', reasoningEffort: 'xhigh' }, request, { fetcher })).toBe(validOwt)
  })

  test('sends Ollama native chat requests and extracts message content', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:11434/api/chat')
      const body = JSON.parse(String(init?.body))
      expect(body).toHaveProperty('options.num_predict', 4096)
      expect(body).toHaveProperty('options.temperature', 0.25)
      expect(body).toHaveProperty('options.top_p', 0.9)
      expect(body).toHaveProperty('think', 'low')
      expect(body).toHaveProperty('stream', true)
      return Response.json({ message: { role: 'assistant', content: validOwt } })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'http://localhost:11434', model: 'qwen3:8b', thinkingMode: 'enabled', reasoningEffort: 'low', temperature: 0.25, topP: 0.9 }, request, { fetcher })).toBe(validOwt)
  })

  test('sends a manual thinking budget to legacy Anthropic models', async () => {
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toHaveProperty('thinking.type', 'enabled')
      expect(body).toHaveProperty('thinking.budget_tokens', 3072)
      return Response.json({ content: [{ type: 'text', text: validOwt }] })
    }) as typeof fetch
    expect(await createOwtWithAi({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-legacy-test',
      thinkingMode: 'enabled',
      thinkingBudgetTokens: 3072,
      maxTokens: 4096,
    }, request, { fetcher })).toBe(validOwt)
  })

  test('applies OpenAI-compatible SSE deltas while the score is still arriving', async () => {
    const pieces = [validOwt.slice(0, 24), validOwt.slice(24, 90), validOwt.slice(90)]
    const encoder = new TextEncoder()
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toHaveProperty('stream', true)
      expect(body).toHaveProperty('reasoning_effort', 'minimal')
      return new Response(new ReadableStream({
        start(controller) {
          for (const content of pieces) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const updates: string[] = []
    const result = await createOwtWithAi({ baseUrl: 'http://model.test', model: 'stream-test', reasoningEffort: 'minimal' }, request, { fetcher, onUpdate: (text) => updates.push(text) })
    expect(result).toBe(validOwt)
    expect(updates).toHaveLength(3)
    expect(updates[0]!.length).toBeLessThan(result.length)
    expect(updates.at(-1)).toBe(validOwt)
  })

  test('streams DeepSeek V4 reasoning separately while preserving thinking', async () => {
    const encoder = new TextEncoder()
    const streamResponse = (events: string[]): Response => new Response(new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('thinking.type', 'enabled')
      return streamResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'Thinking through the score...' } }] }),
        JSON.stringify({ choices: [{ delta: { content: validOwt } }] }),
      ])
    }) as typeof fetch
    const reasoning: string[] = []
    await expect(createOwtWithAi({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', thinkingMode: 'enabled' }, request, { fetcher, onReasoningUpdate: (text) => reasoning.push(text) })).resolves.toBe(validOwt)
    expect(reasoning).toEqual(['Thinking through the score...'])
  })
})

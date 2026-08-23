import { describe, expect, test } from 'bun:test'
import { AiProviderHttpError, aiProviderHint, aiRequestEndpoint, aiRequestHeaders, discoverAiBillingCurrency, discoverAiModels, extractAiTokenUsage, resolvedAiProtocol } from '../domain/ai/providers.ts'
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
    expect(aiProviderHint('https://ai.xiteng.site/v1')).toBe('deepseek')
    expect(aiProviderHint('https://staging.xiteng.site/v1')).toBe('deepseek')
    expect(aiProviderHint('https://openrouter.ai')).toBe('openrouter')
    expect(aiProviderHint('http://localhost:11434')).toBe('ollama')
    expect(aiProviderHint('http://127.0.0.1:8080')).toBe('llama.cpp')
    expect(aiProviderHint('http://192.168.6.130:8080')).toBe('llama.cpp')
  })

  test('normalizes request endpoints without duplicating API paths', () => {
    expect(aiRequestEndpoint({ baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' })).toBe('https://api.openai.com/v1/responses')
    expect(aiRequestEndpoint({ baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat-completions' })).toBe('https://api.deepseek.com/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-chat-completions' })).toBe('https://api.deepseek.com/chat/completions')
    expect(aiRequestEndpoint({ baseUrl: 'https://ai.xiteng.site/v1', protocol: 'openai-chat-completions' })).toBe('https://ai.xiteng.site/v1/chat/completions')
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

  test('discovers selectable managed models without authorization', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://ai.xiteng.site/v1/models')
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      return Response.json({ data: [
        { id: 'deepseek-v4-flash' },
        { id: 'deepseek-v4-pro' },
        { id: 'deepseek-v4-flash-vision-exp' },
      ] })
    }) as typeof fetch
    const result = await discoverAiModels({ baseUrl: 'https://ai.xiteng.site/v1' }, { fetcher })
    expect(result.models.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
    ])
  })
})

describe('AI billing currency discovery', () => {
  test('reads an unambiguous currency from DeepSeek without creating a charge', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.deepseek.com/user/balance')
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      return Response.json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] })
    }) as typeof fetch
    await expect(discoverAiBillingCurrency({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'secret' }, { fetcher })).resolves.toBe('CNY')
  })

  test('does not guess for unsupported providers or ambiguous balances', async () => {
    let calls = 0
    const fetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) => {
      calls += 1
      return Response.json({ balance_infos: [{ currency: 'CNY' }, { currency: 'USD' }] })
    }) as typeof fetch
    await expect(discoverAiBillingCurrency({ baseUrl: 'https://api.openai.com', apiKey: 'secret' }, { fetcher })).resolves.toBeUndefined()
    expect(calls).toBe(0)
    await expect(discoverAiBillingCurrency({ baseUrl: 'https://ai.xiteng.site/v1', apiKey: 'managed' }, { fetcher })).resolves.toBeUndefined()
    expect(calls).toBe(0)
    await expect(discoverAiBillingCurrency({ baseUrl: 'https://api.deepseek.com', apiKey: 'secret' }, { fetcher })).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })
})

describe('AI protocol adapters', () => {
  test('uses the managed DeepSeek-compatible endpoint and exposes quota headers', async () => {
    let quotaHeaders: Headers | undefined
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://ai.xiteng.site/v1/chat/completions')
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('stream_options.include_usage', true)
      expect(body).toHaveProperty('thinking.type', 'enabled')
      return Response.json({ choices: [{ message: { content: validOwt } }] }, {
        headers: { 'x-quota-spent-cny': '1.25', 'x-quota-limit-cny': '10' },
      })
    }) as typeof fetch
    await expect(createOwtWithAi({
      baseUrl: 'https://ai.xiteng.site/v1',
      protocol: 'openai-chat-completions',
      model: 'deepseek-v4-flash',
      thinkingMode: 'enabled',
    }, request, { fetcher, onResponseHeaders: (headers) => { quotaHeaders = headers } })).resolves.toBe(validOwt)
    expect(quotaHeaders?.get('x-quota-spent-cny')).toBe('1.25')
    expect(quotaHeaders?.get('x-quota-limit-cny')).toBe('10')
  })

  test('retains HTTP status and quota headers when the provider rejects a request', async () => {
    let quotaSpent = ''
    const fetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) => new Response('quota exceeded', {
      status: 429,
      headers: { 'x-quota-spent-cny': '10', 'x-quota-limit-cny': '10', 'retry-after': '3600' },
    })) as typeof fetch
    const promise = createOwtWithAi({
      baseUrl: 'https://ai.xiteng.site/v1',
      model: 'deepseek-v4-flash',
    }, request, {
      fetcher,
      onResponseHeaders: (headers) => { quotaSpent = headers.get('x-quota-spent-cny') ?? '' },
    })
    await expect(promise).rejects.toBeInstanceOf(AiProviderHttpError)
    expect(quotaSpent).toBe('10')
    try { await promise } catch (error) {
      expect(error).toMatchObject({ status: 429, retryAfter: '3600' })
    }
  })

  test('normalizes usage details from each supported provider protocol', () => {
    expect(extractAiTokenUsage('openai-chat-completions', {
      usage: {
        prompt_tokens: 100,
        prompt_cache_hit_tokens: 40,
        prompt_cache_miss_tokens: 60,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 12 },
        total_tokens: 130,
      },
    })).toEqual({ inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 0, outputTokens: 30, reasoningTokens: 12, totalTokens: 130 })
    expect(extractAiTokenUsage('openai-responses', {
      type: 'response.completed',
      response: { usage: { input_tokens: 80, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, output_tokens: 25, output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 105 } },
    })).toEqual({ inputTokens: 80, cachedInputTokens: 20, cacheWriteInputTokens: 10, outputTokens: 25, reasoningTokens: 5, totalTokens: 105 })
    expect(extractAiTokenUsage('anthropic-messages', {
      message: { usage: { input_tokens: 50, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: 1 } },
    })).toEqual({ inputTokens: 100, cachedInputTokens: 30, cacheWriteInputTokens: 20, outputTokens: 1, reasoningTokens: 0, totalTokens: 101 })
    expect(extractAiTokenUsage('ollama-native', { prompt_eval_count: 70, eval_count: 18 })).toEqual({ inputTokens: 70, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 18, reasoningTokens: 0, totalTokens: 88 })
  })

  test('sends OpenAI Responses requests and extracts output text', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('input')
      expect(body).toHaveProperty('max_output_tokens', 6144)
      expect(body).toHaveProperty('temperature', 0.2)
      expect(body).toHaveProperty('top_p', 0.8)
      expect(body).toHaveProperty('reasoning.effort', 'high')
      expect(body).toHaveProperty('stream', true)
      return Response.json({ output_text: validOwt })
    }) as typeof fetch
    expect(await createOwtWithAi({ baseUrl: 'https://api.openai.com', model: 'gpt-test', temperature: 0.2, topP: 0.8, reasoningEffort: 'high' }, request, { fetcher })).toBe(validOwt)
  })

  test('uses OpenAI Chat Completions combined limit without shrinking the final-answer budget', async () => {
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.max_tokens).toBeUndefined()
      expect(body).toHaveProperty('max_completion_tokens', 3000)
      return Response.json({ choices: [{ message: { content: validOwt } }] })
    }) as typeof fetch
    await expect(createOwtWithAi({
      baseUrl: 'https://api.openai.com',
      protocol: 'openai-chat-completions',
      model: 'gpt-test',
      reasoningEffort: 'high',
      maxTokens: 1000,
      thinkingBudgetTokens: 2000,
    }, request, { fetcher })).resolves.toBe(validOwt)
  })

  test('keeps the visible limit unchanged for a compatible endpoint without reasoning', async () => {
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('max_tokens', 1234)
      return Response.json({ choices: [{ message: { content: validOwt } }] })
    }) as typeof fetch
    await expect(createOwtWithAi({
      baseUrl: 'http://model.test',
      protocol: 'openai-chat-completions',
      model: 'plain-model',
      maxTokens: 1234,
      thinkingBudgetTokens: 5678,
    }, request, { fetcher })).resolves.toBe(validOwt)
  })

  test('sends Anthropic Messages requests and extracts content blocks', async () => {
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages')
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('stream', true)
      expect(body).toHaveProperty('system')
      expect(body).toHaveProperty('max_tokens', 6144)
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
      expect(body).toHaveProperty('options.num_predict', 6144)
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
      expect(body).toHaveProperty('max_tokens', 7168)
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
      expect(body).toHaveProperty('max_tokens', 6144)
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
      expect(body).toHaveProperty('max_tokens', 6144)
      return streamResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'Thinking through the score...' } }] }),
        JSON.stringify({ choices: [{ delta: { content: validOwt } }] }),
      ])
    }) as typeof fetch
    const reasoning: string[] = []
    await expect(createOwtWithAi({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', thinkingMode: 'enabled' }, request, { fetcher, onReasoningUpdate: (text) => reasoning.push(text) })).resolves.toBe(validOwt)
    expect(reasoning).toEqual(['Thinking through the score...'])
  })

  test('requests and reports DeepSeek streaming usage', async () => {
    const encoder = new TextEncoder()
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('stream_options.include_usage', true)
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: validOwt } }], usage: null })}\n\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 250, completion_tokens_details: { reasoning_tokens: 90 }, total_tokens: 1250 } })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const usages: unknown[] = []
    await expect(createOwtWithAi({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }, request, { fetcher, onUsage: (value) => usages.push(value) })).resolves.toBe(validOwt)
    expect(usages).toEqual([{ inputTokens: 1000, cachedInputTokens: 800, cacheWriteInputTokens: 0, outputTokens: 250, reasoningTokens: 90, totalTokens: 1250 }])
  })

  test('reports usage from a completed OpenAI Responses stream', async () => {
    const encoder = new TextEncoder()
    const fetcher = (async (_input: URL | RequestInfo) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: validOwt })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 90, input_tokens_details: { cached_tokens: 30 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8 }, total_tokens: 110 } } })}\n\n`))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const usages: unknown[] = []
    await createOwtWithAi({ baseUrl: 'https://api.openai.com', model: 'gpt-test' }, request, { fetcher, onUsage: (value) => usages.push(value) })
    expect(usages).toEqual([{ inputTokens: 90, cachedInputTokens: 30, cacheWriteInputTokens: 0, outputTokens: 20, reasoningTokens: 8, totalTokens: 110 }])
  })

  test('merges split Anthropic stream usage without double-counting', async () => {
    const encoder = new TextEncoder()
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 50, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: validOwt } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } },
    ]
    const fetcher = (async (_input: URL | RequestInfo) => new Response(new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const usages: unknown[] = []
    await createOwtWithAi({ baseUrl: 'https://api.anthropic.com', model: 'claude-test' }, request, { fetcher, onUsage: (value) => usages.push(value) })
    expect(usages).toEqual([{ inputTokens: 100, cachedInputTokens: 30, cacheWriteInputTokens: 20, outputTokens: 25, reasoningTokens: 0, totalTokens: 125 }])
  })

  test('reports native Ollama counts from its final NDJSON object', async () => {
    const encoder = new TextEncoder()
    const fetcher = (async (_input: URL | RequestInfo) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content: validOwt }, done: false })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 70, eval_count: 18 })}\n`))
        controller.close()
      },
    }), { headers: { 'content-type': 'application/x-ndjson' } })) as typeof fetch
    const usages: unknown[] = []
    await createOwtWithAi({ baseUrl: 'http://localhost:11434', model: 'qwen-test' }, request, { fetcher, onUsage: (value) => usages.push(value) })
    expect(usages).toEqual([{ inputTokens: 70, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 18, reasoningTokens: 0, totalTokens: 88 }])
  })

  test('reports when a reasoning-only stream hits the combined token limit', async () => {
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
      expect(body).toHaveProperty('stream', true)
      return streamResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'Thinking through the score...' } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }),
      ])
    }) as typeof fetch
    await expect(createOwtWithAi({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', thinkingMode: 'enabled' }, request, { fetcher })).rejects.toThrow('combined reasoning/output token limit reached')
  })

  test('does not add a reasoning allowance when thinking is explicitly disabled', async () => {
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toHaveProperty('max_output_tokens', 4096)
      expect(body).toHaveProperty('reasoning.effort', 'none')
      return Response.json({ output_text: validOwt })
    }) as typeof fetch
    await expect(createOwtWithAi({
      baseUrl: 'https://api.openai.com',
      model: 'gpt-test',
      thinkingMode: 'disabled',
      maxTokens: 4096,
      thinkingBudgetTokens: 8192,
    }, request, { fetcher })).resolves.toBe(validOwt)
  })
})

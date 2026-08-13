export type AiProtocol = 'auto' | 'openai-responses' | 'openai-chat-completions' | 'openai-completions' | 'anthropic-messages' | 'ollama-native'

export type AiProviderHint = 'openai' | 'anthropic' | 'ollama' | 'llama.cpp' | 'openrouter' | 'compatible'

export interface AiConnectionConfig {
  baseUrl: string
  apiKey?: string
  protocol?: AiProtocol
}

export interface AiModelInfo {
  id: string
  name: string
  provider?: string
  contextLength?: number
  inputModalities?: string[]
}

export interface AiModelDiscovery {
  provider: AiProviderHint
  protocol: Exclude<AiProtocol, 'auto'>
  models: AiModelInfo[]
}

export interface AiProviderTransportOptions {
  fetcher?: typeof fetch
  proxyUrl?: string
  signal?: AbortSignal
}

export interface AiProviderRequest {
  endpoint: string
  method?: 'GET' | 'POST'
  headers: Record<string, string>
  body?: unknown
  apiKey?: string
}

const REQUEST_SUFFIXES = [
  '/v1/chat/completions', '/v1/completions', '/v1/responses', '/v1/messages',
  '/api/v1/chat/completions', '/api/v1/responses', '/api/chat', '/api/generate', '/api/tags',
] as const

function requiredBaseUrl(baseUrl: string): URL {
  const value = baseUrl.trim()
  if (!value) throw new Error('AI base URL is required')
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`
  const url = new URL(withProtocol)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

export function aiProviderHint(baseUrl: string): AiProviderHint {
  const url = requiredBaseUrl(baseUrl)
  const host = url.hostname.toLowerCase()
  if (host === 'api.openai.com') return 'openai'
  if (host === 'api.anthropic.com') return 'anthropic'
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter'
  if (url.port === '8080') return 'llama.cpp'
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    if (url.port === '11434' || url.pathname.startsWith('/api')) return 'ollama'
  }
  return 'compatible'
}

function apiRoot(baseUrl: string, provider = aiProviderHint(baseUrl)): URL {
  const url = requiredBaseUrl(baseUrl)
  for (const suffix of REQUEST_SUFFIXES) {
    if (url.pathname.endsWith(suffix)) {
      const prefix = url.pathname.slice(0, -suffix.length)
      url.pathname = suffix.startsWith('/v1/') ? `${prefix}/v1` : suffix.startsWith('/api/v1/') ? `${prefix}/api/v1` : prefix
      break
    }
  }
  if (provider === 'openrouter') {
    if (url.pathname === '' || url.pathname === '/') url.pathname = '/api/v1'
    else if (!url.pathname.endsWith('/api/v1')) url.pathname = url.pathname.replace(/\/v1$/, '/api/v1')
  } else if (provider !== 'ollama' && !url.pathname.endsWith('/v1')) {
    url.pathname = `${url.pathname}/v1`.replace(/\/+/g, '/')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function appendPath(root: URL, path: string): string {
  const url = new URL(root)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
  return url.toString()
}

export function resolvedAiProtocol(config: AiConnectionConfig): Exclude<AiProtocol, 'auto'> {
  if (config.protocol && config.protocol !== 'auto') return config.protocol
  switch (aiProviderHint(config.baseUrl)) {
    case 'openai': return 'openai-responses'
    case 'anthropic': return 'anthropic-messages'
    case 'ollama': return 'ollama-native'
    case 'openrouter':
    case 'llama.cpp':
    case 'compatible': return 'openai-chat-completions'
  }
}

export function aiRequestEndpoint(config: AiConnectionConfig, protocol = resolvedAiProtocol(config)): string {
  const provider = aiProviderHint(config.baseUrl)
  const root = apiRoot(config.baseUrl, provider)
  switch (protocol) {
    case 'openai-responses': return appendPath(root, 'responses')
    case 'openai-chat-completions': return appendPath(root, 'chat/completions')
    case 'openai-completions': return appendPath(root, 'completions')
    case 'anthropic-messages': return appendPath(root, 'messages')
    case 'ollama-native': {
      const nativeRoot = requiredBaseUrl(config.baseUrl)
      if (nativeRoot.pathname.endsWith('/api')) return appendPath(nativeRoot, 'chat')
      nativeRoot.pathname = nativeRoot.pathname.replace(/\/v1$/, '')
      return appendPath(nativeRoot, 'api/chat')
    }
  }
}

export function aiRequestHeaders(config: AiConnectionConfig, protocol = resolvedAiProtocol(config)): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01'
    if (config.apiKey) headers['x-api-key'] = config.apiKey
  } else if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`
  }
  return headers
}

export async function sendAiProviderRequest(request: AiProviderRequest, options: AiProviderTransportOptions = {}): Promise<Response> {
  const fetcher = options.fetcher ?? fetch
  if (options.proxyUrl) {
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !['authorization', 'x-api-key'].includes(name.toLowerCase())))
    return fetcher(options.proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, headers, apiKey: request.apiKey }),
      signal: options.signal,
    })
  }
  return fetcher(request.endpoint, {
    method: request.method ?? 'POST',
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: options.signal,
  })
}

export function extractAiResponseText(protocol: Exclude<AiProtocol, 'auto'>, payload: Record<string, unknown>): string {
  let content: unknown
  if (protocol === 'openai-responses') {
    content = payload.output_text
    if (!content && Array.isArray(payload.output)) {
      content = payload.output.flatMap((item) => item && typeof item === 'object' && Array.isArray((item as { content?: unknown }).content)
        ? (item as { content: Array<{ text?: unknown }> }).content.map((part) => part.text)
        : []).find((text) => typeof text === 'string')
    }
  } else if (protocol === 'openai-completions') {
    content = (payload.choices as Array<{ text?: unknown }> | undefined)?.[0]?.text
  } else if (protocol === 'anthropic-messages') {
    content = (payload.content as Array<{ type?: unknown; text?: unknown }> | undefined)?.find((part) => part.type === 'text')?.text
  } else if (protocol === 'ollama-native') {
    content = (payload.message as { content?: unknown } | undefined)?.content
  } else {
    content = (payload.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content
  }
  if (typeof content !== 'string' || !content) throw new Error('AI endpoint returned no message content')
  return content
}

function extractAiStreamDelta(protocol: Exclude<AiProtocol, 'auto'>, payload: Record<string, unknown>): string {
  if (protocol === 'openai-responses') return typeof payload.delta === 'string' ? payload.delta : ''
  if (protocol === 'anthropic-messages') {
    const delta = payload.delta as { text?: unknown } | undefined
    return typeof delta?.text === 'string' ? delta.text : ''
  }
  if (protocol === 'ollama-native') {
    const message = payload.message as { content?: unknown } | undefined
    return typeof message?.content === 'string' ? message.content : typeof payload.response === 'string' ? payload.response : ''
  }
  const choice = (payload.choices as Array<{ delta?: { content?: unknown }; text?: unknown }> | undefined)?.[0]
  return typeof choice?.delta?.content === 'string' ? choice.delta.content : typeof choice?.text === 'string' ? choice.text : ''
}

export async function readAiTextResponse(
  response: Response,
  protocol: Exclude<AiProtocol, 'auto'>,
  onUpdate?: (text: string) => void,
): Promise<string> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`AI request failed (${response.status}): ${detail.slice(0, 500)}`)
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!response.body || (contentType.includes('application/json') && !contentType.includes('ndjson'))) {
    const raw = await response.text()
    let payload: Record<string, unknown>
    try { payload = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error('AI endpoint returned a non-streaming, non-JSON response') }
    const text = extractAiResponseText(protocol, payload)
    onUpdate?.(text)
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let text = ''
  let finalPayload: Record<string, unknown> | undefined
  const consume = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('event:') || trimmed.startsWith(':')) return
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!data || data === '[DONE]') return
    let payload: Record<string, unknown>
    try { payload = JSON.parse(data) as Record<string, unknown> } catch { return }
    const delta = extractAiStreamDelta(protocol, payload)
    if (delta) {
      text += delta
      onUpdate?.(text)
    } else {
      finalPayload = payload
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) consume(line)
    if (done) break
  }
  if (pending.trim()) consume(pending)
  if (!text && finalPayload) {
    text = extractAiResponseText(protocol, finalPayload)
    onUpdate?.(text)
  }
  if (!text) throw new Error('AI stream returned no message content')
  return text
}

function parseOpenAiModels(value: unknown): AiModelInfo[] {
  if (!value || typeof value !== 'object') return []
  const body = value as { data?: unknown; models?: unknown }
  const data = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  return data.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const model = item as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id : typeof model.model === 'string' ? model.model : typeof model.name === 'string' ? model.name : undefined
    if (!id) return []
    const architecture = model.architecture && typeof model.architecture === 'object' ? model.architecture as Record<string, unknown> : undefined
    const capabilities = Array.isArray(model.capabilities) ? model.capabilities.filter((value): value is string => typeof value === 'string') : undefined
    return [{
      id,
      name: typeof model.name === 'string' ? model.name : typeof model.display_name === 'string' ? model.display_name : id,
      provider: typeof model.owned_by === 'string' ? model.owned_by : undefined,
      contextLength: typeof model.context_length === 'number' ? model.context_length : undefined,
      inputModalities: Array.isArray(architecture?.input_modalities) ? architecture.input_modalities.filter((value): value is string => typeof value === 'string') : capabilities,
    }]
  })
}

function parseOllamaModels(value: unknown): AiModelInfo[] {
  if (!value || typeof value !== 'object') return []
  const models = (value as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const model = item as Record<string, unknown>
    const id = typeof model.model === 'string' ? model.model : typeof model.name === 'string' ? model.name : undefined
    if (!id) return []
    const details = model.details && typeof model.details === 'object' ? model.details as Record<string, unknown> : undefined
    return [{ id, name: id, provider: typeof details?.family === 'string' ? details.family : 'ollama' }]
  })
}

async function discoverAt(config: AiConnectionConfig, endpoint: string, protocol: Exclude<AiProtocol, 'auto'>, provider: AiProviderHint, parser: (value: unknown) => AiModelInfo[], options: AiProviderTransportOptions): Promise<AiModelDiscovery | null> {
  const headers = aiRequestHeaders(config, protocol)
  delete headers['content-type']
  const response = await sendAiProviderRequest({ endpoint, method: 'GET', headers, apiKey: config.apiKey }, options)
  if (!response.ok) return null
  let value: unknown
  try { value = await response.json() } catch { return null }
  const models = parser(value)
  return models.length > 0 ? { provider, protocol, models } : null
}

export async function discoverAiModels(config: AiConnectionConfig, options: AiProviderTransportOptions = {}): Promise<AiModelDiscovery> {
  const provider = aiProviderHint(config.baseUrl)
  const protocol = resolvedAiProtocol(config)
  const root = apiRoot(config.baseUrl, provider)
  const candidates: Array<() => Promise<AiModelDiscovery | null>> = []
  if (provider === 'ollama') {
    const nativeRoot = requiredBaseUrl(config.baseUrl)
    nativeRoot.pathname = nativeRoot.pathname.replace(/\/(?:api|v1)$/, '')
    candidates.push(() => discoverAt(config, appendPath(nativeRoot, 'api/tags'), 'ollama-native', 'ollama', parseOllamaModels, options))
  } else {
    const nativeRoot = requiredBaseUrl(config.baseUrl)
    nativeRoot.pathname = nativeRoot.pathname.replace(/\/v1$/, '')
    const endpoints = [...new Set(provider === 'llama.cpp'
      ? [appendPath(nativeRoot, 'models'), appendPath(root, 'models')]
      : [appendPath(root, 'models'), appendPath(nativeRoot, 'models')])]
    for (const endpoint of endpoints) candidates.push(() => discoverAt(config, endpoint, protocol, provider, parseOpenAiModels, options))
  }
  for (const candidate of candidates) {
    try {
      const result = await candidate()
      if (result) return result
    } catch {
      // Continue to the next compatible read-only discovery endpoint.
    }
  }
  throw new Error('No compatible model list was found at this URL')
}

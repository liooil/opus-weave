const MAX_AI_REQUEST_BYTES = 24 * 1024 * 1024

interface AiProxyRequest {
  endpoint?: unknown
  apiKey?: unknown
  body?: unknown
}

export async function proxyAiChat(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_AI_REQUEST_BYTES) return Response.json({ error: 'AI request is too large' }, { status: 413 })

  let input: AiProxyRequest
  try {
    input = await request.json() as AiProxyRequest
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 })
  }
  if (typeof input.endpoint !== 'string' || !input.body || typeof input.body !== 'object') {
    return Response.json({ error: 'endpoint and body are required' }, { status: 400 })
  }

  let endpoint: URL
  try {
    endpoint = new URL(input.endpoint)
  } catch {
    return Response.json({ error: 'Invalid AI endpoint URL' }, { status: 400 })
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    return Response.json({ error: 'AI endpoint must be an HTTP(S) URL without embedded credentials' }, { status: 400 })
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (typeof input.apiKey === 'string' && input.apiKey) headers.authorization = `Bearer ${input.apiKey}`
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(180_000),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 })
  }
}

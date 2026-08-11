import { parseOwt } from '../owt/parser.ts'

export interface OwtAiConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

export interface OwtAiAttachment {
  mimeType: string
  dataUrl: string
  label: string
}

export type OwtAiTask = 'prompt' | 'score-media' | 'improvise'

export interface OwtAiRequest {
  task: OwtAiTask
  instruction: string
  currentOwt: string
  attachments?: readonly OwtAiAttachment[]
}

export interface OwtAiTransportOptions {
  fetcher?: typeof fetch
  proxyUrl?: string
  signal?: AbortSignal
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

interface ChatBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  max_tokens: number
  stream: false
  response_format?: {
    type: 'json_schema'
    json_schema: { name: string; strict: true; schema: Record<string, unknown> }
  }
}

export const DEFAULT_OWT_AI_CONFIG: OwtAiConfig = {
  baseUrl: 'http://192.168.6.130:8080',
  model: 'gemma4-vl-long',
  temperature: 0.35,
  maxTokens: 4096,
}

const SYSTEM_PROMPT = `You are OpusWeave's score editor. Return one complete, valid OpusWeave Text 0.1 Score and nothing else.
Syntax rules:
- Begin with: owt 0.1 score
- End with: end
- Include title, ppq 480, meter, tempo, key, and at least one track.
- Use 4/4 unless the source clearly requires another meter.
- In 4/4, every bar must total exactly 4 quarter-note units. Safe bar patterns include four notes of :1, eight notes of :1/2, two events of :2, or one event/chord of :4.
- Do not use pickup measures. Do not put more or less than 4 quarter-note units between a pair of | characters.
- Notes look like C4:1, F#4:1/2, R:1 or [C4 E4 G4]:2. A duration belongs to each note, rest, or chord.
- Channels are 1-16, program and velocity are 0-127.
- Prefer 8 concise measures. Use one Melody track; if adding Harmony, give it exactly one :4 chord per measure and the same measure count as Melody.
- Preserve useful material from the current OWT when editing or improvising.
- If the user names a copyrighted modern work, create an original piece evoking its requested mood; do not reproduce a long recognizable transcription.
No Markdown fences, explanations, analysis, or prose outside the OWT document.`

function chatEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('AI base URL is required')
  return normalized.endsWith('/v1/chat/completions') ? normalized : `${normalized}/v1/chat/completions`
}

function taskInstruction(request: OwtAiRequest): string {
  switch (request.task) {
    case 'prompt':
      return `Edit the current OWT according to this request: ${request.instruction}`
    case 'score-media':
      return `Read the attached score image or sampled video frames. Transcribe the visible music into OWT. ${request.instruction}`
    case 'improvise':
      return `Continue the supplied performance as a musical call-and-response. Keep its motif recognizable, add a coherent answer, and return the complete combined OWT. ${request.instruction}`
  }
}

export function buildOwtAiMessages(request: OwtAiRequest): ChatMessage[] {
  const text = `${taskInstruction(request)}\n\nCURRENT OWT:\n${request.currentOwt}`
  const attachments = request.attachments ?? []
  const content: ChatMessage['content'] = attachments.length === 0
    ? text
    : [
        { type: 'text', text },
        ...attachments.map((attachment) => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl } })),
      ]
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }]
}

export function extractOwtFromAiResponse(content: string): string {
  const unfenced = content.replace(/^```(?:owt|text)?\s*/i, '').replace(/\s*```\s*$/i, '')
  const start = unfenced.indexOf('owt 0.1 score')
  if (start < 0) throw new Error('AI response did not contain an OWT score')
  const candidate = unfenced.slice(start)
  const endMatch = /(?:^|\n)end\s*(?:\n|$)/g
  let match: RegExpExecArray | null
  let end = -1
  while ((match = endMatch.exec(candidate))) end = match.index + match[0].length
  if (end < 0) throw new Error('AI response did not terminate the OWT score')
  const text = `${candidate.slice(0, end).trim()}\n`
  const parsed = parseOwt(text)
  if (!parsed.document) {
    const summary = parsed.diagnostics.slice(0, 6).map((diagnostic) => `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`).join('; ')
    throw new Error(`AI returned invalid OWT: ${summary}`)
  }
  return text
}

async function postChat(config: OwtAiConfig, body: ChatBody, options: OwtAiTransportOptions): Promise<string> {
  const fetcher = options.fetcher ?? fetch
  const endpoint = chatEndpoint(config.baseUrl)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
  const response = options.proxyUrl
    ? await fetcher(options.proxyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, apiKey: config.apiKey, body }),
        signal: options.signal,
      })
    : await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal })
  const raw = await response.text()
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${raw.slice(0, 500)}`)
  let parsed: { choices?: Array<{ message?: { content?: string } }> }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('AI endpoint returned non-JSON content')
  }
  const content = parsed.choices?.[0]?.message?.content
  if (!content) throw new Error('AI endpoint returned no message content')
  return content
}

function midiNoteName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}

async function structuredScoreFallback(config: OwtAiConfig, request: OwtAiRequest, options: OwtAiTransportOptions): Promise<string> {
  const messages = buildOwtAiMessages(request)
  messages.push({ role: 'user', content: 'Return the music as strict JSON instead. Supply 4-16 bars; every bar must contain exactly eight MIDI pitches (0-127) or -1 for a rest. These become eighth notes in 4/4.' })
  const body: ChatBody = {
    model: config.model.trim(),
    messages,
    temperature: 0.2,
    max_tokens: 2048,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'opusweave_safe_score',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            tempo: { type: 'integer', minimum: 40, maximum: 220 },
            bars: {
              type: 'array', minItems: 4, maxItems: 16,
              items: { type: 'array', minItems: 8, maxItems: 8, items: { type: 'integer', minimum: -1, maximum: 127 } },
            },
          },
          required: ['title', 'tempo', 'bars'],
          additionalProperties: false,
        },
      },
    },
  }
  const content = await postChat(config, body, options)
  let score: { title?: unknown; tempo?: unknown; bars?: unknown }
  try {
    score = JSON.parse(content) as typeof score
  } catch {
    throw new Error('AI structured fallback returned invalid JSON')
  }
  if (typeof score.title !== 'string' || !Number.isInteger(score.tempo) || !Array.isArray(score.bars) || score.bars.length < 4 || score.bars.length > 16) {
    throw new Error('AI structured fallback did not match the score schema')
  }
  const bars = score.bars.map((bar) => {
    if (!Array.isArray(bar) || bar.length !== 8 || bar.some((note) => !Number.isInteger(note) || note < -1 || note > 127)) {
      throw new Error('AI structured fallback contained an invalid measure')
    }
    return `| ${bar.map((note) => note === -1 ? 'R:1/2' : `${midiNoteName(note)}:1/2`).join(' ')} |`
  })
  const title = score.title.replace(/["\\]/g, '').slice(0, 80) || 'AI Composition'
  return `owt 0.1 score\n\ntitle "${title}"\nppq 480\nmeter 1:1 4/4\ntempo 1:1 ${score.tempo}\nkey 1:1 C major\n\ntrack "Melody" channel=1 program=0 velocity=88\n${bars.join('\n')}\nend\n`
}

export async function createOwtWithAi(config: OwtAiConfig, request: OwtAiRequest, options: OwtAiTransportOptions = {}): Promise<string> {
  const messages = buildOwtAiMessages(request)
  const body: ChatBody = {
    model: config.model.trim(),
    messages,
    temperature: config.temperature ?? 0.35,
    max_tokens: config.maxTokens ?? 4096,
    stream: false,
  }
  if (!body.model) throw new Error('AI model is required')
  let content = await postChat(config, body, options)
  let validationError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return extractOwtFromAiResponse(content)
    } catch (error) {
      validationError = error
      if (attempt === 3) break
      body.messages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user', content: `Repair every validation error. Recount every measure so each 4/4 bar totals exactly 4. Return the complete corrected OWT only. Validation error: ${error instanceof Error ? error.message : String(error)}` },
      ]
      content = await postChat(config, body, options)
    }
  }
  try {
    return extractOwtFromAiResponse(await structuredScoreFallback(config, request, options))
  } catch (fallbackError) {
    throw new Error(`${validationError instanceof Error ? validationError.message : String(validationError)}; structured fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
  }
}

export async function testOwtAiConnection(config: OwtAiConfig, options: OwtAiTransportOptions = {}): Promise<string> {
  const body: ChatBody = {
    model: config.model.trim(),
    messages: [{ role: 'user', content: 'Reply with exactly OPUSWEAVE_AI_OK' }],
    temperature: 0,
    max_tokens: 24,
    stream: false,
  }
  return postChat(config, body, options)
}

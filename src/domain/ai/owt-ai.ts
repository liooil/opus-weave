import { parseOwt } from '../owt/parser.ts'
import { aiRequestEndpoint, aiRequestHeaders, resolvedAiProtocol, sendAiProviderRequest, type AiProtocol } from './providers.ts'

export interface OwtAiPromptTemplates {
  system: string
  prompt: string
  scoreMedia: string
  improvise: string
}

export interface OwtAiConfig {
  baseUrl: string
  model: string
  protocol?: AiProtocol
  apiKey?: string
  temperature?: number
  maxTokens?: number
  promptTemplates?: Partial<OwtAiPromptTemplates>
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
export const DEFAULT_OWT_AI_PROMPT_TEMPLATES: OwtAiPromptTemplates = {
  system: `You are OpusWeave's score editor. Return one complete, valid OpusWeave Text 0.1 Score and nothing else.
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
No Markdown fences, explanations, analysis, or prose outside the OWT document.`,
  prompt: 'Edit the current OWT according to this request: {instruction}',
  scoreMedia: 'Read the attached score image or sampled video frames. Transcribe the visible music into OWT. {instruction}',
  improvise: 'Continue the supplied performance as a musical call-and-response. Keep its motif recognizable, add a coherent answer, and return the complete combined OWT. {instruction}',
}


export const DEFAULT_OWT_AI_CONFIG: OwtAiConfig = {
  baseUrl: '',
  model: '',
  temperature: 0.35,
  maxTokens: 4096,
}

export function hasConfiguredAiApi(config: Pick<OwtAiConfig, 'baseUrl' | 'model'>): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0
}

export function buildManualOwtPrompt(currentOwt: string, locale: 'en' | 'zh-CN' = 'en'): string {
  const score = currentOwt.trim() || 'owt 0.1 score\n\ntitle "New Melody"\nppq 480\nmeter 1:1 4/4\ntempo 1:1 120\nkey 1:1 C major\n\ntrack "Melody" channel=1 program=0 velocity=88\n| C4:1 D4:1 E4:1 F4:1 |\nend'
  if (locale === 'zh-CN') {
    return `你是 OpusWeave 的 OWT 0.1 乐谱编辑助手。请与我讨论创作意图；信息不足时可以先提问。需要给出最终结果时，只输出一份完整、有效的 OWT 文档，不要使用 Markdown 代码围栏，也不要附加解释。

创作要求：
（请在这里写下希望创作或修改的内容；也可以先把这段提示词发给 AI，再继续对话。）

OWT 约束：
- 第一行必须是 owt 0.1 score，最后一行必须是 end。
- 必须包含 title、ppq 480、meter、tempo、key 和至少一个 track。
- 音符格式如 C4:1、F#4:1/2、R:1、[C4 E4 G4]:2。
- 4/4 拍的每一小节时值总和必须恰好为 4，不要生成不完整小节。
- channel 为 1–16；program 和 velocity 为 0–127。
- 修改时保留当前乐谱中未被要求更改的内容。

当前 OWT：
${score}`
  }
  return `You are an OpusWeave OWT 0.1 score-editing assistant. Discuss the creative intent with me and ask clarifying questions when needed. When a final result is requested, output exactly one complete, valid OWT document without Markdown fences or additional explanation.

CREATIVE REQUEST:
(Write what you want to create or change here, or send this prompt first and continue the conversation with the AI.)

OWT REQUIREMENTS:
- The first line must be owt 0.1 score and the last line must be end.
- Include title, ppq 480, meter, tempo, key and at least one track.
- Events look like C4:1, F#4:1/2, R:1 or [C4 E4 G4]:2.
- Every 4/4 measure must total exactly 4 quarter-note units; do not create incomplete measures.
- channel is 1–16; program and velocity are 0–127.
- When editing, preserve current-score material that the request does not change.

CURRENT OWT:
${score}`
}

function promptTemplates(config?: OwtAiConfig): OwtAiPromptTemplates {
  return { ...DEFAULT_OWT_AI_PROMPT_TEMPLATES, ...config?.promptTemplates }
}

function chatEndpoint(config: OwtAiConfig): string {
  return aiRequestEndpoint(config)
}

function taskInstruction(request: OwtAiRequest, templates: OwtAiPromptTemplates): string {
  const template = request.task === 'score-media' ? templates.scoreMedia : templates[request.task]
  return template.replaceAll('{instruction}', request.instruction)
}

export function buildOwtAiMessages(request: OwtAiRequest, config?: OwtAiConfig): ChatMessage[] {
  const templates = promptTemplates(config)
  const text = `${taskInstruction(request, templates)}\n\nCURRENT OWT:\n${request.currentOwt}`
  const attachments = request.attachments ?? []
  const content: ChatMessage['content'] = attachments.length === 0
    ? text
    : [
        { type: 'text', text },
        ...attachments.map((attachment) => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl } })),
      ]
  return [{ role: 'system', content: templates.system }, { role: 'user', content }]
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
  const protocol = resolvedAiProtocol(config)
  const endpoint = chatEndpoint(config)
  const messages = body.messages
  const system = messages.find((message) => message.role === 'system')
  const conversation = messages.filter((message) => message.role !== 'system')
  const userPrompt = conversation.map((message) => typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : `[image: ${part.image_url.url}]`).join('\n')).join('\n\n')
  let requestBody: unknown = body
  if (protocol === 'openai-responses') {
    requestBody = {
      model: body.model,
      instructions: typeof system?.content === 'string' ? system.content : undefined,
      input: conversation.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : message.content.map((part) => part.type === 'text'
            ? { type: 'input_text', text: part.text }
            : { type: 'input_image', image_url: part.image_url.url }),
      })),
      temperature: body.temperature,
      max_output_tokens: body.max_tokens,
      stream: false,
      text: body.response_format ? { format: { type: 'json_schema', ...body.response_format.json_schema } } : undefined,
    }
  } else if (protocol === 'openai-completions') {
    requestBody = { model: body.model, prompt: `${typeof system?.content === 'string' ? `${system.content}\n\n` : ''}${userPrompt}`, temperature: body.temperature, max_tokens: body.max_tokens, stream: false }
  } else if (protocol === 'anthropic-messages') {
    requestBody = {
      model: body.model,
      system: typeof system?.content === 'string' ? system.content : undefined,
      messages: conversation.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : message.content.map((part) => part.type === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'image', source: { type: 'base64', media_type: /^data:([^;]+);base64,/.exec(part.image_url.url)?.[1] ?? 'image/png', data: part.image_url.url.replace(/^data:[^;]+;base64,/, '') } }),
      })),
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: false,
    }
  } else if (protocol === 'ollama-native') {
    requestBody = {
      model: body.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => 'text' in part ? part.text : '').join('\n'),
        images: typeof message.content === 'string' ? undefined : message.content.filter((part) => part.type === 'image_url').map((part) => 'image_url' in part ? part.image_url.url.replace(/^data:[^;]+;base64,/, '') : ''),
      })),
      options: { temperature: body.temperature, num_predict: body.max_tokens },
      format: body.response_format?.json_schema.schema,
      stream: false,
    }
  }
  const response = await sendAiProviderRequest({
    endpoint,
    headers: aiRequestHeaders(config, protocol),
    body: requestBody,
    apiKey: config.apiKey,
  }, options)
  const raw = await response.text()
  if (!response.ok) throw new Error(`AI request failed (${response.status}): ${raw.slice(0, 500)}`)
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { throw new Error('AI endpoint returned non-JSON content') }
  let content: unknown
  if (protocol === 'openai-responses') {
    content = parsed.output_text
    if (!content && Array.isArray(parsed.output)) {
      content = parsed.output.flatMap((item) => item && typeof item === 'object' && Array.isArray((item as { content?: unknown }).content) ? (item as { content: Array<{ text?: unknown }> }).content.map((part) => part.text) : []).find((text) => typeof text === 'string')
    }
  } else if (protocol === 'openai-completions') {
    content = (parsed.choices as Array<{ text?: unknown }> | undefined)?.[0]?.text
  } else if (protocol === 'anthropic-messages') {
    content = (parsed.content as Array<{ type?: unknown; text?: unknown }> | undefined)?.find((part) => part.type === 'text')?.text
  } else if (protocol === 'ollama-native') {
    content = (parsed.message as { content?: unknown } | undefined)?.content
  } else {
    content = (parsed.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content
  }
  if (typeof content !== 'string' || !content) throw new Error('AI endpoint returned no message content')
  return content
}

function midiNoteName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}

async function structuredScoreFallback(config: OwtAiConfig, request: OwtAiRequest, options: OwtAiTransportOptions): Promise<string> {
  const messages = buildOwtAiMessages(request, config)
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
  const messages = buildOwtAiMessages(request, config)
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

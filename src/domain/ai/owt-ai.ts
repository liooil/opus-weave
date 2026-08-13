import { parseOwt } from '../owt/parser.ts'
import { buildOwt01Reference } from '../owt/reference.ts'
import { aiRequestEndpoint, aiRequestHeaders, readAiTextResponse, resolvedAiProtocol, sendAiProviderRequest, type AiProtocol } from './providers.ts'

export interface OwtAiPromptTemplates {
  system: string
  prompt: string
  scoreMedia: string
  improvise: string
}

export type AiThinkingMode = 'adaptive' | 'enabled' | 'disabled'
export type AiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface OwtAiConfig {
  baseUrl: string
  model: string
  protocol?: AiProtocol
  apiKey?: string
  temperature?: number
  topP?: number
  maxTokens?: number
  thinkingMode?: AiThinkingMode
  reasoningEffort?: AiReasoningEffort
  thinkingBudgetTokens?: number
  promptTemplates?: Partial<OwtAiPromptTemplates>
  locale?: 'en' | 'zh-CN'
  retryCount?: number
  autoRepair?: boolean
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
  onUpdate?: (text: string) => void
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

interface ChatBody {
  model: string
  messages: ChatMessage[]
  temperature?: number
  top_p?: number
  max_tokens: number
  stream: true
}
export function defaultOwtAiPromptTemplates(locale: 'en' | 'zh-CN' = 'en'): OwtAiPromptTemplates {
  if (locale === 'zh-CN') {
    return {
      system: `你是 OpusWeave 的 OWT 0.1 乐谱生成器。输出会直接送入严格解析器。

权威 OWT 0.1 格式与解析语义：
{owtReference}

生成行为：
1. 只输出一份完整 OWT 文档；不要使用 Markdown 围栏、前言、解释、尾注或检查过程。
2. 修改或续写时输出完整替换文档，不要输出补丁或仅输出新增片段。现有无效 OWT 只能作为音乐素材，不得保留其语法错误。
3. 严格采用参考中定义的语法。优先使用简单、明确的写法，不要发明未支持的记谱。
4. 默认使用一行一个成对小节“| ... |”。每个小节必须独立计算事件时值之和，并严格等于当前拍号的小节长度：numerator*4/denominator（4/4=4，3/4=3，6/8=3）。右侧小节线之前若不足，必须加入休止符；绝不在不完整小节后输出小节线。输出前逐小节重新求和，并确认每条轨道结束在完整小节边界。
5. 多轨默认分配不同 MIDI channel，避免同一 channel 使用冲突的 program。
6. 若用户要求复制仍受版权保护的现代作品，应创作情绪或风格相近的原创音乐，而不是生成可辨识的长篇转录。`,
      prompt: `任务：根据用户要求创作或修改一份完整 OWT 乐谱。

用户要求：
{instruction}

当前 OWT（可作为素材；若为空或无效则重新构建合法文档）：
{currentOwt}

先在内部规划调号、拍号、速度、轨道和完整小节数。对于 4/4，每条轨道先复制下面的节奏骨架，再只替换音高；需要更多小节就继续复制同一行，不得修改任何 :1：
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
对于 3/4 或 6/8，每行写三个 :1 事件。轨道事件中不得输出分数时值或 :2、:3、:4。逐行数清事件后，最后只输出完整 OWT。`,
      scoreMedia: `任务：读取附带的乐谱图像或视频采样帧，把可见音乐转写为一份完整、可播放的 OWT 乐谱。

用户补充要求：
{instruction}

当前 OWT（仅在用户要求编辑时作为素材）：
{currentOwt}

无法确定的细节应采用保守、合法的记谱，不要发明 OWT 未支持的符号。每个小节独立求和，只有总时值严格等于当前拍号的小节长度时才闭合右侧小节线；不足使用休止符补齐。只输出最终的完整 OWT。`,
      improvise: `任务：把当前演奏继续成连贯的音乐问答，保留可辨识的动机，加入合乎调性与节拍的回答，并返回合并后的完整 OWT。

用户补充要求：
{instruction}

当前 OWT：
{currentOwt}

不得只输出新增片段。保持原有拍号；每个小节独立求和，严格补足所有轨道后才能写右侧小节线，并只输出最终的完整 OWT。`,
    }
  }
  return {
    system: `You are OpusWeave's OWT 0.1 score generator. Output is sent directly to a strict parser.

Authoritative OWT 0.1 format and parser semantics:
{owtReference}

GENERATION BEHAVIOR:
1. Return one complete OWT document only. No Markdown fence, preface, explanation, trailing note, or visible verification.
2. When editing or continuing, return the complete replacement document—not a patch or only the new fragment. Treat invalid current OWT as musical material only; do not preserve its syntax errors.
3. Use only syntax defined by the reference. Prefer simple, explicit forms and never invent unsupported notation.
4. Use one paired | ... | measure per line by default. Independently sum the event durations in every measure and require the exact active-meter length: numerator*4/denominator (4/4=4, 3/4=3, 6/8=3). Before a closing bar line, add a rest when short; never emit a bar line after an incomplete measure. Before answering, recompute every measure and confirm every track ends on a complete boundary.
5. Use distinct MIDI channels for multiple tracks by default and avoid conflicting programs on one channel.
6. If asked to copy a copyrighted modern work, create original music with a similar mood or style rather than a recognizable extended transcription.`,
    prompt: `TASK: Create or edit one complete OWT score according to the user's request.

USER REQUEST:
{instruction}

CURRENT OWT (use as material; rebuild it if empty or invalid):
{currentOwt}

Silently plan the key, meter, tempo, tracks, and complete measure count. For 4/4, first copy this rhythmic skeleton for every track, then replace pitches only; if more measures are needed, keep copying the same line and never modify any :1:
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
| C4:1 D4:1 E4:1 F4:1 |
For 3/4 or 6/8, write three :1 events per line. Do not output fractional event durations or :2, :3, or :4. Count each line's events, then output only the complete OWT.`,
    scoreMedia: `TASK: Read the attached score image or sampled video frames and transcribe the visible music into one complete, playable OWT score.

ADDITIONAL USER REQUEST:
{instruction}

CURRENT OWT (use only when the user requests an edit):
{currentOwt}

Resolve uncertain details conservatively with valid notation; never invent unsupported OWT symbols. Sum each measure independently and close its right bar line only when the duration exactly equals the active-meter measure length; fill any deficit with a rest. Output only the final complete OWT.`,
    improvise: `TASK: Continue the current performance as coherent musical call-and-response. Preserve its recognizable motif, add an answer consistent with its key and meter, and return the complete combined OWT.

ADDITIONAL USER REQUEST:
{instruction}

CURRENT OWT:
{currentOwt}

Do not return only the new fragment. Preserve the meter. Sum each measure independently, fill every deficit with a rest, and write its closing bar line only after the exact measure length is reached. Output only the final complete OWT.`,
  }
}


export const DEFAULT_OWT_AI_PROMPT_TEMPLATES: OwtAiPromptTemplates = defaultOwtAiPromptTemplates()
export interface OwtAiPromptTemplateIssue {
  field: keyof OwtAiPromptTemplates
  kind: 'empty' | 'unknown-variable'
  variable?: string
}

export function validateOwtAiPromptTemplates(templates: OwtAiPromptTemplates): OwtAiPromptTemplateIssue[] {
  const supported = new Set(['instruction', 'currentOwt', 'owtReference'])
  const issues: OwtAiPromptTemplateIssue[] = []
  for (const [field, template] of Object.entries(templates) as Array<[keyof OwtAiPromptTemplates, string]>) {
    if (!template.trim()) issues.push({ field, kind: 'empty' })
    for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      if (!supported.has(match[1]!)) issues.push({ field, kind: 'unknown-variable', variable: match[1] })
    }
  }
  return issues
}


export const DEFAULT_OWT_AI_CONFIG: OwtAiConfig = {
  baseUrl: '',
  model: '',
  maxTokens: 4096,
  thinkingBudgetTokens: 2048,
  retryCount: 3,
  autoRepair: true,
}

export function hasConfiguredAiApi(config: Pick<OwtAiConfig, 'baseUrl' | 'model'>): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0
}

export function buildManualOwtPrompt(currentOwt: string, locale: 'en' | 'zh-CN' = 'en'): string {
  const score = currentOwt.trim() || 'owt 0.1 score\n\ntitle "New Melody"\nppq 480\nmeter 1:1 4/4\ntempo 1:1 120\nkey 1:1 C major\n\ntrack "Melody" channel=1 program=0 velocity=88\n| C4:1 D4:1 E4:1 F4:1 |\nend'
  if (locale === 'zh-CN') {
    return `你是 OpusWeave 的 OWT 0.1 乐谱编辑助手。请依据下方内置格式参考与我讨论创作意图；信息不足时可以先提问。需要给出最终结果时，只输出一份完整、有效的 OWT 文档，不要使用 Markdown 代码围栏，也不要附加解释。

创作要求：
（请在这里写下希望创作或修改的内容；也可以先把这段提示词发给 AI，再继续对话。）

内置 OWT 0.1 格式参考：
${buildOwt01Reference('zh-CN')}

当前 OWT：
${score}`
  }
  return `You are an OpusWeave OWT 0.1 score-editing assistant. Use the built-in format reference below, discuss the creative intent with me, and ask clarifying questions when needed. When a final result is requested, output exactly one complete, valid OWT document without Markdown fences or additional explanation.

CREATIVE REQUEST:
(Write what you want to create or change here, or send this prompt first and continue the conversation with the AI.)

BUILT-IN OWT 0.1 FORMAT REFERENCE:
${buildOwt01Reference('en')}

CURRENT OWT:
${score}`
}

function promptTemplates(config?: OwtAiConfig): OwtAiPromptTemplates {
  return { ...defaultOwtAiPromptTemplates(config?.locale), ...config?.promptTemplates }
}

function chatEndpoint(config: OwtAiConfig): string {
  return aiRequestEndpoint(config)
}

function expandPromptTemplate(template: string, request: OwtAiRequest, locale: 'en' | 'zh-CN'): string {
  const variables: Record<string, string> = {
    instruction: request.instruction,
    currentOwt: request.currentOwt,
    owtReference: buildOwt01Reference(locale),
  }
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token, name: string) => variables[name] ?? token).trim()
}

export function buildOwtAiMessages(request: OwtAiRequest, config?: OwtAiConfig): ChatMessage[] {
  const templates = promptTemplates(config)
  const locale = config?.locale ?? 'en'
  const taskTemplate = request.task === 'score-media' ? templates.scoreMedia : templates[request.task]
  const text = expandPromptTemplate(taskTemplate, request, locale)
  const attachments = request.attachments ?? []
  const content: ChatMessage['content'] = attachments.length === 0
    ? text
    : [
        { type: 'text', text },
        ...attachments.map((attachment) => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl } })),
      ]
  const system = expandPromptTemplate(templates.system, request, locale)
  return [{ role: 'system', content: system }, { role: 'user', content }]
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
  const openAiEffort = config.reasoningEffort === 'max'
    ? undefined
    : config.reasoningEffort ?? (config.thinkingMode === 'disabled' ? 'none' : undefined)
  const anthropicEffort = config.reasoningEffort && !['none', 'minimal'].includes(config.reasoningEffort)
    ? config.reasoningEffort
    : undefined
  const sampling = {
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(body.top_p === undefined ? {} : { top_p: body.top_p }),
  }
  let requestBody: unknown = {
    ...body,
    ...(openAiEffort ? { reasoning_effort: openAiEffort } : {}),
  }
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
      ...sampling,
      max_output_tokens: body.max_tokens,
      ...(openAiEffort ? { reasoning: { effort: openAiEffort } } : {}),
      stream: true,
    }
  } else if (protocol === 'openai-completions') {
    requestBody = { model: body.model, prompt: `${typeof system?.content === 'string' ? `${system.content}\n\n` : ''}${userPrompt}`, ...sampling, max_tokens: body.max_tokens, stream: true }
  } else if (protocol === 'anthropic-messages') {
    if (config.thinkingMode === 'enabled' && body.max_tokens <= 1024) {
      throw new Error('Anthropic manual thinking requires maxTokens to be greater than 1024')
    }
    const thinking = config.thinkingMode === 'adaptive'
      ? { type: 'adaptive' }
      : config.thinkingMode === 'enabled'
        ? {
            type: 'enabled',
            budget_tokens: Math.max(1024, Math.min(config.thinkingBudgetTokens ?? 2048, body.max_tokens - 1)),
          }
        : config.thinkingMode === 'disabled'
          ? { type: 'disabled' }
          : undefined
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
      ...sampling,
      max_tokens: body.max_tokens,
      ...(thinking ? { thinking } : {}),
      ...(anthropicEffort ? { output_config: { effort: anthropicEffort } } : {}),
      stream: true,
    }
  } else if (protocol === 'ollama-native') {
    const ollamaEffort = config.reasoningEffort === 'none'
      ? false
      : config.reasoningEffort === 'minimal'
        ? 'low'
        : config.reasoningEffort === 'xhigh'
          ? 'max'
          : config.reasoningEffort
    const think = config.thinkingMode === 'disabled'
      ? false
      : ollamaEffort ?? (config.thinkingMode === 'enabled' || config.thinkingMode === 'adaptive' ? true : undefined)
    requestBody = {
      model: body.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => 'text' in part ? part.text : '').join('\n'),
        images: typeof message.content === 'string' ? undefined : message.content.filter((part) => part.type === 'image_url').map((part) => 'image_url' in part ? part.image_url.url.replace(/^data:[^;]+;base64,/, '') : ''),
      })),
      options: { ...sampling, num_predict: body.max_tokens },
      ...(think === undefined ? {} : { think }),
      stream: true,
    }
  }
  const response = await sendAiProviderRequest({
    endpoint,
    headers: aiRequestHeaders(config, protocol),
    body: requestBody,
    apiKey: config.apiKey,
  }, options)
  return readAiTextResponse(response, protocol, options.onUpdate)
}


export async function createOwtWithAi(config: OwtAiConfig, request: OwtAiRequest, options: OwtAiTransportOptions = {}): Promise<string> {
  const messages = buildOwtAiMessages(request, config)
  const body: ChatBody = {
    model: config.model.trim(),
    messages,
    temperature: config.temperature,
    top_p: config.topP,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
  }
  if (!body.model) throw new Error('AI model is required')
  let content = await postChat(config, body, options)
  let validationError: unknown
  const retryCount = config.autoRepair === false ? 0 : Math.max(0, Math.min(10, Math.trunc(config.retryCount ?? 3)))
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return extractOwtFromAiResponse(content)
    } catch (error) {
      validationError = error
      if (attempt === retryCount) break
      body.messages = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user', content: `Repair every validation error. Recount every measure so each 4/4 bar totals exactly 4. Return the complete corrected OWT only. Validation error: ${error instanceof Error ? error.message : String(error)}` },
      ]
      content = await postChat(config, body, options)
    }
  }
  throw validationError
}

export async function testOwtAiConnection(config: OwtAiConfig, options: OwtAiTransportOptions = {}): Promise<string> {
  const body: ChatBody = {
    model: config.model.trim(),
    messages: [{ role: 'user', content: 'Reply with exactly OPUSWEAVE_AI_OK' }],
    temperature: config.temperature,
    top_p: config.topP,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
  }
  return postChat(config, body, options)
}

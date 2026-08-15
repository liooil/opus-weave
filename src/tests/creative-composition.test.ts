import { describe, expect, test } from 'bun:test'
import { ConversationalImprovSession } from '../domain/ai/conversational-improv.ts'
import { RecentPerformanceCapture } from '../domain/ai/recent-performance.ts'
import { buildOwtAiMessages, createOwtWithAi, defaultOwtAiPromptTemplates, DEFAULT_OWT_AI_CONFIG, extractOwtFromAiResponse, hasConfiguredAiApi, validateOwtAiPromptTemplates } from '../domain/ai/owt-ai.ts'
import { keyboardLayoutTextToOwt } from '../domain/composition/keyboard-layout-composition.ts'
import { musicalTypingPitches, musicalTypingStep, musicalTypingToOwt } from '../domain/composition/musical-typing.ts'
import { BUILTIN_OWT_EXAMPLES } from '../domain/owt/builtin-examples.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'
import { buildOwt01Reference } from '../domain/owt/reference.ts'

const validAiOwt = `owt 0.1 score

title "AI Result"
ppq 480
meter 1:1 4/4
tempo 1:1 100
key 1:1 C major
track "Melody" channel=1 program=0 velocity=88
| C4:1 D4:1 E4:1 G4:1 |
end
`

describe('built-in OWT examples', () => {
  test('all parse and compile as complete public-domain scores', () => {
    expect(BUILTIN_OWT_EXAMPLES.length).toBeGreaterThanOrEqual(6)
    for (const example of BUILTIN_OWT_EXAMPLES) {
      const score = parseOwtOrThrow(example.text)
      expect(score.title).toBeTruthy()
      expect(example.title).toBe(score.title!)
      expect(score.tracks.length).toBeGreaterThan(0)
      expect(score.tracks.some((track) => track.events.some((event) => event.kind === 'note'))).toBe(true)
    }
  })
})

describe('musical typing', () => {
  test('keeps English typing inside C-major pentatonic with constrained leaps', () => {
    const pitches = musicalTypingPitches('hello world', 'english')
    const allowed = new Set([60, 62, 64, 67, 69, 72, 74, 76, 79, 81])
    expect(pitches.length).toBe(11)
    expect(pitches.every((pitch) => allowed.has(pitch))).toBe(true)
    expect(pitches.slice(1).every((pitch, index) => Math.abs(pitch - pitches[index]!) <= 9)).toBe(true)
  })

  test('maps Pinyin tone numbers to audible contours', () => {
    expect(musicalTypingStep('1', 'pinyin', 3)?.pitches).toEqual([67, 67])
    expect(musicalTypingStep('2', 'pinyin', 3)?.pitches).toEqual([64, 69])
    expect(musicalTypingStep('3', 'pinyin', 3)?.pitches).toEqual([67, 64, 69])
    expect(musicalTypingStep('4', 'pinyin', 3)?.pitches).toEqual([69, 64])
  })

  test('renders deterministic, measure-aligned OWT with harmony', () => {
    const text = musicalTypingToOwt('ni3 hao3', 'pinyin')
    const score = parseOwtOrThrow(text)
    expect(score.tracks.map((track) => track.name)).toEqual(['Pinyin Melody', 'Harmony'])
    expect(score.tracks[0]!.events.filter((event) => event.kind === 'note').length).toBeGreaterThan(8)
  })

  test('renders valid OWT from every built-in live layout', () => {
    const inputs = { default: 'zxcvbnmqwerty', english: 'hello world', pinyin: 'ni3 hao3', freepiano: 'asdf qwer 1234' } as const
    for (const [layout, input] of Object.entries(inputs)) {
      const score = parseOwtOrThrow(keyboardLayoutTextToOwt(input, layout as keyof typeof inputs))
      expect(score.tracks[0]!.events.some((event) => event.kind === 'note')).toBe(true)
    }
  })
})

describe('OWT AI client', () => {
  test('keeps API configuration optional', () => {
    expect(DEFAULT_OWT_AI_CONFIG).toMatchObject({ baseUrl: '', model: '', retryCount: 0 })
    expect(hasConfiguredAiApi(DEFAULT_OWT_AI_CONFIG)).toBe(false)
    expect(hasConfiguredAiApi({ baseUrl: 'http://model.test', model: 'local-model' })).toBe(true)
    expect(hasConfiguredAiApi({ baseUrl: 'http://model.test', model: '' })).toBe(false)
  })

  test('extracts a validated OWT document from fenced model output', () => {
    expect(extractOwtFromAiResponse(`Here is the score:\n\`\`\`owt\n${validAiOwt}\`\`\``)).toBe(validAiOwt)
  })

  test('sends images through OpenAI-compatible multimodal content', () => {
    const messages = buildOwtAiMessages({
      task: 'score-media',
      instruction: 'Transcribe it',
      currentOwt: validAiOwt,
      attachments: [{ mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==', label: 'score.png' }],
    })
    expect(messages[1]!.content).toBeArray()
    expect(messages[1]!.content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } })
  })

  test('expands only explicit variables in editable prompt templates', () => {
    const config = {
      baseUrl: 'http://model.test',
      model: 'test',
      promptTemplates: {
        system: 'SYSTEM::{owtReference}',
        prompt: 'COMPOSE::{instruction}::{currentOwt}',
        scoreMedia: 'MEDIA::{instruction}::{currentOwt}',
        improvise: 'IMPROV::{instruction}::{currentOwt}',
      },
    }
    for (const [task, marker] of [['prompt', 'COMPOSE'], ['score-media', 'MEDIA'], ['improvise', 'IMPROV']] as const) {
      const messages = buildOwtAiMessages({ task, instruction: 'user request', currentOwt: validAiOwt }, config)
      expect(messages[0]!.content).toContain(`SYSTEM::${buildOwt01Reference('en')}`)
      expect(messages[1]!.content).toContain(`${marker}::user request::${validAiOwt.trim()}`)
    }
  })


  test('rejects empty templates and unknown custom variables', () => {
    const templates = defaultOwtAiPromptTemplates('en')
    expect(validateOwtAiPromptTemplates({ ...templates, prompt: '' })).toContainEqual({ field: 'prompt', kind: 'empty' })
    expect(validateOwtAiPromptTemplates({ ...templates, improvise: 'Use {mystery}' })).toContainEqual({
      field: 'improvise',
      kind: 'unknown-variable',
      variable: 'mystery',
    })
    expect(validateOwtAiPromptTemplates({ ...templates, system: 'Use {locale}' })).toContainEqual({
      field: 'system',
      kind: 'unknown-variable',
      variable: 'locale',
    })
    expect(validateOwtAiPromptTemplates(templates)).toEqual([])
  })

  test('uses one complete built-in OWT reference for people and every AI task', () => {
    const reference = buildOwt01Reference('en')
    for (const field of ['title "Title"', 'ppq 480', 'meter 1:1 4/4', 'tempo 1:1 120', 'key 1:1 C major', 'channel=1', 'program=0', 'velocity=88', 'C4:1', 'R:1', '[C4 E4 G4]:2', '<cc64=127>', '<bend=8192>', 'bar line is a validation assertion']) {
      expect(reference).toContain(field)
    }
    for (const task of ['prompt', 'score-media', 'improvise'] as const) {
      const messages = buildOwtAiMessages({ task, instruction: 'test', currentOwt: validAiOwt })
      expect(messages[0]!.content).toContain(reference)
    }
  })

  test('asks once for repair when the first model response is invalid', async () => {
    const requests: Array<{ messages: unknown[] }> = []
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] }
      requests.push(body)
      const content = requests.length === 1 ? 'not an owt document' : validAiOwt
      return Response.json({ choices: [{ message: { content } }] })
    }) as typeof fetch
    const result = await createOwtWithAi({ baseUrl: 'http://model.test', model: 'test', retryCount: 1 }, {
      task: 'prompt', instruction: 'make it brighter', currentOwt: validAiOwt,
    }, { fetcher })
    expect(result).toBe(validAiOwt)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.messages).toHaveLength(4)
  })

  test('does not retry invalid OWT by default', async () => {
    let calls = 0
    const fetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) => {
      calls++
      return Response.json({ choices: [{ message: { content: 'still invalid' } }] })
    }) as typeof fetch
    await expect(createOwtWithAi({ baseUrl: 'http://model.test', model: 'test' }, {
      task: 'prompt', instruction: 'do not retry', currentOwt: validAiOwt,
    }, { fetcher })).rejects.toThrow('AI response did not contain an OWT score')
    expect(calls).toBe(1)
  })

  test('never falls back to JSON when streamed OWT repairs remain invalid', async () => {
    let calls = 0
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      calls++
      const body = JSON.parse(String(init?.body)) as { stream?: unknown; response_format?: unknown }
      expect(body.stream).toBe(true)
      expect(body.response_format).toBeUndefined()
      return Response.json({ choices: [{ message: { content: 'still invalid' } }] })
    }) as typeof fetch
    await expect(createOwtWithAi({ baseUrl: 'http://model.test', model: 'test', retryCount: 3 }, {
      task: 'improvise', instruction: 'answer it', currentOwt: validAiOwt,
    }, { fetcher })).rejects.toThrow('AI response did not contain an OWT score')
    expect(calls).toBe(4)
  })

  test('honors configurable retry count and automatic repair switch', async () => {
    let calls = 0
    const fetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) => {
      calls++
      return Response.json({ choices: [{ message: { content: 'invalid' } }] })
    }) as typeof fetch
    await expect(createOwtWithAi({ baseUrl: 'http://model.test', model: 'test', retryCount: 1 }, {
      task: 'prompt', instruction: 'test', currentOwt: validAiOwt,
    }, { fetcher })).rejects.toThrow()
    expect(calls).toBe(2)
    calls = 0
    await expect(createOwtWithAi({ baseUrl: 'http://model.test', model: 'test', retryCount: 9, autoRepair: false }, {
      task: 'prompt', instruction: 'test', currentOwt: validAiOwt,
    }, { fetcher })).rejects.toThrow()
    expect(calls).toBe(1)
  })
})

describe('recent performance capture', () => {
  test('returns the latest phrase as a quantized RecordedTake and resets after a long gap', () => {
    const capture = new RecentPerformanceCapture(30_000, 2_000)
    capture.push(new Uint8Array([0x90, 60, 90]), 1_000)
    capture.push(new Uint8Array([0x80, 60, 64]), 1_500)
    capture.push(new Uint8Array([0x90, 67, 90]), 4_000)
    capture.push(new Uint8Array([0x80, 67, 64]), 4_500)
    const take = capture.take(4_600)
    expect(take?.events).toHaveLength(2)
    expect(take?.events[0]).toMatchObject({ tick: 0 })
    expect(take?.events[1]!.tick).toBeGreaterThan(0)
  })
})


describe('conversational improvisation', () => {
  test('detects a completed user turn after silence', () => {
    const session = new ConversationalImprovSession(1_200)
    session.start()
    expect(session.state).toBe('listening')
    expect(session.push(new Uint8Array([0x90, 60, 90]), 1_000)).toMatchObject({ phraseStarted: true, interruptedAi: false })
    session.push(new Uint8Array([0x80, 60, 64]), 1_400)
    expect(session.poll(2_599)).toBeNull()
    const phrase = session.poll(2_600)
    expect(phrase?.events).toHaveLength(2)
    expect(session.state).toBe('thinking')
  })

  test('returns to listening after AI playback and supports barge-in', () => {
    const session = new ConversationalImprovSession(500)
    session.start()
    session.push(new Uint8Array([0x90, 60, 90]), 0)
    session.push(new Uint8Array([0x80, 60, 64]), 100)
    expect(session.poll(600)).not.toBeNull()
    session.markResponding()
    expect(session.state).toBe('responding')
    expect(session.push(new Uint8Array([0x90, 67, 90]), 700)).toMatchObject({ phraseStarted: true, interruptedAi: true })
    expect(session.state).toBe('recording')
    session.stop()
    expect(session.state).toBe('off')
  })
})

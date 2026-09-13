import { describe, expect, test } from 'bun:test'
import { ImprovEventParser, RealtimeImprovSession } from '../domain/ai/realtime-improv.ts'
import { generateImprovPlan } from '../domain/ai/realtime-improv-client.ts'
import { DEFAULT_OWT_AI_CONFIG } from '../domain/ai/owt-ai.ts'
import { improvScore } from '../domain/ai/realtime-improv-score.ts'
import { parseOwt } from '../domain/owt/parser.ts'
import { compileScoreText } from '../domain/owt/integration.ts'

const on = (pitch = 60) => new Uint8Array([0x90, pitch, 90])
const off = (pitch = 60) => new Uint8Array([0x80, pitch, 0])

function setup() {
  const sent: Array<{ pitch: number; velocity: number; time: number }> = []
  const session = new RealtimeImprovSession((pitch, velocity, time) => sent.push({ pitch, velocity, time }))
  session.start(0, 120)
  session.input(on(), 0)
  return { session, sent }
}

describe('continuous improv event protocol', () => {
  test('buffers partial lines and never replays cumulative streaming text', () => {
    const notes: number[][] = []
    const parser = new ImprovEventParser(32, (...note) => notes.push(note))
    parser.push('N 0 2 60')
    expect(notes).toEqual([])
    parser.push('N 0 2 60 80\nN 4 2')
    expect(notes).toEqual([[0, 2, 60, 80]])
    parser.push('N 0 2 60 80\nN 4 2 64 75', true)
    parser.push('N 0 2 60 80\nN 4 2 64 75', true)
    expect(notes).toEqual([[0, 2, 60, 80], [4, 2, 64, 75]])
  })

  test('rejects malformed, out-of-range and out-of-order events without executing them', () => {
    const notes: number[][] = []
    const parser = new ImprovEventParser(32, (...note) => notes.push(note))
    parser.push('```\nN 0 0 60 80\nN 0 2 128 80\nN 31 2 60 80\nN 4 2 60 80\nN 2 2 60 80\nEND\n')
    expect(notes).toEqual([[4, 2, 60, 80]])
    expect(parser.rejected).toBe(5)
    expect(() => parser.push('x'.repeat(16_385))).toThrow('budget')
  })
})

describe('continuous musical timeline', () => {
  test('plans while keys are held and continues capturing throughout generation and playback', () => {
    const { session, sent } = setup()
    const plan = session.plan(0)!
    expect(plan.held).toEqual([60])
    expect(session.plan(0.2)).toBeNull()
    session.input(on(64), 0.2)
    expect(session.generating).toBe(true)
    expect(session.accept(plan, 0, 4, 48, 80, 0.3)).toBe(true)
    session.tick(plan.start - 0.1)
    expect(sent[0]).toEqual({ pitch: 48, velocity: 52, time: plan.start })
    session.input(off(60), 1.1)
    session.finish(plan, 1.2)
    const next = session.plan(1.4)!
    expect(next.human.map(n => n.pitch)).toEqual([60, 64])
    expect(next.held).toEqual([64])
    expect(session.played(1.4)).toHaveLength(1)
  })

  test('drops late events instead of catching up and keeps scheduled note-offs after replanning', () => {
    const { session, sent } = setup()
    const plan = session.plan(0)!
    expect(session.accept(plan, 0, 4, 48, 80, plan.start)).toBe(false)
    expect(session.accept(plan, 4, 8, 50, 80, 0.2)).toBe(true)
    session.tick(1.4)
    session.finish(plan, 1.5)
    session.plan(1.7)
    session.tick(2.4)
    expect(sent).toEqual([{ pitch: 50, velocity: 52, time: 1.5 }, { pitch: 50, velocity: 0, time: 2.5 }])
    expect(session.dropped).toBe(1)
  })

  test('replaces only uncommitted future notes and rejects overlapping voices', () => {
    const { session } = setup()
    const first = session.plan(0)!
    session.accept(first, 0, 16, 48, 80, 0.1)
    session.accept(first, 20, 4, 55, 80, 0.1)
    session.tick(0.9)
    session.finish(first, 1)
    session.requestUpdate()
    const next = session.plan(1.2)!
    expect(session.accept(next, 0, 4, 60, 80, 1.3)).toBe(false)
    expect(session.accept(next, 8, 4, 62, 80, 1.3)).toBe(true)
    expect(session.future(1.3).map(n => n.pitch)).toEqual([62])
  })

  test('invalidates old streams on stop/restart and archives only sounded notes', () => {
    const { session, sent } = setup()
    const plan = session.plan(0)!
    session.accept(plan, 0, 4, 48, 80, 0.1)
    session.tick(0.9)
    session.stop(0.95)
    expect(session.played(10)).toEqual([])
    expect(session.human(10)[0]?.duration).toBe(0.95)
    session.tick(1.5)
    expect(sent).toHaveLength(1)
    session.start(2, 100)
    expect(session.accept(plan, 8, 4, 60, 80, 2)).toBe(false)
    session.finish(plan, 3)
    expect(session.played(3)).toEqual([])
  })

  test('closes held human notes and truncates AI notes when ending a take', () => {
    const { session } = setup()
    const plan = session.plan(0)!
    session.accept(plan, 0, 16, 48, 80, 0.2)
    session.tick(0.9)
    session.stop(1.2)
    expect(session.played(20)[0]?.duration).toBeCloseTo(0.2)
    expect(session.human(20)[0]?.duration).toBe(1.2)
  })

  test('backs off after failure and stops generating after extended human silence', () => {
    const { session } = setup()
    const plan = session.plan(0)!
    session.finish(plan, 1, true)
    expect(session.plan(2)).toBeNull()
    expect(session.plan(3)).not.toBeNull()
    session.stop(3)
    session.start(4, 120)
    session.input(on(), 4)
    session.input(off(), 4.2)
    expect(session.plan(13)).toBeNull()
  })
})

test('streaming client emits before response completion and disables thinking only for its request', async () => {
  const config = { ...DEFAULT_OWT_AI_CONFIG, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', protocol: 'openai-chat-completions' as const, thinkingMode: 'enabled' as const }
  const { session } = setup()
  const plan = session.plan(0)!
  let body: any
  let close!: () => void
  let received!: () => void
  const event = new Promise<void>(resolve => { received = resolve })
  let emitted = 0
  const running = generateImprovPlan(config, plan, 'bass', () => { emitted++; received() }, {
    fetcher: (async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(new ReadableStream({ start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"N 0 4 48 80\\n"}}]}\n\n'))
        close = () => { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"END"}}]}\n\ndata: [DONE]\n\n')); controller.close() }
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch,
  })
  await event
  expect(emitted).toBe(1)
  expect(body.thinking).toEqual({ type: 'disabled' })
  expect(body.max_tokens).toBe(320)
  expect(body.messages[1].content).toContain('Currently held human pitches: 60')
  expect(config.thinkingMode).toBe('enabled')
  close()
  await running
})

test('archives polyphonic input and bar-crossing notes as valid, playable OWT', () => {
  const text = improvScore([
    { start: 10, duration: 2.5, pitch: 60, velocity: 90 },
    { start: 10.5, duration: 0.5, pitch: 64, velocity: 80 },
    { start: 15, duration: 0.25, pitch: 67, velocity: 70 },
  ], [{ start: 11, duration: 1.5, pitch: 48, velocity: 55 }], 10, 120)
  const parsed = parseOwt(text)
  expect(parsed.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(parsed.document?.tracks).toHaveLength(3)
  expect(compileScoreText(text).midi.byteLength).toBeGreaterThan(0)
})

test('sustain pedal extends captured and held notes until release', () => {
  const { session } = setup()
  session.input(new Uint8Array([0xb0, 64, 127]), 0.1)
  session.input(off(), 0.2)
  expect(session.plan(0.3)?.held).toEqual([60])
  expect(session.human(1)[0]?.duration).toBe(1)
  session.input(new Uint8Array([0xb0, 64, 0]), 1.2)
  expect(session.human(2)[0]?.duration).toBe(1.2)
})

test('an unusable replacement cannot erase a valid pending plan', () => {
  const { session } = setup()
  const first = session.plan(0)!
  session.accept(first, 0, 16, 48, 80, 0.1)
  session.accept(first, 20, 4, 55, 80, 0.1)
  session.tick(0.9)
  session.finish(first, 1)
    session.requestUpdate()
  const next = session.plan(1.2)!
  expect(session.accept(next, 0, 4, 60, 80, 1.3)).toBe(false)
  expect(session.future(1.3).map(n => n.pitch)).toEqual([55])
})


test('unchanged input preserves sufficient coverage, while role changes refresh it', () => {
  const { session } = setup()
  const first = session.plan(0)!
  session.accept(first, 24, 8, 48, 80, 0.1)
  session.finish(first, 0.2)
  expect(session.plan(0.4)).toBeNull()
  session.requestUpdate()
  const next = session.plan(0.4)!
  expect(next).not.toBeNull()
  expect(session.plan(0.5)).toBeNull()
  session.finish(next, 0.6)
  expect(session.plan(1)).toBeNull()
  expect(session.plan(4)).not.toBeNull()
})

import { expect, test } from 'bun:test'
import { buildImprovPrompt } from '../domain/ai/improv-prompt.ts'
import { evaluateImprov, improvCases } from '../domain/ai/improv-evaluation.ts'
import { ImprovEventParser, RealtimeImprovSession } from '../domain/ai/realtime-improv.ts'
import { generateImprovPlan } from '../domain/ai/realtime-improv-client.ts'

test('context represents bar phase and rounds carried note tails conservatively', () => {
  const fixture = improvCases.find(c => c.id === 'carried-note')!
  expect(buildImprovPrompt(fixture.plan, fixture.role).earliest).toBe(6)
  const session = new RealtimeImprovSession(() => {})
  session.start(10, 120)
  session.input(new Uint8Array([0x90, 60, 90]), 10)
  const plan = session.plan(10)!
  expect(plan.barOffset).toBe(8)
  expect(plan.observedAt).toBe(10)
})

test('overlapping events and data after END never reach playback', () => {
  const notes: number[][] = []
  const parser = new ImprovEventParser(16, (...n) => notes.push(n))
  parser.push('N 0 4 48 60\nN 2 4 52 60\nN 4 4 55 60\nEND\nN 8 4 48 60\n', true)
  expect(notes).toEqual([[0, 4, 48, 60], [4, 4, 55, 60]])
  expect(parser.rejected).toBe(2)
})

test('a fully occupied window preserves the existing voice without contacting the provider', async () => {
  const fixture = improvCases.find(c => c.id === 'no-space')!
  let calls = 0
  await generateImprovPlan({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, fixture.plan, fixture.role, () => { throw new Error('Unexpected note') }, {
    fetcher: (async () => { calls++; throw new Error('Unexpected request') }) as unknown as typeof fetch,
  })
  expect(calls).toBe(0)
  expect(buildImprovPrompt(fixture.plan, fixture.role).prompt).toContain('END only')
})

test('recent pitch names exclude the previous harmony and preserve accidentals', () => {
  const change = improvCases.find(c => c.id === 'harmony-change')!
  expect(buildImprovPrompt(change.plan, change.role).prompt).toContain('Recent human pitch classes (last two beats, observations rather than a mandatory scale): F A C.')
  const chromatic = improvCases.find(c => c.id === 'chromatic-held')!
  expect(buildImprovPrompt(chromatic.plan, chromatic.role).prompt).toContain('Held pitch classes: C# F G#.')
  const minor = improvCases.find(c => c.id === 'busy-d-minor')!
  const choices = buildImprovPrompt(minor.plan, minor.role).prompt.match(/Observed-tone MIDI choices for this role: ([\d ]+)/)![1]!.split(' ').map(Number)
  expect(choices).toContain(65)
  expect(choices).not.toContain(66)
})

test('actual first-round provider failures remain rejected', () => {
  expect(evaluateImprov('0 4 48 80\n6 2 55 70\n8 4 43 78\n13 3 50 72\nEND', improvCases[0]!).rejected).toBe(4)
  const occupied = improvCases.find(c => c.id === 'no-space')!
  const bad = evaluateImprov('N 17 4 43 80\nN 16 4 48 72\nN 12 4 55 68\nEND', occupied)
  expect(bad.valid).toBe(false)
  expect(bad.carryCollisions).toBe(1)
})

test('evaluation distinguishes hard errors from musical review flags and legitimate silence', () => {
  const bass = improvCases[0]!
  expect(evaluateImprov('N 0 4 48 60\nN 8 4 43 60\nEND', bass).valid).toBe(true)
  expect(evaluateImprov('N 0 4 48 60', bass).valid).toBe(false)
  const flagged = evaluateImprov('N 0 4 61 60\nEND', bass)
  expect(flagged.valid).toBe(true)
  expect(flagged.review.sustainedSemitoneClashes).toBe(1)
  expect(flagged.review.bassOutsideRegister).toBe(1)
  const occupied = improvCases.find(c => c.id === 'no-space')!
  expect(evaluateImprov('END', occupied).valid).toBe(true)
  expect(evaluateImprov('N 0 4 48 60\nEND', occupied).carryCollisions).toBe(1)
})

test('client rejects carried-note collisions and truncation, while permitting an explicit rest', async () => {
  const fixture = improvCases.find(c => c.id === 'carried-note')!
  const run = async (content: string) => {
    const notes: number[][] = []
    const request = generateImprovPlan({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', protocol: 'openai-chat-completions' }, fixture.plan, fixture.role, (...note) => notes.push(note), {
      fetcher: (async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch,
    })
    return { request, notes }
  }
  const collision = await run('N 0 4 60 60\nEND')
  await expect(collision.request).rejects.toThrow('invalid music')
  expect(collision.notes).toEqual([])
  const truncated = await run('N 6 4 60 60\n')
  await expect(truncated.request).rejects.toThrow('without END')
  const rest = await run('END')
  await rest.request
  expect(rest.notes).toEqual([])
})

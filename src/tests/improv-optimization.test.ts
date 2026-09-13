import { expect, test } from 'bun:test'
import { ImprovTiming } from '../domain/ai/improv-timing.ts'
import { currentDeepSeekModel } from '../domain/ai/deepseek-model.ts'
import { modelDirectory } from '../web/model-catalog.ts'
import { generateImprovPlan } from '../domain/ai/realtime-improv-client.ts'
import { DEFAULT_OWT_AI_CONFIG } from '../domain/ai/owt-ai.ts'

test('fast responses shorten the window; latency spikes retain a conservative buffer', () => {
  const timing = new ImprovTiming()
  expect(timing.windowBeats(120)).toBe(8)
  for (let i = 0; i < 8; i++) timing.observe(0.08, 0.2, false, false)
  expect(timing.lead).toBeCloseTo(0.33)
  expect(timing.cadence).toBe(0.35)
  expect(timing.windowBeats(120)).toBe(4)
  timing.observe(1.8, 2.2, true, false)
  expect(timing.lead).toBeCloseTo(2.05)
  expect(timing.windowBeats(120)).toBe(8)
  for (let i = 0; i < 7; i++) timing.observe(0.08, 0.2, false, false)
  expect(timing.lead).toBeCloseTo(2.05)
  timing.observe(0.08, 0.2, false, false)
  expect(timing.lead).toBeCloseTo(1.95)
  timing.reset()
  expect(timing.samples).toBe(0)
  expect(timing.lead).toBe(0.8)
})

test('official aliases migrate without rewriting proxy or other model IDs', () => {
  expect(currentDeepSeekModel('https://api.deepseek.com/v1', 'deepseek-v4-flash')).toBe('deepseek-flash')
  expect(currentDeepSeekModel('https://api.deepseek.com', 'deepseek-v4-flash-vision-exp')).toBe('deepseek-flash')
  expect(currentDeepSeekModel('https://proxy.example/v1', 'deepseek-v4-flash')).toBe('deepseek-v4-flash')
  expect(currentDeepSeekModel('invalid', 'deepseek-v4-flash')).toBe('deepseek-v4-flash')
  expect(currentDeepSeekModel('https://api.deepseek.com', 'deepseek-v4-pro')).toBe('deepseek-v4-pro')
  const model = modelDirectory.find(p => p.id === 'deepseek')!.models.find(m => m.id === 'deepseek-flash')!
  expect(model.modalities).toEqual(['text', 'image'])
  expect(model.cost?.output).toBe(1.2)
})

test('short windows lower output budget and retain a shared system prefix across roles', async () => {
  const bodies: any[] = []
  const fetcher = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response('data: {"choices":[{"delta":{"content":"N 0 4 48 80\\nEND"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch
  const config = { ...DEFAULT_OWT_AI_CONFIG, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', protocol: 'openai-chat-completions' as const }
  const plan = { version: 1, start: 1, beats: 4, bpm: 120, human: [], held: [60], ai: [] }
  await generateImprovPlan(config, plan, 'bass', () => {}, { fetcher })
  await generateImprovPlan(config, { ...plan, beats: 8 }, 'counterpoint', () => {}, { fetcher })
  expect(bodies.map(b => b.max_tokens)).toEqual([192, 320])
  expect(bodies[0].messages[0]).toEqual(bodies[1].messages[0])
  expect(bodies[0].messages[1].content).toContain('offset+duration <= 16')
})

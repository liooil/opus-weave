import { describe, expect, test } from 'bun:test'
import { analyzeFullComposition, assembleFullComposition, FullCompositionWorkflow, parseCompositionPlan, type FullCompositionTransport } from '../domain/ai/full-composition.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'
import { createFullCompositionWorkflow } from '../web/controllers/composition-controller.ts'

const planText = `PLAN 0.1
title: Isekai Day
duration: 120
meter: 4/4
key: C major
section: intro | Intro | 2 | 120 | wonder | Piano | sparse | opening
section: battle | Battle Climax | 2 | 140->176 | urgent | Piano | dense | climax
`

function section(title: string, pitches: string): string {
  return `owt 0.1 score\ntitle "${title}"\nppq 480\nmeter 1:1 4/4\ntempo 1:1 120\nkey 1:1 C major\ntrack "Piano" channel=1 program=0 velocity=88\n| ${pitches} |\n| ${pitches} |\nend\n`
}

const intro = section('Intro', 'C4:1 D4:1 E4:1 G4:1')
const battle = section('Battle', 'C5:1/2 D5:1/2 E5:1/2 F5:1/2 G5:1/2 A5:1/2 G5:1/2 E5:1/2')

describe('Full Composition workflow', () => {
  test('validates plans, composes sections in order, repairs one invalid section and assembles tempo map', async () => {
    const calls: Array<{ phase: string; prompt: string }> = []
    let battleAttempts = 0
    const transport: FullCompositionTransport = async (phase, prompt) => {
      calls.push({ phase, prompt })
      if (phase === 'plan') return planText
      if (prompt.includes('section intro')) return intro
      if (phase === 'repair') return battle
      battleAttempts++
      return battleAttempts === 1 ? battle.replace('| C5:1/2', '| C5:1') : battle
    }
    const stages: string[] = []
    const result = await new FullCompositionWorkflow(transport, (stage) => stages.push(stage.kind), undefined, 1).run('two minute anime BGM')
    expect(calls.filter((call) => call.phase === 'section').map((call) => /section (\w+)/.exec(call.prompt)?.[1])).toEqual(['intro', 'battle'])
    expect(calls.some((call) => call.phase === 'repair')).toBe(true)
    expect(stages).toContain('repairing')
    const parsed = parseOwtOrThrow(result.owt)
    expect(parsed.tempos.map((tempo) => tempo.bpm)).toEqual([120, 140, 176])
    expect(parsed.tracks[0]?.events.filter((event) => event.kind === 'note')).toHaveLength(24)
    expect(result.analysis.bars).toBe(4)
    expect(result.analysis.climaxDensityIncreased).toBe(true)
  })

  test('repairs a slightly-off section deterministically without retrying', async () => {
    const phases: string[] = []
    const invalid = intro.replace('C4:1 D4:1 E4:1 G4:1', 'C4:1')
    const transport: FullCompositionTransport = async (phase) => {
      phases.push(phase)
      return phase === 'plan' ? planText : invalid
    }
    const result = await new FullCompositionWorkflow(transport).run('deterministic repair, no retry')
    expect(phases).not.toContain('repair')
    expect(result.owt).toContain('R:3')
    expect(parseOwtOrThrow(result.owt).tracks[0]!.events.some((event) => event.kind === 'rest')).toBe(true)
  })

  test('retries a failed section without regenerating completed sections', async () => {
    let failBattle = true
    const transport: FullCompositionTransport = async (phase, prompt) => {
      if (phase === 'plan') return planText
      if (prompt.includes('section intro')) return intro
      if (failBattle) { failBattle = false; throw new Error('temporary') }
      return battle
    }
    const workflow = new FullCompositionWorkflow(transport)
    await workflow.createPlan('BGM')
    await workflow.composeSection('intro')
    await expect(workflow.composeSection('battle')).rejects.toThrow('temporary')
    await workflow.composeSection('battle')
    expect(workflow.composedSections.map((item) => item.id)).toEqual(['intro', 'battle'])
  })

  test('reports the failed section and finalizes a successful section retry', async () => {
    let failBattle = true
    const stages: Array<{ kind: string; sectionId?: string }> = []
    const workflow = new FullCompositionWorkflow(async (phase, prompt) => {
      if (phase === 'plan') return planText
      if (prompt.includes('section intro')) return intro
      if (failBattle) { failBattle = false; throw new Error('provider unavailable') }
      return battle
    }, (stage) => stages.push(stage))
    await expect(workflow.run('BGM')).rejects.toThrow('provider unavailable')
    expect(stages.at(-1)).toMatchObject({ kind: 'error', sectionId: 'battle' })
    await workflow.composeSection('battle')
    const result = workflow.finalize()
    expect(parseOwtOrThrow(result.owt).tracks[0]?.events.filter((event) => event.kind === 'note')).toHaveLength(24)
    expect(stages.at(-1)).toMatchObject({ kind: 'complete' })
  })

  test('revision replaces only the selected section', async () => {
    const revised = section('Battle revised', 'A5:1 G5:1 F5:1 E5:1')
    const transport: FullCompositionTransport = async (phase, prompt) => phase === 'plan' ? planText : phase === 'revise' ? revised : prompt.includes('section intro') ? intro : battle
    const workflow = new FullCompositionWorkflow(transport)
    const plan = await workflow.createPlan('BGM')
    await workflow.composeSection('intro')
    await workflow.composeSection('battle')
    const before = workflow.composedSections.find((item) => item.id === 'intro')?.owt
    await workflow.composeSection('battle', 'less repetition')
    expect(workflow.composedSections.find((item) => item.id === 'intro')?.owt).toBe(before)
    expect(assembleFullComposition(plan, workflow.composedSections)).toContain('A5:1')
  })

  test('aborts before subsequent section requests and has no fixed-slot fallback', async () => {
    const phases: string[] = []
    let workflow!: FullCompositionWorkflow
    const transport: FullCompositionTransport = async (phase) => {
      phases.push(phase)
      if (phase === 'plan') return planText
      workflow.cancel()
      return intro
    }
    workflow = new FullCompositionWorkflow(transport)
    await expect(workflow.run('BGM')).rejects.toThrow()
    expect(phases).toEqual(['plan', 'section'])
    expect(phases).not.toContain('repair')
  })


  test('streams plain-text plans and section OWT without requesting JSON', async () => {
    const updates: Array<{ phase: string; sectionId?: string; text: string }> = []
    const transport: FullCompositionTransport = async (phase, prompt, _signal, onUpdate) => {
      expect(prompt.toLowerCase()).not.toContain('strict json')
      const text = phase === 'plan' ? planText : prompt.includes('section intro') ? intro : battle
      onUpdate?.(text.slice(0, Math.floor(text.length / 2)))
      onUpdate?.(text)
      return text
    }
    const result = await new FullCompositionWorkflow(transport, undefined, (update) => updates.push(update)).run('stream it')
    expect(updates.some((update) => update.phase === 'plan' && update.text.startsWith('PLAN 0.1'))).toBe(true)
    expect(updates.some((update) => update.sectionId === 'intro' && update.text.includes('C4:1'))).toBe(true)
    expect(result.owt).toContain('C5:1/2')
  })
  test('sends the parser-first default contract with every OWT section request', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = []
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> }
      bodies.push(body)
      const content = bodies.length === 1 ? planText : intro
      return Response.json({ choices: [{ message: { content } }] })
    }) as typeof fetch
    const workflow = createFullCompositionWorkflow({
      baseUrl: 'http://model.test',
      model: 'test',
      protocol: 'openai-chat-completions',
      locale: 'en',
    }, { fetcher }, () => {}, () => {})
    await workflow.createPlan('test composition')
    await workflow.composeSection('intro')
    expect(bodies[0]!.messages[0]!.content).not.toContain('MANDATORY GENERATION CONTRACT')
    expect(bodies[1]!.messages[0]!.content).toContain('GENERATION BEHAVIOR')
    expect(bodies[1]!.messages[0]!.content).toContain('OWT 0.1 — COMPLETE FORMAT REFERENCE')
    expect(bodies[1]!.messages[0]!.content).toContain('OWT 0.1 duration values are measured in quarter-note units')
    expect(bodies[1]!.messages[0]!.content).not.toContain('CANONICAL SAFE SHAPE')
  })

  test('passes the configured reasoning effort to full composition requests', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ choices: [{ message: { content: planText } }] })
    }) as typeof fetch
    const workflow = createFullCompositionWorkflow({
      baseUrl: 'http://model.test',
      model: 'test',
      protocol: 'openai-chat-completions',
      reasoningEffort: 'high',
      locale: 'en',
    }, { fetcher }, () => {}, () => {})
    await workflow.createPlan('test composition')
    expect(requestBody).toHaveProperty('reasoning_effort', 'high')
  })

  test('turns off DeepSeek thinking when reasoning effort is explicitly none', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ choices: [{ message: { content: planText } }] })
    }) as typeof fetch
    const workflow = createFullCompositionWorkflow({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      protocol: 'openai-chat-completions',
      reasoningEffort: 'none',
      locale: 'en',
    }, { fetcher }, () => {}, () => {})
    await workflow.createPlan('test composition')
    expect(requestBody).toHaveProperty('reasoning_effort', 'none')
    expect(requestBody).toHaveProperty('thinking.type', 'disabled')
  })

  test('streams DeepSeek V4 reasoning separately during composition', async () => {
    const encoder = new TextEncoder()
    const updates: Array<{ phase: string; text: string; kind?: string }> = []
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.thinking).toBeUndefined()
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Thinking...' } }] })}\n\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: planText } }] })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const workflow = createFullCompositionWorkflow({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      protocol: 'openai-chat-completions',
      locale: 'en',
    }, { fetcher }, () => {}, (update) => updates.push(update))
    await expect(workflow.createPlan('test composition')).resolves.toEqual(parseCompositionPlan(planText))
    expect(updates).toEqual([{ phase: 'plan', text: 'Thinking...', kind: 'reasoning' }, { phase: 'plan', text: planText }])
  })

  test('reports structural metrics without claiming musical quality', () => {
    const plan = parseCompositionPlan(planText)
    const owt = assembleFullComposition(plan, [{ id: 'intro', owt: intro, attempts: 1 }, { id: 'battle', owt: battle, attempts: 1 }])
    const analysis = analyzeFullComposition(plan, owt)
    expect(analysis).toMatchObject({ bars: 4, sectionsPresent: ['intro', 'battle'], missingSections: [], tempoMatchesPlan: true })
    expect(analysis.tracks[0]).toMatchObject({ channel: 1, program: 0, minPitch: 60, maxPitch: 81 })
  })
})

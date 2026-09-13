import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { streamAiText } from '../src/domain/ai/owt-ai.ts'
import { buildImprovPrompt } from '../src/domain/ai/improv-prompt.ts'
import { improvCases, evaluateImprov } from '../src/domain/ai/improv-evaluation.ts'
import { improvScore } from '../src/domain/ai/realtime-improv-score.ts'
import { baselinePrompt } from './fixtures/improv-prompt-baseline.ts'

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('Set DEEPSEEK_API_KEY in the environment. No requests sent.')
  process.exit(1)
}
const directory = process.env.IMPROV_EVAL_DIR || `/tmp/opus-improv-eval-${Date.now()}`
const repeats = Math.min(5, Math.max(1, Number(process.env.IMPROV_EVAL_REPEATS) || 2))
const results = []
const transpose = Math.max(-12, Math.min(12, Math.trunc(Number(process.env.IMPROV_EVAL_TRANSPOSE) || 0)))
const cases = improvCases.map(fixture => ({ ...fixture, plan: { ...fixture.plan,
  held: fixture.plan.held.map(p => p + transpose),
  human: fixture.plan.human.map(n => ({ ...n, pitch: n.pitch + transpose })),
  ai: fixture.plan.ai.map(n => ({ ...n, pitch: n.pitch + transpose })),
} }))
await mkdir(directory, { recursive: true })
for (const fixture of cases) for (let repeat = 0; repeat < repeats; repeat++) {
  // Alternate ordering to reduce warm-cache/order bias. Both variants share sampling and budgets.
  const variants = repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']
  for (const variant of variants) {
    const { system, prompt } = variant === 'candidate' ? buildImprovPrompt(fixture.plan, fixture.role) : baselinePrompt(fixture.plan, fixture.role)
    const started = performance.now()
    let firstLineMs: number | null = null
    try {
      const output = await streamAiText({ baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', apiKey, protocol: 'openai-chat-completions', thinkingMode: 'disabled', reasoningEffort: 'none', maxTokens: fixture.plan.beats <= 4 ? 192 : 320, retryCount: 0 }, system, prompt, {
        signal: AbortSignal.timeout(20_000),
        onUpdate: text => { if (firstLineMs === null && /^N \d+ \d+ \d+ \d+\r?\n/m.test(text)) firstLineMs = performance.now() - started },
      })
      const evaluation = evaluateImprov(output, fixture)
      results.push({ case: fixture.id, repeat, variant, system, prompt, firstLineMs, completionMs: performance.now() - started, output, ...evaluation })
      const unit = 60 / fixture.plan.bpm / 4
      const ai = evaluation.notes.map(([offset, duration, pitch, velocity]) => ({ start: fixture.plan.start + offset! * unit, duration: duration! * unit, pitch: pitch!, velocity: velocity! }))
      await writeFile(join(directory, `${fixture.id}-${repeat}-${variant}.owt`), improvScore(fixture.plan.human, [...fixture.plan.ai, ...ai], 0, fixture.plan.bpm))
      console.log(`${fixture.id} ${repeat} ${variant}: valid=${evaluation.valid}, notes=${ai.length}`)
    } catch (error) {
      // Provider errors can include request details; keep credentials out of reports.
      results.push({ case: fixture.id, repeat, variant, error: error instanceof Error ? error.name : 'Error' })
      console.log(`${fixture.id} ${repeat} ${variant}: request/evaluation failed`)
    }
    await writeFile(join(directory, 'results.json'), JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', transpose, cases, results }, null, 2))
  }
}
console.log(`Report and listening scores: ${directory}`)
for (const variant of ['baseline', 'candidate']) {
  const rows = results.filter(row => row.variant === variant)
  const successful = rows.filter(row => 'valid' in row)
  console.log(`${variant}: ${successful.filter(row => row.valid).length}/${successful.length} valid completed responses; ${rows.length - successful.length} request/evaluation errors`)
}

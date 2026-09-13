import { streamAiText, type OwtAiConfig, type OwtAiTransportOptions } from './owt-ai.ts'
import { buildImprovPrompt } from './improv-prompt.ts'
import { ImprovEventParser, type ImprovPlan, type ImprovRole } from './realtime-improv.ts'

export async function generateImprovPlan(
  config: OwtAiConfig,
  plan: ImprovPlan,
  role: ImprovRole,
  onNote: (offset: number, duration: number, pitch: number, velocity: number) => void,
  options: OwtAiTransportOptions = {},
): Promise<void> {
  const { system, prompt, earliest } = buildImprovPrompt(plan, role)
  // No new onset can fit. Preserve the carried voice without spending a request.
  if (earliest >= plan.beats * 4) return
  let boundaryViolations = 0
  const parser = new ImprovEventParser(plan.beats * 4, (offset, duration, pitch, velocity) => {
    if (offset < earliest) { boundaryViolations++; return }
    onNote(offset, duration, pitch, velocity)
  })
  const result = await streamAiText({ ...config, thinkingMode: 'disabled', reasoningEffort: 'none', maxTokens: plan.beats <= 4 ? 192 : 320 }, system, prompt, {
    ...options,
    onUpdate: (text) => parser.push(text),
    onReasoningUpdate: undefined,
  })
  parser.push(result, true)
  if (parser.rejected || boundaryViolations) throw new Error(`AI returned ${parser.rejected + boundaryViolations} invalid music event(s)`)
  if (!parser.ended) throw new Error('AI music stream ended without END (possibly truncated)')
}

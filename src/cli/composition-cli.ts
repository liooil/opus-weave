import { resolve } from 'node:path'
import { analyzeFullComposition, assembleFullComposition, parseCompositionPlan, type ComposedSection } from '../domain/ai/full-composition.ts'
import { OpusWeaveService } from '../domain/services/opusweave-service.ts'

function parse(args: string[]): { command?: string; positional: string[]; output?: string } {
  const [command, ...rest] = args
  const positional: string[] = []
  let output: string | undefined
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index]!
    if (value === '-o' || value === '--output') {
      output = rest[++index]
      if (!output) throw new Error(`${value} requires a value`)
    } else positional.push(value)
  }
  return { command, positional, output }
}

async function emit(text: string, output?: string): Promise<void> {
  if (output) await Bun.write(resolve(output), text)
  else console.log(text)
}

export async function runCompositionCli(args: string[], service = new OpusWeaveService()): Promise<void> {
  const { command, positional, output } = parse(args)
  if (!command) throw new Error('usage: opusweave composition <plan|section|assemble|analyze|revise> ...')
  if (command === 'plan') {
    const file = positional[0]
    if (!file) throw new Error('composition plan requires plan.json')
    await emit(`${JSON.stringify(parseCompositionPlan(await Bun.file(resolve(file)).json()), null, 2)}\n`, output)
    return
  }
  if (command === 'section') {
    const [id, file] = positional
    if (!id || !file) throw new Error('composition section requires <section-id> <section.owt>')
    await emit(`${JSON.stringify({ id, owt: service.formatOwt(await Bun.file(resolve(file)).text()), attempts: 1 }, null, 2)}\n`, output)
    return
  }
  const [planFile, sectionsFile] = positional
  if (!planFile) throw new Error(`composition ${command} requires plan.json`)
  const plan = parseCompositionPlan(await Bun.file(resolve(planFile)).json())
  if (command === 'analyze') {
    if (!sectionsFile) throw new Error('composition analyze requires <plan.json> <score.owt>')
    await emit(`${JSON.stringify(analyzeFullComposition(plan, await Bun.file(resolve(sectionsFile)).text()), null, 2)}\n`, output)
    return
  }
  if (!sectionsFile) throw new Error(`composition ${command} requires <plan.json> <sections.json>`)
  const sections = await Bun.file(resolve(sectionsFile)).json() as ComposedSection[]
  if (command === 'assemble') {
    await emit(assembleFullComposition(plan, sections), output)
    return
  }
  if (command === 'revise') {
    const [sectionId, revisedFile] = positional.slice(2)
    if (!sectionId || !revisedFile) throw new Error('composition revise requires <plan.json> <sections.json> <section-id> <revised.owt>')
    if (!plan.sections.some((section) => section.id === sectionId)) throw new Error(`unknown section ${sectionId}`)
    const revisedOwt = service.formatOwt(await Bun.file(resolve(revisedFile)).text())
    await emit(`${JSON.stringify(sections.map((section) => section.id === sectionId ? { ...section, owt: revisedOwt } : section), null, 2)}\n`, output)
    return
  }
  throw new Error(`unknown composition command: ${command}`)
}

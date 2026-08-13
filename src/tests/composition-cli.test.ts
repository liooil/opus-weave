import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCompositionCli } from '../cli/composition-cli.ts'

const directory = mkdtempSync(join(tmpdir(), 'opusweave-composition-cli-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const plan = { title: 'CLI', durationTargetSeconds: 60, meter: '4/4', key: 'C major', sections: [
  { id: 'a', name: 'A', bars: 1, tempoStart: 120, mood: 'calm', instrumentation: ['Piano'], density: 'sparse', role: 'opening' },
  { id: 'b', name: 'B', bars: 1, tempoStart: 140, mood: 'bright', instrumentation: ['Piano'], density: 'dense', role: 'climax' },
] }
const section = 'owt 0.1 score\nmeter 1:1 4/4\ntrack "Piano" channel=1 program=0 velocity=80\n| C4:1 D4:1 E4:1 F4:1 |\nend\n'

describe('composition CLI', () => {
  test('validates plan and section, assembles, analyzes, and revises one section', async () => {
    const planFile = join(directory, 'plan.json'); await Bun.write(planFile, JSON.stringify(plan))
    const sectionFile = join(directory, 'section.owt'); await Bun.write(sectionFile, section)
    const normalizedPlan = join(directory, 'normalized.json'); await runCompositionCli(['plan', planFile, '-o', normalizedPlan])
    expect((await Bun.file(normalizedPlan).json()).sections).toHaveLength(2)
    const aFile = join(directory, 'a.json'); await runCompositionCli(['section', 'a', sectionFile, '-o', aFile])
    const a = await Bun.file(aFile).json()
    const sectionsFile = join(directory, 'sections.json'); await Bun.write(sectionsFile, JSON.stringify([a, { ...a, id: 'b' }]))
    const scoreFile = join(directory, 'score.owt'); await runCompositionCli(['assemble', planFile, sectionsFile, '-o', scoreFile])
    expect(await Bun.file(scoreFile).text()).toContain('tempo 2:1 140')
    const analysisFile = join(directory, 'analysis.json'); await runCompositionCli(['analyze', planFile, scoreFile, '-o', analysisFile])
    expect((await Bun.file(analysisFile).json()).bars).toBe(2)
    const revised = section.replace('C4:1 D4:1 E4:1 F4:1', 'G4:1 A4:1 B4:1 C5:1')
    const revisedFile = join(directory, 'revised.owt'); await Bun.write(revisedFile, revised)
    const output = join(directory, 'revised.json'); await runCompositionCli(['revise', planFile, sectionsFile, 'b', revisedFile, '-o', output])
    const result = await Bun.file(output).json()
    expect(result[0].owt).not.toContain('G4:1')
    expect(result[1].owt).toContain('G4:1')
  })
})

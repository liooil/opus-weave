import { describe, expect, test } from 'bun:test'
import { repairCommonOwtErrors } from '../domain/owt/repair.ts'

describe('common OWT repair', () => {
  test('normalizes fenced AI output, typography, directive case, and missing end', () => {
    const result = repairCommonOwtErrors(`AI response:\n\`\`\`owt\nOWT 0.1 score\n\nTITLE “Fixed”\nppq 480\nmeter 1：1 4/4\ntempo 1:1 120\nkey 1:1 C major\nTRACK “Melody” channel＝1 program=0 velocity=88\n｜ C4:1 D4:1 E4:1 G4:1 ｜\n\`\`\``)
    expect(result.valid).toBe(true)
    expect(result.text).toContain('title "Fixed"')
    expect(result.text).toContain('track "Melody" channel=1')
    expect(result.text).toContain('| C4:1 D4:1 E4:1 G4:1 |')
    expect(result.text).toEndWith('\nend\n')
    expect(result.changes).toEqual(expect.arrayContaining(['markdown-fence', 'typography', 'keyword-case', 'end']))
  })

  test('does not claim success when safe normalization cannot fix structural errors', () => {
    const result = repairCommonOwtErrors('owt 0.1 score\ntrack "Melody" channel=1\n| H9:1 |\nend')
    expect(result.valid).toBe(false)
  })

  test('fills a short bar with a rest', () => {
    const result = repairCommonOwtErrors(`owt 0.1 score
meter 1:1 4/4
track "Melody" channel=1
| C4:1 D4:1 E4:1 |
end
`)
    expect(result.valid).toBe(true)
    expect(result.text).toContain('| C4:1 D4:1 E4:1 R:1 |')
    expect(result.changes).toContain('bar-fill-rest')
  })

  test('moves an overfull bar to an event boundary and fills the final measure', () => {
    const result = repairCommonOwtErrors(`owt 0.1 score
meter 1:1 4/4
track "Melody" channel=1
| C4:1 D4:1 E4:1 F4:1 G4:1 |
end
`)
    expect(result.valid).toBe(true)
    expect(result.text).toContain('| C4:1 D4:1 E4:1 F4:1 | G4:1')
    expect(result.text).toContain('R:3\nend')
    expect(result.changes).toEqual(expect.arrayContaining(['bar-move', 'track-fill-rest']))
  })

  test('fills an incomplete final measure even when no bar token is present', () => {
    const result = repairCommonOwtErrors(`owt 0.1 score
meter 1:1 4/4
track "Melody" channel=1
C4:1 D4:1
end
`)
    expect(result.valid).toBe(true)
    expect(result.text).toContain('C4:1 D4:1\nR:2\nend')
    expect(result.changes).toContain('track-fill-rest')
  })

  test('does not split a cross-boundary event unless explicitly enabled', () => {
    const source = `owt 0.1 score
meter 1:1 4/4
track "Melody" channel=1
| C4:3 D4:2 |
end
`
    const safe = repairCommonOwtErrors(source)
    expect(safe.valid).toBe(false)
    expect(safe.text).toBe(source)

    const split = repairCommonOwtErrors(source, { splitCrossBoundaryEvents: true })
    expect(split.valid).toBe(true)
    expect(split.text).toContain('C4:3 D4:1 | D4:1')
    expect(split.text).toContain('R:3\nend')
    expect(split.changes).toContain('bar-split-event')
  })
})

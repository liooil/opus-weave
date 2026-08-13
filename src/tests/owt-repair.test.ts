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
})

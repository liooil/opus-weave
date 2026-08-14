import { describe, expect, test } from 'bun:test'
import { appendOwtScores, completeOwtPrefix } from '../domain/owt/streaming.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'
import { serializeOwt } from '../domain/owt/serializer.ts'

const baseText = `owt 0.1 score

title "Call"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88

| C4:1 D4:1 E4:1 F4:1 |

end
`

const responseText = `owt 0.1 score

title "Call"
ppq 480
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88

| C4:1 D4:1 E4:1 F4:1 |
| G4:1 A4:1 B4:1 C5:1 |

end
`

describe('OWT streaming helpers', () => {
  test('finds the latest complete measure before an unfinished streamed line', () => {
    const result = completeOwtPrefix(`${responseText.replace('| G4:1 A4:1 B4:1 C5:1 |', '| G4:1 A4:1')}`)
    expect(result?.document.tracks[0]?.events).toHaveLength(4)
    expect(result?.text).toContain('| C4:1 D4:1 E4:1 F4:1 |')
  })

  test("appends an AI response tail without duplicating the user's phrase", () => {
    const base = parseOwtOrThrow(baseText)
    const response = parseOwtOrThrow(responseText)
    const merged = appendOwtScores(base, response)
    const text = serializeOwt(merged)
    expect(text.match(/C4:1/g)).toHaveLength(1)
    expect(text).toContain('G4:1 A4:1 B4:1 C5:1')
    expect(merged.tracks[0]?.events).toHaveLength(8)
  })

  test('keeps a partial full-score response attached to the base score', () => {
    const base = parseOwtOrThrow(baseText.replace('\nend\n', '\n| G4:1 A4:1 B4:1 C5:1 |\n\nend\n'))
    const partialResponse = parseOwtOrThrow(baseText)
    const merged = appendOwtScores(base, partialResponse)
    expect(merged.tracks[0]?.events).toHaveLength(8)
    expect(serializeOwt(merged).match(/C4:1/g)).toHaveLength(1)
  })

  test('shifts a fragment after the existing score', () => {
    const base = parseOwtOrThrow(baseText)
    const fragment = parseOwtOrThrow(responseText.replace('| C4:1 D4:1 E4:1 F4:1 |\n', ''))
    const merged = appendOwtScores(base, fragment)
    expect(merged.tracks[0]?.events[4]?.at).toEqual({ numerator: 4, denominator: 1 })
  })
})

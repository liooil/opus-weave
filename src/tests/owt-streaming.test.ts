import { describe, expect, test } from 'bun:test'
import { appendOwtScores, appendOwtTrack, appendOwtUserTrack } from '../domain/owt/streaming.ts'
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

describe('OWT score appending', () => {
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

  test('appends a repeated human phrase after the combined score end', () => {
    const base = parseOwtOrThrow(baseText)
    const phrase = parseOwtOrThrow(baseText)
    const merged = appendOwtTrack(base, phrase)
    expect(merged.tracks).toHaveLength(1)
    expect(merged.tracks[0]?.events).toHaveLength(8)
    expect(merged.tracks[0]?.events[4]?.at).toEqual({ numerator: 4, denominator: 1 })
  })

  test('keeps improvisation input in the first track and reserves the second for AI', () => {
    const duetSkeleton = parseOwtOrThrow(`owt 0.1 score

track "Human" channel=1 program=0 velocity=88

track "AI Response" channel=2 program=0 velocity=88

end
`)
    const phrase = parseOwtOrThrow(baseText)
    const merged = appendOwtUserTrack(duetSkeleton, phrase)
    expect(merged.tracks.map((track) => track.name)).toEqual(['Human', 'AI Response'])
    expect(merged.tracks[0]?.events).toHaveLength(4)
    expect(merged.tracks[1]?.events).toHaveLength(0)
  })

  test('starts a new human phrase after both tracks of a previous duet turn', () => {
    const duet = parseOwtOrThrow(baseText.replace('\nend\n', '\ntrack "AI Response" channel=2 program=0 velocity=88\n| R:4 |\n| G4:1 A4:1 B4:1 C5:1 |\nend\n'))
    const phrase = parseOwtOrThrow(baseText)
    const merged = appendOwtTrack(duet, phrase)
    expect(merged.tracks).toHaveLength(2)
    expect(merged.tracks[0]?.events).toHaveLength(8)
    expect(merged.tracks[0]?.events[4]?.at).toEqual({ numerator: 8, denominator: 1 })
  })
})

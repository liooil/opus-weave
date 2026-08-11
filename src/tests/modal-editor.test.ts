import { describe, expect, test } from 'bun:test'
import { applyTextEdits, cursorsAfterEdits, nextGrapheme, previousGrapheme } from '../web/editor/modal-editor.ts'
import { buildOwtSyntaxIndex, nextObject, objectContaining, replaceOwtEventPitch, syntaxParent } from '../web/editor/owt-objects.ts'
import { buildPracticePrompts, PracticeSession } from '../domain/owt/practice-session.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'

const scoreText = `owt 0.1 score

title "Modal"
meter 1:1 4/4
tempo 1:1 120
track "Melody" channel=1 program=0 velocity=88
| C4:1 D4:1 [E4 G4]:1 C4:1 |
end
`

describe('modal editor primitives', () => {
  test('moves on Unicode grapheme boundaries', () => {
    const text = 'A旋🎵B'
    const afterA = nextGrapheme(text, 0)
    const afterChinese = nextGrapheme(text, afterA)
    const afterEmoji = nextGrapheme(text, afterChinese)
    expect(text.slice(afterChinese, afterEmoji)).toBe('🎵')
    expect(previousGrapheme(text, afterEmoji)).toBe(afterChinese)
  })

  test('applies simultaneous edits from right to left and maps final cursors', () => {
    const edits = [
      { from: 0, to: 2, insert: 'C4' },
      { from: 6, to: 8, insert: 'E4' },
    ]
    expect(applyTextEdits('D4:1  F4:1', edits)).toBe('C4:1  E4:1')
    expect(cursorsAfterEdits(edits, true)).toEqual([{ anchor: 2, head: 2 }, { anchor: 8, head: 8 }])
  })
})

describe('OWT semantic objects', () => {
  test('indexes notes, pitches, durations, measures and tracks', () => {
    const index = buildOwtSyntaxIndex(scoreText)
    expect(index.notes).toHaveLength(4)
    expect(index.pitches.map((pitch) => pitch.value)).toEqual(['C4', 'D4', 'E4', 'G4', 'C4'])
    expect(index.durations).toHaveLength(4)
    expect(index.measures).toHaveLength(1)
    expect(index.tracks).toHaveLength(1)
    expect(nextObject(index, 'note', 0, 1)?.value).toBe('C4:1')
    const firstPitch = index.pitches[0]!
    expect(syntaxParent(index, firstPitch.start, firstPitch.end).kind).toBe('event')
  })

  test('maps a clicked event through measure and track hierarchy', () => {
    const index = buildOwtSyntaxIndex(scoreText)
    const event = index.events[1]!
    expect(objectContaining(index, 'event', event.start, event.end)?.value).toBe('D4:1')
    expect(objectContaining(index, 'measure', event.start, event.end)?.kind).toBe('measure')
    expect(objectContaining(index, 'track', event.start, event.end)?.kind).toBe('track')
  })

  test('performance replacement preserves rhythm and event attributes', () => {
    expect(replaceOwtEventPitch('C4:1', 'F#4')).toBe('F#4:1')
    expect(replaceOwtEventPitch('[C4 E4 G4]:3/2{velocity=92}', 'A4')).toBe('A4:3/2{velocity=92}')
    expect(replaceOwtEventPitch('R:1/4', 'D5')).toBe('D5:1/4')
    expect(replaceOwtEventPitch('invalid', 'C4')).toBeNull()
  })
})

describe('guided performance', () => {
  test('advances only after the expected note or complete chord', () => {
    const prompts = buildPracticePrompts(parseOwtOrThrow(scoreText))
    const session = new PracticeSession(prompts)
    expect(session.current?.pitches).toEqual([60])
    expect(session.accept(61)).toEqual({ matched: false, advanced: false, complete: false })
    expect(session.accept(60).advanced).toBe(true)
    expect(session.accept(62).advanced).toBe(true)
    expect(session.current?.pitches).toEqual([64, 67])
    expect(session.accept(64)).toEqual({ matched: true, advanced: false, complete: false })
    expect(session.accept(67).advanced).toBe(true)
    expect(session.accept(60)).toEqual({ matched: true, advanced: true, complete: true })
  })
})

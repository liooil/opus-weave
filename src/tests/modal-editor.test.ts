import { describe, expect, test } from 'bun:test'
import { applyTextEdits, cursorsAfterEdits, nextGrapheme, owtSemanticMotion, previousGrapheme } from '../web/editor/modal-editor.ts'
import { buildOwtSyntaxIndex, nextObject, objectContaining, replaceOwtEventPitch, selectionLevelForClickCount, semanticDeletionEdits, semanticRangeFromNativeSelection, syntaxParent } from '../web/editor/owt-objects.ts'
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

  test('maps horizontal Helix motions to events and vertical motions to measures', () => {
    expect(owtSemanticMotion('h')).toEqual({ kind: 'event', direction: -1 })
    expect(owtSemanticMotion('l')).toEqual({ kind: 'event', direction: 1 })
    expect(owtSemanticMotion('b')).toEqual({ kind: 'event', direction: -1 })
    expect(owtSemanticMotion('w')).toEqual({ kind: 'event', direction: 1 })
    expect(owtSemanticMotion('e')).toEqual({ kind: 'event', direction: 1 })
    expect(owtSemanticMotion('k')).toEqual({ kind: 'measure', direction: -1 })
    expect(owtSemanticMotion('j')).toEqual({ kind: 'measure', direction: 1 })
    expect(owtSemanticMotion('/')).toBeUndefined()
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

  test('does not create a phantom measure between bar lines on adjacent rows', () => {
    const multiLine = scoreText.replace('| C4:1 D4:1 [E4 G4]:1 C4:1 |', '| C4:2 D4:2 |\n| E4:2 G4:2 |')
    const index = buildOwtSyntaxIndex(multiLine)
    expect(index.measures).toHaveLength(2)
    expect(index.measures.map((measure) => multiLine.slice(measure.start, measure.end))).not.toContain('|\n|')
  })

  test('maps a clicked event through measure and track hierarchy', () => {
    const index = buildOwtSyntaxIndex(scoreText)
    const event = index.events[1]!
    expect(objectContaining(index, 'event', event.start, event.end)?.value).toBe('D4:1')
    expect(objectContaining(index, 'measure', event.start, event.end)?.kind).toBe('measure')
    expect(objectContaining(index, 'track', event.start, event.end)?.kind).toBe('track')
  })

  test('maps native click counts to event, measure and track selection', () => {
    expect(selectionLevelForClickCount(1)).toBe('event')
    expect(selectionLevelForClickCount(2)).toBe('measure')
    expect(selectionLevelForClickCount(3)).toBe('track')
    expect(selectionLevelForClickCount(4)).toBe('track')
  })

  test('snaps native single, double and triple click selections to the semantic hierarchy', () => {
    const multiTrack = scoreText.replace(
      '| C4:1 D4:1 [E4 G4]:1 C4:1 |',
      '| C4:2 D4:2 |\n| E4:2 G4:2 |\ntrack "Bass" channel=2 program=0 velocity=72\n| C2:4 |',
    )
    const index = buildOwtSyntaxIndex(multiTrack)
    const eventRange = semanticRangeFromNativeSelection(index, 'event', index.events[0]!.start, index.events[2]!.end)
    expect(eventRange).toEqual({ start: index.events[0]!.start, end: index.events[2]!.end })
    expect(semanticRangeFromNativeSelection(index, 'measure', index.events[0]!.start, index.events[2]!.end)).toEqual({
      start: index.measures[0]!.start,
      end: index.measures[1]!.end,
    })
    expect(semanticRangeFromNativeSelection(index, 'track', index.events[0]!.start, index.events.at(-1)!.end)).toEqual({
      start: index.tracks[0]!.start,
      end: index.tracks[1]!.end,
    })
  })

  test('changes selected events to rests but removes measures and tracks', () => {
    const index = buildOwtSyntaxIndex(scoreText)
    const event = index.events[1]!
    expect(applyTextEdits(scoreText, semanticDeletionEdits(scoreText, index, [event]))).toContain('| C4:1 R:1 [E4 G4]:1 C4:1 |')

    const twoMeasures = scoreText.replace('| C4:1 D4:1 [E4 G4]:1 C4:1 |', '| C4:2 D4:2 | E4:2 G4:2 |')
    const measureIndex = buildOwtSyntaxIndex(twoMeasures)
    expect(applyTextEdits(twoMeasures, semanticDeletionEdits(twoMeasures, measureIndex, [measureIndex.measures[0]!]))).toContain('| E4:2 G4:2 |')

    const twoTracks = scoreText.replace('end\n', 'track "Bass" channel=2 program=0 velocity=72\n| C2:4 |\nend\n')
    const trackIndex = buildOwtSyntaxIndex(twoTracks)
    const withoutMelody = applyTextEdits(twoTracks, semanticDeletionEdits(twoTracks, trackIndex, [trackIndex.tracks[0]!]))
    expect(withoutMelody).not.toContain('track "Melody"')
    expect(withoutMelody).toContain('track "Bass"')
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

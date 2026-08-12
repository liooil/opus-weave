import { describe, expect, test } from 'bun:test'
import { activeOwtPlaybackIds, activeOwtSourceRanges, buildOwtPlaybackMap, cursorOwtPlaybackTokens, playbackStartForSourceRanges } from '../domain/owt/playback-map.ts'
import { parseOwtOrThrow } from '../domain/owt/parser.ts'
import { owtLexicalRanges, renderOwtHighlight } from '../web/components/owt-highlighter.ts'

const melody = `owt 0.1 score

title "Highlight"
meter 1:1 4/4
tempo 1:1 120
key 1:1 C major

track "Melody" channel=1 program=0 velocity=88

| C4:1 D4:1 E4:1 R:1 | # phrase

end
`

describe('OWT lexical highlighting', () => {
  test('classifies keywords, strings, notes, rests, bars, attributes and comments', () => {
    const html = renderOwtHighlight(melody)
    expect(html).toContain('class="owt-syntax-keyword">owt</span>')
    expect(html).toContain('class="owt-syntax-string">"Highlight"</span>')
    expect(html).toContain('class="owt-syntax-note">C4:1</span>')
    expect(html).toContain('class="owt-syntax-rest">R:1</span>')
    expect(html).toContain('class="owt-syntax-bar">|</span>')
    expect(html).toContain('class="owt-syntax-attribute">channel</span>')
    expect(html).toContain('class="owt-syntax-comment"># phrase</span>')
  })

  test('does not treat an accidental as a comment', () => {
    const text = melody.replace('C4:1', 'C#4:1')
    const ranges = owtLexicalRanges(text)
    const note = ranges.find((range) => text.slice(range.start, range.end) === 'C#4:1')
    expect(note?.className).toBe('owt-syntax-note')
  })
})

describe('OWT playback source mapping', () => {
  test('maps playback seconds to the exact source token', () => {
    const score = parseOwtOrThrow(melody)
    const map = buildOwtPlaybackMap(melody, score)
    expect(map).toHaveLength(4)

    const first = activeOwtSourceRanges(map, 0.1)
    expect(first).toHaveLength(1)
    expect(melody.slice(first[0]!.start, first[0]!.end)).toBe('C4:1')
    expect(activeOwtPlaybackIds(map, 0.1)).toEqual(['0:0'])

    const second = activeOwtSourceRanges(map, 0.6)
    expect(second).toHaveLength(1)
    expect(melody.slice(second[0]!.start, second[0]!.end)).toBe('D4:1')
  })

  test('keeps one cursor per track at the same playback position', () => {
    const text = melody.replace('\nend\n', '\ntrack "Bass" channel=2 program=32 velocity=72\n\n| C3:2 G2:2 |\n\nend\n')
    const score = parseOwtOrThrow(text)
    const map = buildOwtPlaybackMap(text, score)
    const cursors = cursorOwtPlaybackTokens(map, 0)
    expect(cursors).toHaveLength(2)
    expect(new Set(cursors.map((token) => token.playbackId.split(':')[0]))).toEqual(new Set(['0', '1']))
    expect(playbackStartForSourceRanges(map, cursors)).toBe(0)
  })

  test('adds the playback class without losing lexical color', () => {
    const score = parseOwtOrThrow(melody)
    const map = buildOwtPlaybackMap(melody, score)
    const ranges = activeOwtSourceRanges(map, 1.1)
    const html = renderOwtHighlight(melody, ranges)
    expect(html).toContain('class="owt-syntax-note owt-token-playing">E4:1</span>')
  })
})
